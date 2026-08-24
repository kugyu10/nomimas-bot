/**
 * scripts/v11/set-test-event-window.ts
 * dev の検証イベント（v1.1ポーリング検証イベント / https://twipla.jp/events/741123）を
 * 「確認配信の窓の中／外」に1コマンドで動かす。
 *
 * なぜ必要か:
 *   このイベントには実 Twipla から取り込まれた参加者が1名おり、propagate_oa_links により
 *   line_user に自動紐付けされている（confirm_status='pending'）。
 *   窓の中に置いたままにすると、既存 cron `confirm-broadcast-daily`（毎日 10:00 JST）が
 *   その参加者に**実際の確認配信 LINE メッセージを送る**。
 *
 *   夜間の指示は「本人宛て1通のみ実送信」だったため、夜の終わりに `out` にして
 *   予定外の送信を止めてある。**朝、確認配信の実物を見たい場合は `in` に戻せばよい。**
 *
 * 使い方:
 *   set -a; source .env.local; set +a
 *
 *   # 窓の外へ（確認配信もポーリングも対象外にする＝何も起きない）
 *   deno run --allow-net --allow-read --allow-env --config deno.json \
 *     scripts/v11/set-test-event-window.ts out
 *
 *   # 窓の中へ（翌 10:00 JST の cron が本人に確認配信を送る。ポーリングも再開する）
 *   deno run --allow-net --allow-read --allow-env --config deno.json \
 *     scripts/v11/set-test-event-window.ts in
 *
 *   # 今の状態を見るだけ
 *   deno run --allow-net --allow-read --allow-env --config deno.json \
 *     scripts/v11/set-test-event-window.ts status
 *
 * このスクリプト自体は LINE メッセージを送らない。送るかどうかを決める「栓」を開け閉めするだけ。
 * 触るのは dev の events 1行の event_date のみ。participants は一切変更しない。
 */

import { connectDev } from "../db/sql.ts";

const TEST_URL = "https://twipla.jp/events/741123";

// 窓の外に出すときの日数。confirm_days_before(=7) と
// ポーリング cron の greatest(confirm_days_before, 3) の両方を確実に超える値にする。
const OUT_DAYS = 60;
// 窓の中に入れるときの日数（翌日 = 通知窓 diff<=2 の中）。
const IN_DAYS = 1;

const mode = (Deno.args[0] ?? "status").toLowerCase();
if (!["in", "out", "status"].includes(mode)) {
  console.error(`使い方: set-test-event-window.ts <in|out|status>（受け取った引数: ${mode}）`);
  Deno.exit(2);
}

const sql = connectDev();

try {
  const rows = await sql<
    { event_id: string; title: string; event_date: string; confirm_days_before: number }[]
  >`
    select e.id as event_id, e.title, e.event_date, e.confirm_days_before
    from public.events e
    join public.event_platform_urls epu on epu.event_id = e.id
    where epu.url = ${TEST_URL}
  `;

  if (rows.length === 0) {
    console.error(`検証イベントが見つかりません（url=${TEST_URL}）。既に片付けられている可能性があります。`);
    Deno.exit(1);
  }
  if (rows.length > 1) {
    console.error(`同じ url のイベントが ${rows.length} 件あります。手で確認してください（安全のため何もしません）。`);
    Deno.exit(1);
  }

  const ev = rows[0];

  // 現状の配信対象性を出す（窓の中/外を「日付」ではなく「実際に対象になるか」で示す）
  const targetsBefore = await sql<{ participant_id: string }[]>`
    select participant_id from public.get_confirm_targets(null)
    where event_id = ${ev.event_id}::uuid
  `;

  console.log(`イベント: "${ev.title}"`);
  console.log(`  event_date=${ev.event_date} confirm_days_before=${ev.confirm_days_before}`);
  console.log(`  今の確認配信(cronモード)の対象人数: ${targetsBefore.length}`);

  if (mode === "status") {
    console.log(
      targetsBefore.length > 0
        ? "状態: 窓の中。次の 10:00 JST の cron で本人に確認配信が送られます。止めるなら `out` を実行。"
        : "状態: 窓の外。確認配信は送られません。実物を見たいなら `in` を実行。",
    );
    Deno.exit(0);
  }

  const days = mode === "in" ? IN_DAYS : OUT_DAYS;

  // event_date のみ更新する。participants は触らない。
  await sql`
    update public.events
    set event_date = ((now() at time zone 'Asia/Tokyo')::date + ${days}::integer)
    where id = ${ev.event_id}::uuid
  `;

  const after = await sql<{ event_date: string }[]>`
    select event_date from public.events where id = ${ev.event_id}::uuid
  `;
  const targetsAfter = await sql<{ participant_id: string }[]>`
    select participant_id from public.get_confirm_targets(null)
    where event_id = ${ev.event_id}::uuid
  `;

  console.log(`\n更新後: event_date=${after[0]?.event_date}`);
  console.log(`  確認配信(cronモード)の対象人数: ${targetsAfter.length}`);

  if (mode === "out") {
    if (targetsAfter.length !== 0) {
      console.error(
        "警告: 窓の外に出したはずなのに、まだ確認配信の対象に残っています。手で確認してください。",
      );
      Deno.exit(1);
    }
    console.log(
      "OK: 窓の外に出しました。10:00 JST の確認配信も、15分ごとのポーリングも、" +
        "このイベントを対象にしません。",
    );
  } else {
    if (targetsAfter.length === 0) {
      console.error(
        "警告: 窓の中に入れたはずなのに、確認配信の対象になりません。" +
          "participants の confirm_status が 'pending' でない可能性があります（既に送信済みなど）。",
      );
      Deno.exit(1);
    }
    console.log(
      `OK: 窓の中に入れました。次の 10:00 JST（および catchup ジョブ）で` +
        ` ${targetsAfter.length} 名に確認配信が送られます。**これは実際の LINE 送信です。**`,
    );
  }
} finally {
  await sql.end();
}
