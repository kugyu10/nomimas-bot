/**
 * scripts/v11/check-no-duplicate-confirm.ts
 * 確認配信を高頻度で走らせても**二重送信にならない**ことを SQL で実証する。何も送らない。
 *
 * なぜ必要か:
 *   当日参加者の取りこぼしを塞ぐため `confirm-broadcast-catchup`
 *   （'*/30 0-12 * * *' UTC = JST 09:00〜21:59 の30分ごと）を追加した。
 *   配信の起動頻度を 1日1回から30分ごとに上げる変更なので、
 *   「同じ参加者に何度も送らないこと」が構造的に保証されているかを機械的に確かめる必要がある。
 *
 * 保証の仕組み（これを検証する）:
 *   - get_confirm_targets は confirm_status='pending' の行だけを返す
 *     （supabase/migrations/20260612120000_setup_cron_and_targets.sql:54,86）
 *   - message-sender は push 成功直後に confirm_status='sent' に更新する
 *     （supabase/functions/message-sender/index.ts:373-382）
 *   → 一度送られた参加者は次回以降 pending でないため対象から外れる
 *
 * 判定:
 *   (1) get_confirm_targets(null) が返す participant は全員 confirm_status='pending'
 *   (2) confirm_status <> 'pending' の participant は1人も戻りに含まれない
 *   (3) (2) を空振りさせないため、dev に confirm_status<>'pending' の participant が
 *       実際に存在することを確認する（0件なら (2) は何も証明していない）
 *
 * 実行:
 *   set -a; source .env.local; set +a
 *   deno run --allow-net --allow-read --allow-env --config deno.json \
 *     scripts/v11/check-no-duplicate-confirm.ts
 */

import { connectDev } from "../db/sql.ts";

const sql = connectDev();
let failed = false;
const fail = (msg: string) => {
  console.error(`  [NG] ${msg}`);
  failed = true;
};

try {
  // cron モード（引数 null）= 実際に catchup / daily ジョブが対象にする集合
  const targets = await sql<{ participant_id: string }[]>`
    select participant_id from public.get_confirm_targets(null)
  `;
  const targetIds = targets.map((t) => t.participant_id);
  console.log(`  get_confirm_targets(null) の対象: ${targetIds.length}件`);

  // (1) 対象は全員 pending か
  if (targetIds.length > 0) {
    const notPending = await sql<{ id: string; confirm_status: string }[]>`
      select id, confirm_status from public.participants
      where id = any(${targetIds}::uuid[]) and confirm_status <> 'pending'
    `;
    if (notPending.length > 0) {
      fail(
        `配信対象に confirm_status が pending でない参加者が ${notPending.length}件 含まれる` +
          `（${notPending.map((r) => r.confirm_status).join(",")}）— 二重送信の危険がある`,
      );
    } else {
      console.log("  [OK] 対象は全員 confirm_status='pending'");
    }
  } else {
    console.log("  対象0件（窓内に pending の紐付け済み参加者が居ない状態）");
  }

  // (3) 空振り防止: 送信済み相当の参加者が実在するか
  const sentLike = await sql<{ id: string; confirm_status: string }[]>`
    select id, confirm_status from public.participants
    where confirm_status <> 'pending'
  `;
  console.log(
    `  confirm_status<>'pending' の参加者: ${sentLike.length}件` +
      `（${[...new Set(sentLike.map((r) => r.confirm_status))].join(",") || "なし"}）`,
  );
  if (sentLike.length === 0) {
    fail(
      "confirm_status<>'pending' の参加者が1件も無いため、(2) の検査は何も証明していない" +
        "（空振り）。送信済み参加者が存在する状態で検証する必要がある",
    );
  }

  // (2) 送信済みが対象に混ざっていないか
  const targetSet = new Set(targetIds);
  const leaked = sentLike.filter((r) => targetSet.has(r.id));
  if (leaked.length > 0) {
    fail(
      `confirm_status<>'pending' の参加者 ${leaked.length}件 が配信対象に含まれている` +
        "— 高頻度で走らせると二重送信になる",
    );
  } else if (sentLike.length > 0) {
    console.log(
      `  [OK] confirm_status<>'pending' の ${sentLike.length}件 はいずれも配信対象に含まれない`,
    );
  }

  if (failed) {
    console.error("二重送信チェック NG: 配信頻度を上げるのは安全でない");
    Deno.exit(1);
  }
  console.log(
    `二重送信チェック OK: 配信対象 ${targetIds.length}件 は全員 pending、` +
      `送信済み ${sentLike.length}件 は対象外（頻度を上げても同じ参加者に再送されない）`,
  );
} catch (err) {
  console.error(`二重送信チェック NG: ${err instanceof Error ? err.message : String(err)}`);
  Deno.exit(1);
} finally {
  await sql.end();
}
