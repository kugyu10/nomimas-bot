/**
 * scripts/verify-cron.ts
 * cron.job 登録の機械検証スクリプト
 *
 * 検証内容:
 *   (1) pg_extension に pg_cron と pg_net が存在する
 *   (2) cron.job に 'confirm-broadcast-daily'（schedule='0 1 * * *', active=true）が1行存在する
 *   (3) 参考情報: cron.job_run_details 直近3件と net._http_response 直近3件を表示
 *
 * (1)(2) が満たされない場合は 非ゼロ終了（exit 1）
 *
 * 使い方:
 *   set -a; source /Users/kugyu10/work/nomimas-bot/env.dev; set +a
 *   deno run --allow-net --allow-read --allow-env scripts/verify-cron.ts
 */

import { connectDev } from "./db/sql.ts";

const sql = connectDev();
let hasFailure = false;

try {
  // -------------------------------------------------------------------------
  // (1) pg_cron / pg_net 拡張が有効か確認
  // -------------------------------------------------------------------------
  console.log("\n[verify-cron] (1) pg_extension チェック...");
  const extensions = await sql<{ extname: string }[]>`
    select extname from pg_extension where extname in ('pg_cron', 'pg_net')
    order by extname
  `;
  const extNames = extensions.map((r) => r.extname);
  console.log("  インストール済み拡張:", extNames.join(", ") || "(なし)");

  if (!extNames.includes("pg_cron")) {
    console.error("  [FAIL] pg_cron が有効化されていません");
    hasFailure = true;
  } else {
    console.log("  [OK] pg_cron");
  }
  if (!extNames.includes("pg_net")) {
    console.error("  [FAIL] pg_net が有効化されていません");
    hasFailure = true;
  } else {
    console.log("  [OK] pg_net");
  }

  // -------------------------------------------------------------------------
  // (2) cron.job に 'confirm-broadcast-daily' が登録されているか確認
  // -------------------------------------------------------------------------
  console.log("\n[verify-cron] (2) cron.job チェック...");
  const jobs = await sql<{ jobname: string; schedule: string; active: boolean }[]>`
    select jobname, schedule, active
    from cron.job
    where jobname = 'confirm-broadcast-daily'
  `;

  if (jobs.length === 0) {
    console.error("  [FAIL] 'confirm-broadcast-daily' ジョブが登録されていません");
    hasFailure = true;
  } else {
    const job = jobs[0];
    console.log(`  jobname:  ${job.jobname}`);
    console.log(`  schedule: ${job.schedule}`);
    console.log(`  active:   ${job.active}`);

    if (job.schedule !== "0 1 * * *") {
      console.error(`  [FAIL] schedule が '0 1 * * *' ではありません: '${job.schedule}'`);
      hasFailure = true;
    } else {
      console.log("  [OK] schedule");
    }
    if (job.active !== true) {
      console.error("  [FAIL] active が true ではありません");
      hasFailure = true;
    } else {
      console.log("  [OK] active");
    }
  }

  // -------------------------------------------------------------------------
  // (3) 参考情報: cron.job_run_details 直近3件
  // -------------------------------------------------------------------------
  console.log("\n[verify-cron] (3) cron.job_run_details 直近3件（参考）...");
  try {
    const details = await sql<
      { jobid: unknown; runid: unknown; job_pid: unknown; database: string; username: string; command: string; status: string; return_message: string; start_time: Date; end_time: Date }[]
    >`
      select jobid, runid, status, return_message, start_time, end_time
      from cron.job_run_details
      order by start_time desc
      limit 3
    `;
    if (details.length === 0) {
      console.log("  (ジョブ実行履歴なし)");
    } else {
      for (const d of details) {
        console.log(`  [${d.status}] ${d.start_time?.toISOString() ?? "?"} — ${d.return_message}`);
      }
    }
  } catch {
    console.log("  (cron.job_run_details が存在しないかアクセス不可)");
  }

  // -------------------------------------------------------------------------
  // (3) 参考情報: net._http_response 直近3件
  // -------------------------------------------------------------------------
  console.log("\n[verify-cron] (3) net._http_response 直近3件（参考）...");
  try {
    const responses = await sql<
      { id: unknown; status_code: number; timed_out: boolean }[]
    >`
      select id, status_code, timed_out
      from net._http_response
      order by id desc
      limit 3
    `;
    if (responses.length === 0) {
      console.log("  (HTTPレスポンス履歴なし)");
    } else {
      for (const r of responses) {
        console.log(`  id=${r.id} status_code=${r.status_code} timed_out=${r.timed_out}`);
      }
    }
  } catch {
    console.log("  (net._http_response が存在しないかアクセス不可)");
  }

  // -------------------------------------------------------------------------
  // 結果出力
  // -------------------------------------------------------------------------
  console.log("\n" + "=".repeat(60));
  if (hasFailure) {
    console.error("[verify-cron] RESULT: FAIL — 上記エラーを確認してください");
    Deno.exit(1);
  } else {
    console.log("[verify-cron] RESULT: OK — pg_cron/pg_net 有効 + confirm-broadcast-daily 登録済み");
  }
} catch (err) {
  console.error("[verify-cron] 予期しないエラー:", err);
  Deno.exit(1);
} finally {
  await sql.end();
}
