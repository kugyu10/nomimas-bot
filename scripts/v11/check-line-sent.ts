/**
 * scripts/v11/check-line-sent.ts
 * 合格条件4の機械判定: 「今日(JST)、実際にLINE配信が発生した記録がある」ことを
 * notification_logs を観測するだけで検証する。
 *
 * このスクリプトは送信を一切行わない。observeのみ。
 *
 * 検証内容:
 *   - notification_logs に sent >= 1 の行が、今日(JST)の日付で1件以上あること
 *   - その行の kind / recipients / sent / failed / skipped_no_line_id / created_at を出力する
 *
 * 使い方:
 *   set -a; source /Users/kugyu10/work/nomimas-bot/.env.local; set +a
 *   deno run --allow-net --allow-read --allow-env scripts/v11/check-line-sent.ts
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
      kind: string;
      recipients: number;
      sent: number;
      failed: number;
      skipped_no_line_id: number;
      created_at: Date;
    }[]
  >`
    select id, kind, recipients, sent, failed, skipped_no_line_id, created_at
    from public.notification_logs
    where sent >= 1
      and (created_at at time zone 'Asia/Tokyo')::date = (now() at time zone 'Asia/Tokyo')::date
    order by created_at desc
  `;

  if (rows.length === 0) {
    fail(
      "notification_logs に今日(JST)の sent>=1 の行がありません（実LINE配信が観測できていません）",
    );
  } else {
    ok(`今日(JST)の sent>=1 の行が ${rows.length} 件あります`);
    for (const r of rows) {
      console.log(
        `[check-line-sent]   id=${r.id} kind=${r.kind} recipients=${r.recipients} sent=${r.sent} ` +
          `failed=${r.failed} skipped_no_line_id=${r.skipped_no_line_id} created_at=${
            r.created_at?.toISOString?.() ?? r.created_at
          }`,
      );
    }
  }

  console.log("\n" + "=".repeat(60));
  if (failures.length === 0) {
    console.log(
      `条件4 OK: 今日(JST) notification_logs に sent>=1 の行が ${rows.length} 件`,
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
