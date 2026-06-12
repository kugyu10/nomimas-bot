/**
 * scripts/setup-dev.ts
 * dev 環境セットアップスクリプト（冪等・env 読み・値はコミットしない）
 *
 * 実行内容:
 *   1. Vault に project_url / cron_function_key / cron_shared_secret を投入（冪等: delete → create）
 *      - cron_function_key: anonキー（ゲートウェイJWT通過用 Authorization）
 *      - cron_shared_secret: 専用シークレット CRON_FUNCTION_KEY（WR-01: x-cron-key 照合用）
 *   2. oa_configs.line_channel_id を dev-oa 行に設定（webhookのOA解決用）
 *   3. モックユーザー3名を冪等作成（GoTrue admin REST API経由）
 *      - dev-owner-1@nomimas.test（user_name='dev_owner_x'）: dev-oa の owner
 *      - dev-owner-2@nomimas.test: dev-oa-2 の owner + dev-oa の co-owner
 *      - dev-root@nomimas.test: root 権限テストユーザー（Phase 4 追加）
 *   4. oa_members を投入（モックユーザー作成後。on conflict do nothing で冪等）
 *      - user1 → oa_config ...0001 role 'owner'
 *      - user2 → oa_config ...0011 role 'owner'
 *      - user2 → oa_config ...0001 role 'co-owner'（成功条件6の co-owner ロール検証用）
 *   5. Phase 4 拡張（冪等）:
 *      - dev-root を root_users へ insert on conflict do nothing（service role 経由）
 *      - user1 の oa_members 行（dev-oa owner）に line_user_id を UPDATE
 *        （E2E 通知先。user2 は null のまま残す — skipped_no_line_id 経路の検証用）
 *
 * 使い方:
 *   set -a; source /Users/kugyu10/work/nomimas-bot/env.dev; set +a
 *   deno run --allow-net --allow-read --allow-env scripts/setup-dev.ts
 *
 * 必須環境変数（env.dev）:
 *   SUPABASE_ANON_KEY, LINE_CHANNEL_ID, CRON_FUNCTION_KEY,
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, MOCK_USER_PASSWORD
 */

import { connectDev } from "./db/sql.ts";

const ref = Deno.env.get("DEV_PROJECT_REF") ?? "";
const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const channelId = Deno.env.get("LINE_CHANNEL_ID") ?? "";
const cronFunctionKey = Deno.env.get("CRON_FUNCTION_KEY") ?? "";
const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const mockUserPassword = Deno.env.get("MOCK_USER_PASSWORD") ?? "";

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
if (!supabaseUrl) {
  console.error("[setup-dev] ABORT: SUPABASE_URL が設定されていません（env.dev を確認してください）");
  Deno.exit(1);
}
if (!serviceRoleKey) {
  console.error("[setup-dev] ABORT: SUPABASE_SERVICE_ROLE_KEY が設定されていません（env.dev を確認してください）");
  Deno.exit(1);
}
if (!mockUserPassword) {
  console.error(
    "[setup-dev] ABORT: MOCK_USER_PASSWORD が設定されていません。\n" +
    "  env.dev に以下を追記してください:\n" +
    "    MOCK_USER_PASSWORD=<ランダムなパスワード>\n" +
    "  生成例: openssl rand -base64 18",
  );
  Deno.exit(1);
}

// =============================================================
// GoTrue admin REST API ヘルパー（サービスロールキーを使用 — スクリプト領域のみ）
// T-03-04: サービスロールキーはログ出力・コミット禁止
// =============================================================

const ADMIN_HEADERS = {
  "Content-Type": "application/json",
  "apikey": serviceRoleKey,
  "Authorization": `Bearer ${serviceRoleKey}`,
};

/**
 * モックユーザーを冪等に作成する。
 * 既存のユーザー（422/email_exists）の場合は GET で既存 id を取得して返す。
 */
async function ensureUser(email: string, userMetadata: Record<string, string>): Promise<string> {
  // まずユーザー作成を試みる
  const createRes = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
    method: "POST",
    headers: ADMIN_HEADERS,
    body: JSON.stringify({
      email,
      password: mockUserPassword,
      email_confirm: true,
      user_metadata: userMetadata,
    }),
  });

  if (createRes.ok) {
    const data = await createRes.json();
    console.log(`[setup-dev] ユーザー作成: OK (${email}, id=${data.id})`);
    return data.id;
  }

  const errBody = await createRes.json().catch(() => ({}));
  const errMsg = (errBody as { msg?: string; message?: string }).msg ||
    (errBody as { msg?: string; message?: string }).message || "";

  // email_exists（422）の場合は既存ユーザーを取得
  if (createRes.status === 422 && (errMsg.includes("already") || errMsg.includes("email"))) {
    const listRes = await fetch(
      `${supabaseUrl}/auth/v1/admin/users?email=${encodeURIComponent(email)}`,
      { headers: ADMIN_HEADERS },
    );
    if (!listRes.ok) {
      throw new Error(`既存ユーザーの取得に失敗しました: ${await listRes.text()}`);
    }
    const listData = await listRes.json();
    // レスポンス形式: { users: [...] } または直接配列
    const users = Array.isArray(listData) ? listData : (listData.users ?? []);
    const existing = users.find((u: { email: string }) => u.email === email);
    if (!existing) {
      throw new Error(`ユーザー ${email} が見つかりませんでした（list response: ${JSON.stringify(listData)}）`);
    }
    console.log(`[setup-dev] ユーザー既存確認: OK (${email}, id=${existing.id})`);
    return existing.id;
  }

  throw new Error(`ユーザー作成失敗 (${email}): ${createRes.status} ${JSON.stringify(errBody)}`);
}

