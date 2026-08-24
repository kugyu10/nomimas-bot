/**
 * scripts/v11/check-cron-fired.ts
 * 合格条件3の機械判定: 「twipla-scrape-poll という cron ジョブが登録され、
 * 実際に scraper を叩いて成功している」ことを検証する。
 *
 * 注意: このジョブ自体は別のエージェントが作る。作成担当はこのスクリプトの
 * 責務ではない。まだジョブが無い時点では「exit 1（未登録）」になるのが正しい。
 *
 * 検証内容（強化版 — 独立した検証役の指摘「cron.job_run_details に行があるか、しか
 * 見ていない。return_message が '0 rows'（ファンアウトSQLが対象0件で実際には何も
 * POSTしていない）でも合格になってしまう。net._http_response は参考出力しているだけで
 * アサートしていない」を反映）:
 *
 *   1. cron.job に jobname='twipla-scrape-poll' が active=true で存在すること（既存どおり）
 *   2. そのjobidの cron.job_run_details に status='succeeded' の行が1件以上あること（既存どおり）
 *   3. 【強化】succeeded の行のうち、return_message が「0 rows」ではない行が1件以上あること
 *      （= ファンアウトSQLが実際に対象を見つけて net.http_post を発行した証拠。
 *        「1 row」「N rows」のような行数表記から数値を取り出し1以上かを判定する。
 *        取り出せない形式だった場合は、その生文字列を出力してNGにする — 黙って通さない）
 *   4. 【強化】その「対象ありで成功した実行」の start_time 以降に、net._http_response で
 *      status_code が2xxの行が1件以上あることをアサートする
 *      （= POSTが実際に届いて成功応答が返った証拠）。
 *      net._http_response は古い行が間引かれる仕様のため、start_time 以降の行が
 *      1件も無ければ「間引かれて確認できない」旨を明示してwarningとして出力し、
 *      その項目はNGにしない（判定は3.のreturn_message行数のみで行う）。
 *      一方、start_time 以降に行はあるが2xxが1件も無い場合は「間引き」では説明できない
 *      実際の失敗の証拠なので、これはNGにする。
 *
 * 使い方:
 *   set -a; source /Users/kugyu10/work/nomimas-bot/.env.local; set +a
 *   deno run --allow-net --allow-read --allow-env --config deno.json scripts/v11/check-cron-fired.ts
 *
 * すべて満たせば exit 0。1つでも欠ければ理由を出力して exit 1。
 */

import { connectDev } from "../db/sql.ts";

const JOB_NAME = "twipla-scrape-poll";

// 15分間隔のジョブなので、500件で数日分の実行履歴をカバーできる
// （「対象ありで成功した実行」を探すために直近5件だけでは不十分な場合があるため）
const RUN_HISTORY_LIMIT = 500;

const failures: string[] = [];

function fail(msg: string) {
  failures.push(msg);
  console.error(`[check-cron-fired] [FAIL] ${msg}`);
}

function ok(msg: string) {
  console.log(`[check-cron-fired] [OK] ${msg}`);
}

/**
 * pg_cron の return_message から行数を取り出す。
 * 期待する形式は「0 rows」「1 row」「N rows」のような単純な行数表記のみ
 * （このcronジョブの本体は `select net.http_post(...) from ...` という
 *   単純なSELECTなので、この形式になるはず — 20260825010000マイグレーション参照）。
 * それ以外の形式（null・想定外の文言）は判定不能として null を返す
 * （呼び出し側で「取り出せない形式」を明示してNGにするための区別）。
 */
function parseRowCount(msg: string | null): number | null {
  if (msg === null) return null;
  const m = msg.trim().match(/^(\d+)\s+rows?$/i);
  if (!m) return null;
  return Number.parseInt(m[1], 10);
}

const sql = connectDev();

