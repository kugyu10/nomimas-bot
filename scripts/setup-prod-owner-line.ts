/**
 * scripts/setup-prod-owner-line.ts
 * prod の oa_members.line_user_id（主催者通知の宛先）を埋める（Issue #4）
 *
 * LINE のイベントには「主催者かどうか」の情報が無いため、本人特定は人間が行う。
 *   1. 主催者が OA を友だち追加して一言送る（webhook が line_users に登録する）
 *   2. 引数なしで実行 → oa_members と line_users の一覧を表示（DB は変更しない）
 *   3. 一覧から対応を決め、--link を指定して実行 → 検証結果だけ表示（dry-run）
 *   4. --apply を付けると UPDATE する
 *
 * 使い方:
 *   set -a; source ./.env.prod; set +a
 *   deno run --allow-net --allow-env scripts/setup-prod-owner-line.ts
 *   deno run --allow-net --allow-env scripts/setup-prod-owner-line.ts \
 *     --link <oa_config_id>:<auth_user_id>:<line_user_id> [--apply]
 */

import postgres from "npm:postgres@3.4.9";
import {
  type LineUserRow,
  type MemberRow,
  parseCliArgs,
  planLinks,
} from "./lib/owner_line_link.ts";

const PROD_PROJECT_REF = "hgojtooexbknqotzkkja";
const POOLER_HOST = Deno.env.get("SUPABASE_POOLER_HOST") ||
  "aws-1-ap-northeast-1.pooler.supabase.com";

const ref = Deno.env.get("PROD_PROJECT_REF") ?? "";
if (ref !== PROD_PROJECT_REF) {
  console.error(`[setup-prod-owner-line] ABORT: PROD_PROJECT_REF='${ref}' !== '${PROD_PROJECT_REF}'`);
  Deno.exit(1);
}

const { requests, apply, errors: argErrors } = parseCliArgs(Deno.args);
if (argErrors.length > 0) {
  argErrors.forEach((e) => console.error(`[setup-prod-owner-line] ABORT: ${e}`));
  Deno.exit(1);
}

let password = Deno.env.get("SUPABASE_DB_PASSWORD") ?? "";
if (!password) {
  const connStr = Deno.env.get("SUPABASE_DIRECT_CONNECTION_STRING") ?? "";
  const m = connStr.match(/^postgres(?:ql)?:\/\/[^:]+:([^@]+)@/);
  if (m) password = decodeURIComponent(m[1]);
}
if (!password) {
  console.error("[setup-prod-owner-line] ABORT: DB パスワード取得失敗");
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
  const members = await sql<(MemberRow & { screen_name: string | null })[]>`
    select m.id, m.oa_config_id, m.auth_user_id, m.role, m.line_user_id,
           (select coalesce(i.identity_data->>'user_name', i.identity_data->>'preferred_username')
              from auth.identities i
             where i.user_id = m.auth_user_id and i.provider in ('x', 'twitter') limit 1) as screen_name
    from public.oa_members m
    order by m.oa_config_id, m.created_at
  `;
  const lineUsers = await sql<(LineUserRow & { display_name: string | null; created_at: Date })[]>`
    select oa_config_id, line_user_id, display_name, created_at
    from public.line_users
    order by oa_config_id, created_at desc
  `;

  if (requests.length === 0) {
    console.log("== oa_members ==");
    for (const m of members) {
      console.log(
        `oa=${m.oa_config_id} user=${m.auth_user_id} role=${m.role} x=@${m.screen_name ?? "?"} line=${m.line_user_id ?? "(未設定)"}`,
      );
    }
    console.log("== line_users（新しい順）==");
    for (const l of lineUsers) {
      console.log(
        `oa=${l.oa_config_id} line=${l.line_user_id} name=${l.display_name ?? ""} created=${l.created_at.toISOString()}`,
      );
    }
    console.log("\n対応を決めて --link <oa_config_id>:<auth_user_id>:<line_user_id> で再実行してください。");
  } else {
    const plan = planLinks(requests, members, lineUsers);
    plan.errors.forEach((e) => console.error(`[setup-prod-owner-line] NG ${e}`));
    if (plan.errors.length > 0) Deno.exit(1);

    for (const u of plan.updates) {
      const overwrite = u.current && u.current !== u.request.lineUserId ? " (上書き)" : "";
      console.log(
        `[setup-prod-owner-line] ${apply ? "UPDATE" : "dry-run"} member=${u.memberId} current=${u.current ?? "(未設定)"} -> new=${u.request.lineUserId}${overwrite}`,
      );
    }
    if (apply) {
      await sql.begin(async (tx) => {
        for (const u of plan.updates) {
          const rows = await tx`
            update public.oa_members set line_user_id = ${u.request.lineUserId}
             where id = ${u.memberId} and oa_config_id = ${u.request.oaConfigId}
            returning id`;
          if (rows.length !== 1) {
            throw new Error(`member=${u.memberId} の更新が ${rows.length} 件（ロールバック）`);
          }
        }
      });
      console.log(`[setup-prod-owner-line] ${plan.updates.length} 件更新しました`);
    } else {
      console.log("[setup-prod-owner-line] dry-run です。--apply で反映します。");
    }
  }
} finally {
  await sql.end();
}
