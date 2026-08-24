/**
 * scripts/v11/seed-dev-event.ts
 * dev Supabase に v1.1 ポーリング検証用のイベントを冪等に用意する。
 *
 * やること:
 *   1. oa_configs から `飲みmasDev`（id が ...0001 で終わる行）を解決する
 *   2. event_platform_urls に url=TARGET_URL の行が既にあれば、その event_id を使い回す
 *      （冪等の判定キー。無ければ新規に events + event_platform_urls を1行ずつ作る）
 *   3. event_date は毎回「今日(JST)の翌日」に更新する（通知窓に入れておくため）
 *   4. 既存の3件のダミーイベントには一切触らない（DELETE/TRUNCATE 禁止）
 *
 * 使い方:
 *   set -a; source /Users/kugyu10/work/nomimas-bot/.env.local; set +a
 *   deno run --allow-net --allow-read --allow-env scripts/v11/seed-dev-event.ts
 *
 * 出力:
 *   最後の行に `event_id=<uuid> event_platform_url_id=<uuid>` を1行で出す
 */

import { connectDev } from "../db/sql.ts";
import { EVENT_TITLE, jstDateString, OA_NAME, TARGET_URL } from "./lib.ts";

const sql = connectDev();

try {
  // -------------------------------------------------------------------------
  // (1) 対象 OA を解決
  // -------------------------------------------------------------------------
  const oaRows = await sql<{ id: string }[]>`
    select id from public.oa_configs where name = ${OA_NAME}
  `;
  if (oaRows.length === 0) {
    console.error(
      `[seed-dev-event] ABORT: oa_configs に name='${OA_NAME}' の行がありません`,
    );
    Deno.exit(1);
  }
  const oaConfigId = oaRows[0].id;

  const tomorrowJst = jstDateString(1);

  // -------------------------------------------------------------------------
  // (2) 冪等判定: event_platform_urls.url = TARGET_URL の行があるか
  // -------------------------------------------------------------------------
  const existingEpu = await sql<{ id: string; event_id: string }[]>`
    select id, event_id from public.event_platform_urls where url = ${TARGET_URL}
  `;

  let eventId: string;
  let eventPlatformUrlId: string;

  if (existingEpu.length > 0) {
    // 既存の event を使い回す（新規作成しない）
    eventId = existingEpu[0].event_id;
    eventPlatformUrlId = existingEpu[0].id;

    const updated = await sql<{ id: string }[]>`
      update public.events
      set event_date = ${tomorrowJst}
      where id = ${eventId}
      returning id
    `;
    if (updated.length === 0) {
      console.error(
        `[seed-dev-event] ABORT: event_platform_urls.event_id=${eventId} に対応する events 行が見つかりません`,
      );
      Deno.exit(1);
    }
    console.error(
      `[seed-dev-event] 既存イベントを再利用: event_id=${eventId} event_platform_url_id=${eventPlatformUrlId} event_date=${tomorrowJst}`,
    );
  } else {
    // 新規作成（既存3件のダミーには触らない）
    const insertedEvent = await sql<{ id: string }[]>`
      insert into public.events (oa_config_id, title, event_date)
      values (${oaConfigId}, ${EVENT_TITLE}, ${tomorrowJst})
      returning id
    `;
    eventId = insertedEvent[0].id;

    const insertedEpu = await sql<{ id: string }[]>`
      insert into public.event_platform_urls (event_id, platform, url)
      values (${eventId}, 'twipla', ${TARGET_URL})
      returning id
    `;
    eventPlatformUrlId = insertedEpu[0].id;

    console.error(
      `[seed-dev-event] 新規作成: event_id=${eventId} event_platform_url_id=${eventPlatformUrlId} event_date=${tomorrowJst}`,
    );
  }

  // 標準出力に1行で出す（他スクリプトから awk/grep で取り出しやすい形式）
  console.log(
    `event_id=${eventId} event_platform_url_id=${eventPlatformUrlId}`,
  );
} catch (err) {
  console.error("[seed-dev-event] 予期しないエラー:", err);
  Deno.exit(1);
} finally {
  await sql.end();
}
