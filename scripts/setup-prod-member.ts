/**
 * scripts/setup-prod-member.ts
 * prod の oa_members owner 登録（admin_twitter_id と X identity screen_name を照合）
 *
 * register_owner_by_identity() と同じ照合を service role 側で行い、
 * 該当ユーザーを各 OA の owner に登録する（冪等）。再ログイン待ちなしで解錠する用途。
 *
 * 使い方:
 *   set -a; source ./.env.prod; set +a
 *   deno run --allow-net --allow-env scripts/setup-prod-member.ts
 */

import postgres from "npm:postgres@3.4.9";

const PROD_PROJECT_REF = "hgojtooexbknqotzkkja";
const POOLER_HOST = Deno.env.get("SUPABASE_POOLER_HOST") ||
  "aws-1-ap-northeast-1.pooler.supabase.com";

const ref = Deno.env.get("PROD_PROJECT_REF") ?? "";
if (ref !== PROD_PROJECT_REF) {
  console.error(`[setup-prod-member] ABORT: PROD_PROJECT_REF='${ref}' !== '${PROD_PROJECT_REF}'`);
  Deno.exit(1);
}

let password = Deno.env.get("SUPABASE_DB_PASSWORD") ?? "";
if (!password) {
  const connStr = Deno.env.get("SUPABASE_DIRECT_CONNECTION_STRING") ?? "";
  const m = connStr.match(/^postgres(?:ql)?:\/\/[^:]+:([^@]+)@/);
  if (m) password = decodeURIComponent(m[1]);
}
if (!password) {
  console.error("[setup-prod-member] ABORT: DB パスワード取得失敗");
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
  // register_owner_by_identity と同じ照合（screen_name = user_name|preferred_username、両辺 lower、カンマ分割）
  const rows = await sql`
    insert into public.oa_members (oa_config_id, auth_user_id, role)
    select c.id, u.id, 'owner'
    from public.oa_configs c
    join auth.identities i
      on i.provider in ('x', 'twitter')
      and lower(coalesce(i.identity_data->>'user_name', i.identity_data->>'preferred_username', '')) = any(
        string_to_array(lower(coalesce(c.admin_twitter_id, '')), ',')
      )
    join auth.users u on u.id = i.user_id
    where coalesce(c.admin_twitter_id, '') <> ''
    on conflict (oa_config_id, auth_user_id) do nothing
    returning oa_config_id, auth_user_id, role
  `;
  console.log(`[setup-prod-member] 登録した owner 行: ${rows.length}`);
  for (const r of rows) {
    console.log(`  - oa_config_id=${r.oa_config_id} auth_user_id=${r.auth_user_id} role=${r.role}`);
  }
  const total = await sql`select count(*)::int as n from public.oa_members`;
  console.log(`[setup-prod-member] oa_members 合計: ${total[0].n} 件`);
} finally {
  await sql.end();
}