try {
  // -------------------------------------------------------------------------
  // (1) cron.job に jobname='twipla-scrape-poll' が active=true で存在すること
  // -------------------------------------------------------------------------
  console.log(
    `[check-cron-fired] (1) cron.job チェック（jobname='${JOB_NAME}'）...`,
  );
  const jobs = await sql<
    { jobid: number; jobname: string; schedule: string; active: boolean }[]
  >`
    select jobid, jobname, schedule, active
    from cron.job
    where jobname = ${JOB_NAME}
  `;

  if (jobs.length === 0) {
    fail(`cron.job に jobname='${JOB_NAME}' が登録されていません`);
    printResultAndExit();
  }

  const job = jobs[0];
  console.log(
    `[check-cron-fired]   jobid=${job.jobid} schedule=${job.schedule} active=${job.active}`,
  );

  if (job.active !== true) {
    fail(`'${JOB_NAME}' の active が true ではありません`);
  } else {
    ok("cron.job.active === true");
  }

  const jobId = job.jobid;

  // -------------------------------------------------------------------------
  // (2)(3) cron.job_run_details をそのjobidで絞って確認
  //     （既存の confirm-broadcast-daily の実行履歴を混ぜて数えない）
  //     直近5件は既存どおり表示するが、判定は RUN_HISTORY_LIMIT 件全体を対象に行う
  //     （「対象ありで成功した実行」が直近5件の中に無いケースを取り逃さないため）
  // -------------------------------------------------------------------------
  console.log(
    `[check-cron-fired] (2)(3) cron.job_run_details チェック（jobid=${jobId}で絞る）...`,
  );
  const runs = await sql<
    {
      runid: number;
      status: string;
      return_message: string | null;
      start_time: Date;
      end_time: Date | null;
    }[]
  >`
    select runid, status, return_message, start_time, end_time
    from cron.job_run_details
    where jobid = ${jobId}
    order by start_time desc
    limit ${RUN_HISTORY_LIMIT}
  `;

  // 「対象ありで成功した実行」が確定した場合に、(4) のnet._http_responseチェックで使う
  let targetRun:
    | { runid: number; return_message: string | null; start_time: Date }
    | undefined;

  if (runs.length === 0) {
    fail(`cron.job_run_details に jobid=${jobId} の実行履歴が1件もありません`);
  } else {
    ok(
      `cron.job_run_details に jobid=${jobId} の実行履歴が ${runs.length} 件あります（直近5件表示）`,
    );
    for (const r of runs.slice(0, 5)) {
      console.log(
        `[check-cron-fired]   runid=${r.runid} status=${r.status} return_message=${
          r.return_message ?? "(null)"
        } start_time=${r.start_time?.toISOString?.() ?? r.start_time}`,
      );
    }

    const latest = runs[0];
    console.log(
      `[check-cron-fired]   直近の実行: status=${latest.status} start_time=${latest.start_time}`,
    );

    const succeededRuns = runs.filter((r) => r.status === "succeeded");
    if (succeededRuns.length === 0) {
      fail(
        `cron.job_run_details（jobid=${jobId}）に status='succeeded' の行がありません` +
          `（直近: status='${latest.status}'）`,
      );
    } else {
      ok(
        `実行履歴 ${runs.length} 件中 status='succeeded' が ${succeededRuns.length} 件あります`,
      );

      // ---------------------------------------------------------------------
      // (3) succeeded の行のうち return_message が「0 rows」ではない行を探す
      //     （= ファンアウトSQLが対象を見つけて net.http_post を発行した証拠）
      //     直近（start_time降順）から見て最初に見つかったものを採用する。
      // ---------------------------------------------------------------------
      const unparseable: { runid: number; return_message: string | null }[] =
        [];
      let sawZeroRows = false;

      for (const r of succeededRuns) {
        const count = parseRowCount(r.return_message);
        if (count === null) {
          unparseable.push({
            runid: r.runid,
            return_message: r.return_message,
          });
          continue;
        }
        if (count >= 1) {
          targetRun = r;
          break;
        }
        sawZeroRows = true;
      }

      if (targetRun) {
        ok(
          `succeeded の行に return_message='0 rows'ではない行があります` +
            `（runid=${targetRun.runid}, return_message='${targetRun.return_message}', ` +
            `start_time=${targetRun.start_time.toISOString()}）— net.http_postが実際に発行された証拠`,
        );
      } else if (unparseable.length > 0) {
        // 想定外の形式は黙って通さない。生の値を出力してNGにする。
        fail(
          "succeeded 行の return_message が想定した形式（'N rows'）ではありません。" +
            "判定できないため不合格にします。生の値: " +
            unparseable
              .slice(0, 5)
              .map((u) => `runid=${u.runid}:'${u.return_message ?? "(null)"}'`)
              .join(", "),
        );
      } else if (sawZeroRows) {
        fail(
          `succeeded の行が全て return_message='0 rows' です（ファンアウトSQLの対象が0件で、` +
            `net.http_post が1件も発行されていません。窓内にイベントが無い可能性があります）`,
        );
      } else {
        // succeededRuns.length > 0 のはずなのでここには到達しないが、念のため
        fail(
          "succeeded の行の return_message を評価できませんでした（予期しない状態）",
        );
      }
    }
  }

  // -------------------------------------------------------------------------
  // (4) net._http_response: 「対象ありで成功した実行」の start_time 以降に
  //     status_code が2xxの行が1件以上あることをアサートする
  // -------------------------------------------------------------------------
  if (targetRun) {
    console.log(
      `[check-cron-fired] (4) net._http_response チェック（start_time=${targetRun.start_time.toISOString()} 以降）...`,
    );
    try {
      const responses = await sql<
        {
          id: unknown;
          status_code: number | null;
          timed_out: boolean;
          created: Date;
        }[]
      >`
        select id, status_code, timed_out, created
        from net._http_response
        where created >= ${targetRun.start_time}
        order by id desc
        limit 50
      `;

      if (responses.length === 0) {
        // net._http_response は古い行が間引かれる（vacuum/retention）仕様のテーブルなので、
        // 「start_time以降に1件も無い」ことは「本当にPOSTが届いていない」ことと
        // 「間引かれて確認できない」ことを区別できない。時間が経つと必ず落ちる検査に
        // したくないため、ここは warning として出力しNGにはしない
        // （判定は上の(3) return_message の行数のみで行う）。
        console.log(
          `[check-cron-fired]   [WARN] net._http_response に start_time 以降の行が1件もありません` +
            "（間引かれて確認できない可能性があるため、この項目はNGにしません。判定は(3)のreturn_message行数のみで行います）",
        );
      } else {
        const twoxx = responses.filter(
          (r) =>
            typeof r.status_code === "number" &&
            r.status_code >= 200 &&
            r.status_code < 300,
        );
        if (twoxx.length === 0) {
          // ここは「行が無い」のではなく「行はあるが2xxが無い」ケース。
          // 間引きでは説明できない実際の失敗の証拠なので、警告にせずNGにする。
          fail(
            `net._http_response に start_time 以降の行が ${responses.length} 件ありますが、` +
              "status_code が2xxの行が1件もありません（POSTが実際には失敗している疑い）。直近: " +
              responses
                .slice(0, 5)
                .map(
                  (r) =>
                    `id=${
                      String(r.id)
                    } status_code=${r.status_code} timed_out=${r.timed_out}`,
                )
                .join(", "),
          );
        } else {
          ok(
            `net._http_response に start_time 以降で status_code が2xxの行が ${twoxx.length} 件あります` +
              "（POSTが実際に届いて成功応答が返った証拠）",
          );
        }
      }
    } catch {
      console.log(
        "[check-cron-fired]   [WARN] net._http_response が存在しないかアクセス不可（この項目はNGにしません）",
      );
    }
  } else {
    console.log(
      "[check-cron-fired]   (4) net._http_response チェックはスキップ（対象ありのsucceeded実行が確定できなかったため — 上のFAILを参照）",
    );
  }

  printResultAndExit();

  function printResultAndExit(): never {
    console.log("\n" + "=".repeat(60));
    if (failures.length === 0) {
      console.log(
        `条件3 OK: jobname='${JOB_NAME}' active=true / 対象ありで succeeded した実行あり / ` +
          "net._http_responseで2xx確認（または間引きにより確認不能でwarning）",
      );
      Deno.exit(0);
    } else {
      console.error(`条件3 NG: 以下の理由で不合格 — ${failures.join(" / ")}`);
      Deno.exit(1);
    }
  }
} catch (err) {
  console.error("[check-cron-fired] 予期しないエラー:", err);
  Deno.exit(1);
} finally {
  await sql.end();
}
