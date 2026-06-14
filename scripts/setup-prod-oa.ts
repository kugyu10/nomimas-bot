/**
 * scripts/setup-prod-oa.ts
 * prod の最初の oa_config を1件 seed（冪等）
 *
 * 背景: 管理画面に OA 新規作成導線が無く、(app)/layout は listMyOas()==0 で /no-access に飛ばす。
 *       prod は oa_configs が空のため root でも入れない。最初の1件だけ DB seed して解錠する。
 *
 * 設定:
 *   - line_channel_id : prod LINE channel（UI非編集のため正値必須）
 *   - name / admin_twitter_id / greeting / questions : UI で後から編集可（name は仮値）
 *   - line_channel_id の部分unique制約で冪等（既存なら skip）
 *
 * 使い方:
 *   set -a; source ./.env.prod; set +a
 *   OA_NAME="コミュニティ名" OA_ADMIN_TWITTER_ID="kugyu10" \
 *   deno run --allow-net --allow-env scripts/setup-prod-oa.ts
 */

import postgres from "npm:postgres@3.4.9";

const PROD_PROJECT_REF = "hgojtooexbknqotzkkja";
const POOLER_HOST = Deno.env.get("SUPABASE_POOLER_HOST") ||
  "aws-1-ap-northeast-1.pooler.supabase.com";

const ref = Deno.env.get("PROD_PROJECT_REF") ?? "";
const channelId = Deno.env.get("LINE_CHANNEL_ID") ?? "";
const oaName = Deno.env.get("OA_NAME") || "本番OA";
const adminTwitterId = Deno.env.get("OA_ADMIN_TWITTER_ID") || null;

if (ref !== PROD_PROJECT_REF) {
  console.error(`[setup-prod-oa] ABORT: PROD_PROJECT_REF='${ref}' !== '${PROD_PROJECT_REF}'`);
  Deno.exit(1);
}
if (!channelId) {
  console.error("[setup-prod-oa] ABORT: LINE_CHANNEL_ID 未設定");
  Deno.exit(1);
}

let password = Deno.env.get("SUPABASE_DB_PASSWORD") ?? "";
if (!password) {
  const connStr = Deno.env.get("SUPABASE_DIRECT_CONNECTION_STRING") ?? "";
  const m = connStr.match(/^postgres(?:ql)?:\/\/[^:]+:([^@]+)@/);
  if (m) password = decodeURIComponent(m[1]);
}
if (!password) {
  console.error("[setup-prod-oa] ABORT: DB パスワード取得失敗");
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
  const existing = await sql`select id, name from public.oa_configs where line_channel_id = ${channelId}`;
  if (existing.length > 0) {
    console.log(`[setup-prod-oa] 既存 oa_config あり (id=${existing[0].id}, name=${existing[0].name}) — skip`);
  } else {
    const rows = await sql`
      insert into public.oa_configs (name, line_channel_id, admin_twitter_id, questions)
      values (${oaName}, ${channelId}, ${adminTwitterId}, '[]'::jsonb)
      returning id, name
    `;
    console.log(`[setup-prod-oa] oa_config 作成: OK (id=${rows[0].id}, name=${rows[0].name})`);
  }
  const all = await sql`select count(*)::int as n from public.oa_configs`;
  console.log(`[setup-prod-oa] oa_configs 合計: ${all[0].n} 件`);
} finally {
  await sql.end();
}
