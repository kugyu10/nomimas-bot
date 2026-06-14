/**
 * scripts/import-prod-line-followers.ts
 * prod の既存LINE友だちを line_users に一括投入（webhook follow を待たずに取り込む）
 *
 * 背景: line_users は webhook の follow イベントでのみ登録される。webhook 登録前から
 *       友だちだった人は follow が飛ばないため、紐付け候補に出てこない。
 *       LINE の getFollowerIds + getProfile で既存友だちを取得して upsert する。
 *
 * 注意: getFollowerIds は「認証済み(verified)/プレミアムOA」限定。未認証OAは 403。
 *       403 の場合はこの方法は使えない（友だちに再追加 or メッセージ送信で登録する代替へ）。
 *
 * 使い方:
 *   set -a; source ./.env.prod; set +a
 *   deno run --allow-net --allow-env scripts/import-prod-line-followers.ts
 */

import postgres from "npm:postgres@3.4.9";

const PROD_PROJECT_REF = "hgojtooexbknqotzkkja";
const POOLER_HOST = Deno.env.get("SUPABASE_POOLER_HOST") ||
  "aws-1-ap-northeast-1.pooler.supabase.com";

const ref = Deno.env.get("PROD_PROJECT_REF") ?? "";
const channelId = Deno.env.get("LINE_CHANNEL_ID") ?? "";
const channelSecret = Deno.env.get("LINE_CHANNEL_SECRET") ?? "";

if (ref !== PROD_PROJECT_REF) {
  console.error(`[import-followers] ABORT: PROD_PROJECT_REF='${ref}' !== '${PROD_PROJECT_REF}'`);
  Deno.exit(1);
}
if (!channelId || !channelSecret) {
  console.error("[import-followers] ABORT: LINE_CHANNEL_ID / LINE_CHANNEL_SECRET 未設定");
  Deno.exit(1);
}

let password = Deno.env.get("SUPABASE_DB_PASSWORD") ?? "";
if (!password) {
  const connStr = Deno.env.get("SUPABASE_DIRECT_CONNECTION_STRING") ?? "";
  const m = connStr.match(/^postgres(?:ql)?:\/\/[^:]+:([^@]+)@/);
  if (m) password = decodeURIComponent(m[1]);
}
if (!password) {
  console.error("[import-followers] ABORT: DB パスワード取得失敗");
  Deno.exit(1);
}

// 1. ステートレストークン発行
async function issueToken(): Promise<string> {
  const res = await fetch("https://api.line.me/oauth2/v3/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: channelId,
      client_secret: channelSecret,
    }),
  });
  if (!res.ok) throw new Error(`token issue failed: ${res.status}`);
  const j = await res.json();
  if (typeof j.access_token !== "string" || !j.access_token) throw new Error("malformed token");
  return j.access_token;
}

const token = await issueToken();
console.log("[import-followers] トークン発行: OK");

// 2. フォロワーID取得（ページング）
const userIds: string[] = [];
let next: string | undefined = undefined;
do {
  const url = new URL("https://api.line.me/v2/bot/followers/ids");
  url.searchParams.set("limit", "1000");
  if (next) url.searchParams.set("start", next);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 403) {
    console.error(
      "[import-followers] 403: getFollowerIds は認証済み/プレミアムOA限定です。" +
        "このOAでは使えません。代替（友だちにメッセージ送信→message登録 or 再追加）に切り替えてください。",
    );
    Deno.exit(2);
  }
  if (!res.ok) {
    console.error(`[import-followers] followers/ids 失敗: ${res.status}`);
    Deno.exit(1);
  }
  const j = await res.json();
  for (const id of (j.userIds ?? [])) userIds.push(id);
  next = j.next;
} while (next);

console.log(`[import-followers] フォロワー数: ${userIds.length}`);
if (userIds.length === 0) {
  console.log("[import-followers] 友だちが0件です。終了。");
  Deno.exit(0);
}

// 3. DB 接続 + oa_config_id 解決
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
  const oa = await sql`select id from public.oa_configs where line_channel_id = ${channelId} limit 1`;
  if (oa.length === 0) {
    console.error(`[import-followers] ABORT: line_channel_id=${channelId} の oa_config が見つかりません`);
    Deno.exit(1);
  }
  const oaId = oa[0].id;
  console.log(`[import-followers] 対象 oa_config_id=${oaId}`);

  // 4. プロフィール取得 → upsert
  let imported = 0;
  for (const uid of userIds) {
    let displayName: string | null = null;
    try {
      const pres = await fetch(`https://api.line.me/v2/bot/profile/${uid}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (pres.ok) {
        const p = await pres.json();
        displayName = typeof p.displayName === "string" ? p.displayName : null;
      }
    } catch { /* プロフィール取得失敗は表示名なしで継続 */ }

    // follow ハンドラと同じ upsert（表示名は取れた時のみ更新）
    if (displayName != null) {
      await sql`
        insert into public.line_users (oa_config_id, line_user_id, display_name, followed_at)
        values (${oaId}, ${uid}, ${displayName}, now())
        on conflict (oa_config_id, line_user_id)
        do update set display_name = excluded.display_name
      `;
    } else {
      await sql`
        insert into public.line_users (oa_config_id, line_user_id, followed_at)
        values (${oaId}, ${uid}, now())
        on conflict (oa_config_id, line_user_id) do nothing
      `;
    }
    imported++;
  }
  console.log(`[import-followers] line_users upsert: ${imported} 件`);
  const total = await sql`select count(*)::int as n from public.line_users where oa_config_id = ${oaId}`;
  console.log(`[import-followers] line_users 合計(このOA): ${total[0].n} 件`);
} finally {
  await sql.end();
}
