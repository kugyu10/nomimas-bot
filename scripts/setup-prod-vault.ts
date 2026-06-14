/**
 * scripts/setup-prod-vault.ts
 * prod 環境の Vault 投入（cron 用の3シークレットのみ・冪等）
 *
 * setup-dev.ts と異なり mock ユーザー・oa_configs・oa_members は一切触らない。
 * prod の実データ（OA設定・root/owner）は X ログイン後に管理画面から作成する。
 *
 * 投入内容（冪等: delete → create）:
 *   - project_url        : https://<ref>.supabase.co（cron の net.http_post URL 組み立て用）
 *   - cron_function_key  : anon キー（ゲートウェイ JWT 通過用 Authorization）
 *   - cron_shared_secret : CRON_FUNCTION_KEY（WR-01: x-cron-key 照合用。Edge secret と同値必須）
 *
 * 使い方:
 *   set -a; source ./.env.prod; set +a
 *   CRON_FUNCTION_KEY=<Edge secret と同値> \
 *   deno run --allow-net --allow-env scripts/setup-prod-vault.ts
 */

import postgres from "npm:postgres@3.4.9";

const PROD_PROJECT_REF = "hgojtooexbknqotzkkja";
const POOLER_HOST = Deno.env.get("SUPABASE_POOLER_HOST") ||
  "aws-1-ap-northeast-1.pooler.supabase.com";

const ref = Deno.env.get("PROD_PROJECT_REF") ?? "";
const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const cronFunctionKey = Deno.env.get("CRON_FUNCTION_KEY") ?? "";

// prod 安全弁: ref を強制確認
if (ref !== PROD_PROJECT_REF) {
  console.error(`[setup-prod-vault] ABORT: PROD_PROJECT_REF='${ref}' !== '${PROD_PROJECT_REF}'`);
  Deno.exit(1);
}
if (!anonKey) {
  console.error("[setup-prod-vault] ABORT: SUPABASE_ANON_KEY 未設定");
  Deno.exit(1);
}
if (!cronFunctionKey) {
  console.error("[setup-prod-vault] ABORT: CRON_FUNCTION_KEY 未設定（Edge secret と同値を渡すこと）");
  Deno.exit(1);
}

// DB パスワード: SUPABASE_DIRECT_CONNECTION_STRING からパース
let password = Deno.env.get("SUPABASE_DB_PASSWORD") ?? "";
if (!password) {
  const connStr = Deno.env.get("SUPABASE_DIRECT_CONNECTION_STRING") ?? "";
  const match = connStr.match(/^postgres(?:ql)?:\/\/[^:]+:([^@]+)@/);
  if (match) password = decodeURIComponent(match[1]);
}
if (!password) {
  console.error("[setup-prod-vault] ABORT: DB パスワード取得失敗（SUPABASE_DIRECT_CONNECTION_STRING を確認）");
  Deno.exit(1);
}

const sql = postgres({
  host: POOLER_HOST,
  port: 5432,
  database: "postgres",
  username: `postgres.${ref}`,
  password,
  ssl: "require",
  prepare: false,
});

try {
  console.log("[setup-prod-vault] Vault シークレット投入を開始します...");
  await sql`delete from vault.secrets where name in ('project_url', 'cron_function_key', 'cron_shared_secret')`;
  console.log("[setup-prod-vault] 既存シークレット削除: OK");

  await sql`select vault.create_secret(${`https://${ref}.supabase.co`}, 'project_url')`;
  console.log("[setup-prod-vault] Vault 'project_url' 投入: OK");

  await sql`select vault.create_secret(${anonKey}, 'cron_function_key')`;
  console.log("[setup-prod-vault] Vault 'cron_function_key' 投入: OK");

  await sql`select vault.create_secret(${cronFunctionKey}, 'cron_shared_secret')`;
  console.log("[setup-prod-vault] Vault 'cron_shared_secret' 投入: OK");

  console.log("[setup-prod-vault] 完了。");
} finally {
  await sql.end();
}