const sql = connectDev();

try {
  // =============================================================
  // 1. Vault シークレット投入
  // =============================================================
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

  // =============================================================
  // 2. oa_configs.line_channel_id 更新
  // =============================================================
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

  // =============================================================
  // 3. モックユーザー3名を冪等作成（Phase 4: root ユーザー追加）
  // T-03-04: パスワード・serviceRoleKey はログ出力しない
  // =============================================================
  console.log("[setup-dev] モックユーザー作成を開始します...");

  const user1Id = await ensureUser("dev-owner-1@nomimas.test", { user_name: "dev_owner_x" });
  const user2Id = await ensureUser("dev-owner-2@nomimas.test", { user_name: "dev_owner_2" });
  const rootUserId = await ensureUser("dev-root@nomimas.test", { user_name: "dev_root" });

  // =============================================================
  // 4. oa_members 投入（IN-05 FK のため auth.users 作成後に実行）
  //    on conflict (oa_config_id, auth_user_id) do nothing で冪等
  // =============================================================
  console.log("[setup-dev] oa_members 投入を開始します...");

  const OA1_ID = "00000000-0000-0000-0000-000000000001";
  const OA2_ID = "00000000-0000-0000-0000-000000000011";

  // user1 → dev-oa (owner)
  await sql`
    insert into public.oa_members (oa_config_id, auth_user_id, role)
    values (${OA1_ID}, ${user1Id}, 'owner')
    on conflict (oa_config_id, auth_user_id) do nothing
  `;
  console.log(`[setup-dev] oa_members: user1 → dev-oa (owner): OK`);

  // user2 → dev-oa-2 (owner)
  await sql`
    insert into public.oa_members (oa_config_id, auth_user_id, role)
    values (${OA2_ID}, ${user2Id}, 'owner')
    on conflict (oa_config_id, auth_user_id) do nothing
  `;
  console.log(`[setup-dev] oa_members: user2 → dev-oa-2 (owner): OK`);

  // user2 → dev-oa (co-owner)（成功条件6のco-ownerロール検証用）
  await sql`
    insert into public.oa_members (oa_config_id, auth_user_id, role)
    values (${OA1_ID}, ${user2Id}, 'co-owner')
    on conflict (oa_config_id, auth_user_id) do nothing
  `;
  console.log(`[setup-dev] oa_members: user2 → dev-oa (co-owner): OK`);

  const memberCount = await sql`select count(*) from public.oa_members`;
  console.log(`[setup-dev] oa_members 合計: ${memberCount[0].count} 行`);

  // =============================================================
  // 5. Phase 4: root_users 投入 + user1 の oa_members.line_user_id 設定
  // root 登録経路は service role のみ（authenticated に INSERT 経路を与えない — T-04-01）
  // line_user_id は dev 用架空値（公開リポジトリ安全な固定値 — seed line_users と同流儀）
  // =============================================================
  console.log("[setup-dev] Phase 4: root_users + line_user_id 設定を開始します...");

  // root_users への投入（service role = sql 接続。on conflict do nothing で冪等）
  await sql`
    insert into public.root_users (auth_user_id)
    values (${rootUserId})
    on conflict (auth_user_id) do nothing
  `;
  console.log(`[setup-dev] root_users: dev-root 投入: OK (auth_user_id=${rootUserId})`);

  // user1（dev-owner-1 / oa ...0001 の owner 行）に line_user_id を設定（E2E 通知先）
  // user2 は null のまま残す（skipped_no_line_id 経路の E2E 検証用 — 変更しない）
  const lineUserIdUpdated = await sql`
    update public.oa_members
    set line_user_id = 'U00000000000000000000000000ownr1'
    where auth_user_id = ${user1Id}
      and oa_config_id = ${OA1_ID}
      and role = 'owner'
    returning id
  `;
  if (lineUserIdUpdated.length > 0) {
    console.log(`[setup-dev] oa_members.line_user_id (user1 dev-oa owner): OK`);
  } else {
    console.error("[setup-dev] WARN: user1 の dev-oa owner 行が見つかりません（oa_members 投入後に再実行してください）");
  }

  const rootCount = await sql`select count(*) from public.root_users`;
  console.log(`[setup-dev] root_users 合計: ${rootCount[0].count} 行`);

  const lineUserCount = await sql`select count(*) from public.oa_members where line_user_id is not null`;
  console.log(`[setup-dev] oa_members.line_user_id 非null 合計: ${lineUserCount[0].count} 行`);

  console.log("[setup-dev] セットアップ完了");
} catch (err) {
  console.error("[setup-dev] エラー:", err);
  Deno.exit(1);
} finally {
  await sql.end();
}
