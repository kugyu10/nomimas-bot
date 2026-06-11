/**
 * scripts/setup-dev.ts
 * dev 環境セットアップスクリプト（冪等・env 読み・値はコミットしない）
 *
 * 実行内容:
 *   1. Vault に project_url / cron_function_key / cron_shared_secret を投入（冪等: delete → create）
 *      - cron_function_key: anonキー（ゲートウェイJWT通過用 Authorization）
 *      - cron_shared_secret: 専用シークレット CRON_FUNCTION_KEY（WR-01: x-cron-key 照合用）
 *   2. oa_configs.line_channel_id を dev-oa 行に設定（webhookのOA解決用）
 *
 * 使い方:
 *   set -a; source /Users/kugyu10/work/nomimas-bot/env.dev; set +a
 *   deno run --allow-net --allow-read --allow-env scripts/setup-dev.ts
 */

import { connectDev } from "./db/sql.ts";

const ref = Deno.env.get("DEV_PROJECT_REF") ?? "";
const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const channelId = Deno.env.get("LINE_CHANNEL_ID") ?? "";
const cronFunctionKey = Deno.env.get("CRON_FUNCTION_KEY") ?? "";

// 必須環境変数チェック（connectDev() も ref を確認するが、先にわかりやすいエラーを出す）
if (!anonKey) {
  console.error("[setup-dev] ABORT: SUPABASE_ANON_KEY が設定されていません（env.dev を確認してください）");
  Deno.exit(1);
}
if (!channelId) {
  console.error("[setup-dev] ABORT: LINE_CHANNEL_ID が設定されていません（env.dev を確認してください）");
  Deno.exit(1);
}
if (!cronFunctionKey) {
  console.error("[setup-dev] ABORT: CRON_FUNCTION_KEY が設定されていません（env.dev を確認してください — WR-01）");
  Deno.exit(1);
}

const sql = connectDev();

try {
  console.log("[setup-dev] Vault シークレット投入を開始します...");

  // 冪等化: 既存シークレットを削除してから再作成
  await sql`delete from vault.secrets where name in ('project_url', 'cron_function_key', 'cron_shared_secret')`;
  console.log("[setup-dev] 既存シークレット削除: OK");

  await sql`select vault.create_secret(${`https://${ref}.supabase.co`}, 'project_url')`;
  console.log("[setup-dev] Vault 'project_url' 投入: OK");

  await sql`select vault.create_secret(${anonKey}, 'cron_function_key')`;
  console.log("[setup-dev] Vault 'cron_function_key' 投入: OK");

  // WR-01: message-sender の x-cron-key 照合用シークレット
  // Edge Function 側は `supabase secrets set CRON_FUNCTION_KEY=...` で同値を設定すること
  await sql`select vault.create_secret(${cronFunctionKey}, 'cron_shared_secret')`;
  console.log("[setup-dev] Vault 'cron_shared_secret' 投入: OK");

  // oa_configs.line_channel_id 更新（webhookのOA解決用。seedはnullのまま）
  const updated = await sql`
    update public.oa_configs
    set line_channel_id = ${channelId}
    where name = 'dev-oa'
    returning id, name, line_channel_id
  `;
  if (updated.length > 0) {
    console.log(`[setup-dev] oa_configs.line_channel_id 更新: OK (id=${updated[0].id})`);
  } else {
    console.error("[setup-dev] WARN: dev-oa 行が見つかりません（db reset + seed 適用後に再実行してください）");
  }

  console.log("[setup-dev] セットアップ完了");
} catch (err) {
  console.error("[setup-dev] エラー:", err);
  Deno.exit(1);
} finally {
  await sql.end();
}
