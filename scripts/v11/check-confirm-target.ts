/**
 * scripts/v11/check-confirm-target.ts
 * 合格条件1b: ポーリングで取り込まれた参加者が「最終確認の配信対象」になっていることを機械判定する。
 *
 * v1.1 のゴールは「Twiplaを自動ポーリングして変化を検知し、**直前参加者まで確認配信が届く**」。
 * 条件1（実ポーリングで保存できる／誤検知しない）だけでは、取り込んだ参加者が実際に
 * 配信対象として拾われるかは分からない。ここではその橋渡しを検証する:
 *
 *   1. テストイベント(741123)の participants に attending の行がある
 *   2. その行が line_users に紐付いている（propagate_oa_links による自動紐付けが効いている）
 *   3. get_confirm_targets(<event_id>) の戻り値にその participant が含まれる
 *      = 最終確認配信の cron/手動配信がこの人を対象として拾う
 *
 * SELECT のみ。何も送らない。何も書き換えない。
 *
 * 実行:
 *   set -a; source /Users/kugyu10/work/nomimas-bot/.env.local; set +a
 *   deno run --allow-net --allow-read --allow-env --config deno.json \
 *     scripts/v11/check-confirm-target.ts
 */

import { connectDev } from "../db/sql.ts";

const TEST_URL = "https://twipla.jp/events/741123";

const sql = connectDev();
let failed = false;
const fail = (msg: string) => {
  console.error(`  [NG] ${msg}`);
  failed = true;
};

try {
  // (1) テストイベントの event_platform_url を解決する
  const epu = await sql<{ id: string; event_id: string; title: string; event_date: string }[]>`
    select epu.id, epu.event_id, e.title, e.event_date
    from public.event_platform_urls epu
    join public.events e on e.id = epu.event_id
    where epu.url = ${TEST_URL}
  `;
  if (epu.length === 0) {
    fail(`${TEST_URL} が event_platform_urls に登録されていない（先に seed-dev-event.ts を実行せよ）`);
    throw new Error("no event");
  }
  const { id: epuId, event_id: eventId, title } = epu[0];
  console.log(`  対象イベント: "${title}" (event_id=${String(eventId).slice(0, 8)}…)`);

  // (2) attending の participants と紐付け状況
  const parts = await sql<
    { id: string; screen_name: string | null; status: string; confirm_status: string; linked: boolean }[]
  >`
    select p.id, p.screen_name, p.status, p.confirm_status,
           (p.line_user_id is not null) as linked
    from public.participants p
    where p.event_platform_url_id = ${epuId}
      and p.status = 'attending'
  `;
  if (parts.length === 0) {
    fail("attending の participants が0件（ポーリングで取り込めていない）");
  } else {
    console.log(`  attending participants: ${parts.length}件`);
    for (const p of parts) {
      console.log(
        `    screen_name=${p.screen_name} confirm_status=${p.confirm_status} linked=${p.linked}`,
      );
    }
  }

  const linked = parts.filter((p) => p.linked);
  if (linked.length === 0) {
    fail(
      "attending の participants が1件も line_users に紐付いていない" +
        "（propagate_oa_links が効いていない、または同一OAに screen_name 一致の既知紐付けが無い）",
    );
  }

  // (3) get_confirm_targets に含まれるか（手動モード = event_id 指定で窓を無視する）
  const targets = await sql<{ participant_id: string; event_title: string }[]>`
    select participant_id, event_title from public.get_confirm_targets(${eventId}::uuid)
  `;
  console.log(`  get_confirm_targets(event_id) の戻り: ${targets.length}件`);

  const targetIds = new Set(targets.map((t) => t.participant_id));
  const hit = linked.filter((p) => targetIds.has(p.id));
  if (hit.length === 0) {
    fail(
      "紐付け済み attending の participant が get_confirm_targets に1件も含まれない" +
        "（confirm_status が pending でない、または関数の条件に合致していない）",
    );
  }

  // (4) cron モード（引数 null = 全OA・窓内のみ）でも拾われるかを参考情報として出す。
  //     窓外なら0件になるのが正しい挙動であり、これは合否には含めない。
  const cronTargets = await sql<{ participant_id: string }[]>`
    select participant_id from public.get_confirm_targets(null)
  `;
  const inCronWindow = cronTargets.some((t) => targetIds.has(t.participant_id));
  console.log(
    `  参考: cronモード（窓内のみ）で拾われるか = ${inCronWindow}` +
      `（窓は event_date が confirm_days_before 日以内。窓外の false は異常ではない）`,
  );

  if (failed) {
    console.error("条件1b NG: 取り込んだ参加者が最終確認の配信対象になっていない");
    Deno.exit(1);
  }
  console.log(
    `条件1b OK: ポーリングで取り込んだ参加者 ${hit.length}件 が line_users に紐付き、` +
      `get_confirm_targets(event_id) の対象として拾われている（cronモード窓内=${inCronWindow}）`,
  );
} catch (err) {
  console.error(`条件1b NG: ${err instanceof Error ? err.message : String(err)}`);
  Deno.exit(1);
} finally {
  await sql.end();
}
