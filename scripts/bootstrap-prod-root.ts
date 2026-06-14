/**
 * scripts/bootstrap-prod-root.ts
 * prod の root ブートストラップ（初回 X ログイン後に1回だけ実行）
 *
 * - auth.users を列挙し screen_name（auth.identities の X provider）を表示
 * - 環境変数 ROOT_AUTH_USER_ID 指定時はその行のみ root_users に登録
 *   未指定で auth.users が1名のみなら、その1名を自動登録（冪等）
 *
 * 使い方:
 *   set -a; source ./.env.prod; set +a
 *   deno run --allow-net --allow-env scripts/bootstrap-prod-root.ts            # 一覧表示
 *   ROOT_AUTH_USER_ID=<uuid> deno run --allow-net --allow-env scripts/bootstrap-prod-root.ts  # 指定登録
 */

import postgres from "npm:postgres@3.4.9";

const PROD_PROJECT_REF = "hgojtooexbknqotzkkja";
const POOLER_HOST = Deno.env.get("SUPABASE_POOLER_HOST") ||
  "aws-1-ap-northeast-1.pooler.supabase.com";

const ref = Deno.env.get("PROD_PROJECT_REF") ?? "";
if (ref !== PROD_PROJECT_REF) {
  console.error(`[bootstrap-prod-root] ABORT: PROD_PROJECT_REF='${ref}' !== '${PROD_PROJECT_REF}'`);
  Deno.exit(1);
}

let password = Deno.env.get("SUPABASE_DB_PASSWORD") ?? "";
if (!password) {
  const connStr = Deno.env.get("SUPABASE_DIRECT_CONNECTION_STRING") ?? "";
  const m = connStr.match(/^postgres(?:ql)?:\/\/[^:]+:([^@]+)@/);
  if (m) password = decodeURIComponent(m[1]);
}
if (!password) {
  console.error("[bootstrap-prod-root] ABORT: DB パスワード取得失敗");
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
  // X identity の screen_name は user_name / preferred_username のどちらかに入る
  const users = await sql`
    select
      u.id,
      u.created_at,
      coalesce(
        i.identity_data->>'user_name',
        i.identity_data->>'preferred_username',
        i.identity_data->>'screen_name'
      ) as screen_name,
      i.provider
    from auth.users u
    left join auth.identities i on i.user_id = u.id
    order by u.created_at desc
  `;

  console.log(`[bootstrap-prod-root] auth.users: ${users.length} 件`);
  for (const u of users) {
    console.log(`  - id=${u.id} provider=${u.provider} screen_name=${u.screen_name} created=${u.created_at}`);
  }

  const target = Deno.env.get("ROOT_AUTH_USER_ID") ??
    (users.length === 1 ? users[0].id : "");

  if (!target) {
    console.log("[bootstrap-prod-root] 複数ユーザーがいます。ROOT_AUTH_USER_ID=<uuid> を指定して再実行してください。");
    Deno.exit(0);
  }

  await sql`insert into public.root_users (auth_user_id) values (${target}) on conflict (auth_user_id) do nothing`;
  const check = await sql`select auth_user_id from public.root_users where auth_user_id = ${target}`;
  console.log(`[bootstrap-prod-root] root_users 登録: ${check.length === 1 ? "OK" : "FAILED"} (auth_user_id=${target})`);
} finally {
  await sql.end();
}
