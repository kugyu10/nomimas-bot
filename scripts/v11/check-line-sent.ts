/**
 * scripts/v11/check-line-sent.ts
 * 合格条件4の機械判定: 「今日(JST)、実際にLINE配信が“本人宛てに1通だけ”発生した」ことを
 * notification_logs / oa_members を観測するだけで検証する。
 *
 * このスクリプトは送信を一切行わない。observeのみ。
 *
 * 検証内容（強化版 — 独立した検証役の指摘「sent>=1の行が今日あるか、しか見ておらず
 * kind/recipientsを絞っていないので複数通送られていても合格になってしまう」を反映）:
 *
 *   - 今日(JST) notification_logs の sent>=1 行が「ちょうど1件」であること
 *     （2件以上あれば「1通のみ」に反するのでNG）
 *   - その1件が sent=1 / recipients=1 / failed=0 であること
 *     （sent>=2 や recipients>=2 は複数宛先への配信を意味するためNG）
 *   - kind は出力するが合否判定には使わない
 *     （scrape_changes / confirm_broadcast のどちらでも「本人宛て1通」の要件は
 *       満たしうる。どちらだったかが分かることが大事、というだけ）
 *   - 今日(JST)の notification_logs 全行の sent の合計が1であること
 *     （「ちょうど1件」チェックとは独立した集計クエリで、2通に分かれて送られている
 *       ケースを取りこぼさないための裏づけ）
 *   - その oa_config_id の oa_members のうち line_user_id が非nullな行数が1であること
 *     （宛先が構造的に1名しか存在しないことの裏づけ。notification_logs 側の集計が
 *       偶然1になっていても、宛先候補が2名以上いるなら「本人宛て」の証明にはならない）
 *
 * 使い方:
 *   set -a; source /Users/kugyu10/work/nomimas-bot/.env.local; set +a
 *   deno run --allow-net --allow-read --allow-env --config deno.json scripts/v11/check-line-sent.ts
 *
 * 満たせば exit 0。欠ければ理由を出力して exit 1。
 */

import { connectDev } from "../db/sql.ts";

const failures: string[] = [];

function fail(msg: string) {
  failures.push(msg);
  console.error(`[check-line-sent] [FAIL] ${msg}`);
}

function ok(msg: string) {
  console.log(`[check-line-sent] [OK] ${msg}`);
}

const sql = connectDev();

