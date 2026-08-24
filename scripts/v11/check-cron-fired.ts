/**
 * scripts/v11/check-cron-fired.ts
 * 合格条件3の機械判定: 「twipla-scrape-poll という cron ジョブが登録され、
 * 実際に実行されている」ことを検証する。
 *
 * 注意: このジョブ自体は別のエージェントが作る。作成担当はこのスクリプトの
 * 責務ではない。まだジョブが無い時点では「exit 1（未登録）」になるのが正しい。
 *
 * 検証内容:
 *   1. cron.job に jobname='twipla-scrape-poll' が active=true で存在すること
 *   2. cron.job_run_details に「そのjobidの」行が1件以上あること
 *      （既存の confirm-broadcast-daily の実行履歴を数えてしまわないよう、
 *        必ず jobid で絞る）
 *   3. 直近の実行の status / start_time を出力する。
 *      status が succeeded でない行しか無ければ非ゼロ終了
 *   4. 参考として net._http_response の直近の status_code を出力する（本文は出さない）
 *
 * 使い方:
 *   set -a; source /Users/kugyu10/work/nomimas-bot/.env.local; set +a
 *   deno run --allow-net --allow-read --allow-env scripts/v11/check-cron-fired.ts
 *
 * すべて満たせば exit 0。1つでも欠ければ理由を出力して exit 1。
 */

import { connectDev } from "../db/sql.ts";

const JOB_NAME = "twipla-scrape-poll";

const failures: string[] = [];

function fail(msg: string) {
  failures.push(msg);
  console.error(`[check-cron-fired] [FAIL] ${msg}`);
}

function ok(msg: string) {
  console.log(`[check-cron-fired] [OK] ${msg}`);
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
    limit 5
  `;

  if (runs.length === 0) {
    fail(`cron.job_run_details に jobid=${jobId} の実行履歴が1件もありません`);
  } else {
    ok(
      `cron.job_run_details に jobid=${jobId} の実行履歴が ${runs.length} 件あります（直近5件表示）`,
    );
    for (const r of runs) {
      console.log(
        `[check-cron-fired]   runid=${r.runid} status=${r.status} start_time=${
          r.start_time?.toISOString?.() ?? r.start_time
        }`,
      );
    }

    const latest = runs[0];
    console.log(
      `[check-cron-fired]   直近の実行: status=${latest.status} start_time=${latest.start_time}`,
    );

    const anySucceeded = runs.some((r) => r.status === "succeeded");
    if (!anySucceeded) {
      fail(
        `cron.job_run_details（jobid=${jobId}）に status='succeeded' の行がありません` +
          `（直近: status='${latest.status}'）`,
      );
    } else {
      ok("直近の実行履歴に status='succeeded' が含まれています");
    }
  }

  // -------------------------------------------------------------------------
  // (4) 参考: net._http_response の直近の status_code（本文は出さない）
  // -------------------------------------------------------------------------
  console.log(
    "[check-cron-fired] (4) net._http_response 直近3件（参考。本文は出力しない）...",
  );
  try {
    const responses = await sql<
      { id: unknown; status_code: number | null; timed_out: boolean }[]
    >`
      select id, status_code, timed_out
      from net._http_response
      order by id desc
      limit 3
    `;
    if (responses.length === 0) {
      console.log("[check-cron-fired]   (HTTPレスポンス履歴なし)");
    } else {
      for (const r of responses) {
        console.log(
          `[check-cron-fired]   id=${r.id} status_code=${r.status_code} timed_out=${r.timed_out}`,
        );
      }
    }
  } catch {
    console.log(
      "[check-cron-fired]   (net._http_response が存在しないかアクセス不可)",
    );
  }

  printResultAndExit();

  function printResultAndExit(): never {
    console.log("\n" + "=".repeat(60));
    if (failures.length === 0) {
      console.log(
        `条件3 OK: jobname='${JOB_NAME}' active=true / job_run_details に succeeded あり`,
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