try {
  console.log(
    "[check-line-sent] notification_logs を SELECT（今日(JST)・sent>=1）...",
  );

  // JST日付の比較は (created_at AT TIME ZONE 'Asia/Tokyo')::date で行う
  // （created_at は timestamptz。JSTの壁時計日付に変換してから今日と比較する）
  const rows = await sql<
    {
      id: string;
      oa_config_id: string;
      kind: string;
      recipients: number;
      sent: number;
      failed: number;
      skipped_no_line_id: number;
      created_at: Date;
    }[]
  >`
    select id, oa_config_id, kind, recipients, sent, failed, skipped_no_line_id, created_at
    from public.notification_logs
    where sent >= 1
      and (created_at at time zone 'Asia/Tokyo')::date = (now() at time zone 'Asia/Tokyo')::date
    order by created_at desc
  `;

  console.log(`[check-line-sent]   sent>=1 の行が ${rows.length} 件あります`);
  for (const r of rows) {
    console.log(
      `[check-line-sent]   id=${r.id} oa_config_id=${r.oa_config_id} kind=${r.kind} recipients=${r.recipients} sent=${r.sent} ` +
        `failed=${r.failed} skipped_no_line_id=${r.skipped_no_line_id} created_at=${
          r.created_at?.toISOString?.() ?? r.created_at
        }`,
    );
  }

  // 「ちょうど1件」判定が通った場合のみ、その1件の oa_config_id を後段の
  // oa_members チェックに使う（複数件ある時点で「本人」が確定しないため）
  let targetOaConfigId: string | undefined;

  if (rows.length === 0) {
    fail(
      "notification_logs に今日(JST)の sent>=1 の行がありません（実LINE配信が観測できていません）",
    );
  } else if (rows.length !== 1) {
    fail(
      `今日(JST)の sent>=1 の行が ${rows.length} 件あります（「本人宛て1通のみ」は"ちょうど1件"を要求するが、複数件ある）`,
    );
  } else {
    const r = rows[0];
    ok(`今日(JST)の sent>=1 の行がちょうど1件（id=${r.id}）`);
    targetOaConfigId = r.oa_config_id;

    if (r.sent !== 1) {
      fail(
        `その1件の sent が1ではありません: sent=${r.sent}（複数宛先に送っている可能性）`,
      );
    } else {
      ok("sent === 1");
    }
    if (r.recipients !== 1) {
      fail(
        `その1件の recipients が1ではありません: recipients=${r.recipients}（宛先が複数の可能性）`,
      );
    } else {
      ok("recipients === 1");
    }
    if (r.failed !== 0) {
      fail(`その1件の failed が0ではありません: failed=${r.failed}`);
    } else {
      ok("failed === 0");
    }
    console.log(
      `[check-line-sent]   kind=${r.kind}（合否判定には使わない。scrape_changes / confirm_broadcast の` +
        `いずれでも「本人宛て1通」は成立し得るため記録のみ）`,
    );
  }

  // ---------------------------------------------------------------------------
  // 今日(JST)の notification_logs 全行の sent 合計が1であること
  // （上の「ちょうど1件」チェックとは独立した集計クエリ。複数行に分かれて
  //   2通送られているケースを取りこぼさないための裏づけ）
  // ---------------------------------------------------------------------------
  console.log(
    "[check-line-sent] 今日(JST)の notification_logs 全行の sent 合計を SELECT...",
  );
  const [{ total_sent }] = await sql<{ total_sent: number }[]>`
    select coalesce(sum(sent), 0)::int as total_sent
    from public.notification_logs
    where (created_at at time zone 'Asia/Tokyo')::date = (now() at time zone 'Asia/Tokyo')::date
  `;
  console.log(`[check-line-sent]   今日(JST)の sent 合計 = ${total_sent}`);
  if (total_sent !== 1) {
    fail(
      `今日(JST)の notification_logs 全行の sent 合計が1ではありません: ${total_sent}`,
    );
  } else {
    ok("今日(JST)の sent 合計 === 1");
  }

  // ---------------------------------------------------------------------------
  // その oa_config_id の oa_members のうち line_user_id が非nullな行数が1であること
  // （宛先が構造的に1名しか存在しないことの裏づけ）
  // ---------------------------------------------------------------------------
  if (targetOaConfigId) {
    console.log(
      `[check-line-sent] oa_members（oa_config_id=${targetOaConfigId}）の line_user_id 非null行数を SELECT...`,
    );
    const [{ linked_count }] = await sql<{ linked_count: number }[]>`
      select count(*)::int as linked_count
      from public.oa_members
      where oa_config_id = ${targetOaConfigId}
        and line_user_id is not null
    `;
    console.log(
      `[check-line-sent]   line_user_id 非null行数 = ${linked_count}`,
    );
    if (linked_count !== 1) {
      fail(
        `oa_config_id=${targetOaConfigId} の oa_members で line_user_id 非null行数が1ではありません: ${linked_count}` +
          "（宛先が構造的に1名だけとは言えない）",
      );
    } else {
      ok(
        "oa_members の line_user_id 非null行数 === 1（宛先が構造的に1名のみ）",
      );
    }
  } else {
    console.log(
      "[check-line-sent]   (対象の oa_config_id が確定できないため oa_members チェックはスキップ — 上のFAILを参照)",
    );
  }

  console.log("\n" + "=".repeat(60));
  if (failures.length === 0) {
    console.log(
      "条件4 OK: 今日(JST) 本人宛て1通のみ（sent>=1行=1件, sent=1, recipients=1, failed=0, " +
        "今日の合計sent=1, oa_members紐付け=1）",
    );
    Deno.exit(0);
  } else {
    console.error(`条件4 NG: 以下の理由で不合格 — ${failures.join(" / ")}`);
    Deno.exit(1);
  }
} catch (err) {
  console.error("[check-line-sent] 予期しないエラー:", err);
  Deno.exit(1);
} finally {
  await sql.end();
}
