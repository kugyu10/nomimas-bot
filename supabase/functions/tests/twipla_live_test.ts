// Twipla実URL統合テスト
// 実際のTwipla URLへのfetchを行い、参加者リストが取得できることを確認する
//
// デフォルトでは ignore される（WR-07対応 — 実ネットワーク依存のフレーキー化を防ぐ）。
// 実行するには環境変数 LIVE_TEST=1 を明示する（オプトイン）:
//   LIVE_TEST=1 deno test --config supabase/functions/deno.json --allow-env --allow-net=twipla.jp supabase/functions/tests/twipla_live_test.ts

import { assertEquals, assertGreater, assertExists } from "jsr:@std/assert";
import type { ScrapedParticipant } from "../_shared/providers/types.ts";
import { twiplaProvider } from "../_shared/providers/twipla.ts";

// --allow-env なしで実行された場合も例外にせず ignore 扱いにする
function liveTestEnabled(): boolean {
  try {
    return Deno.env.get("LIVE_TEST") === "1";
  } catch {
    return false;
  }
}

Deno.test({
  name: "live: twipla event 731057",
  ignore: !liveTestEnabled(),
  fn: async () => {
  const url = "https://twipla.jp/events/731057";
  const result = await twiplaProvider.fetchParticipants(url);

  // participants が1件以上取れること（実イベントは変動するため件数は固定しない）
  assertGreater(result.participants.length, 0, "participants.length > 0");

  // platform が "twipla" であること
  assertEquals(result.platform, "twipla", "platform === 'twipla'");

  // sourceUrl が引数と一致すること
  assertEquals(result.sourceUrl, url, "sourceUrl が url と一致");

  // fetchedAt が ISO8601 形式であること（Date.parseで検証）
  assertExists(result.fetchedAt, "fetchedAt が存在すること");
  const parsed = Date.parse(result.fetchedAt);
  assertEquals(isNaN(parsed), false, `fetchedAt が有効なISO8601: ${result.fetchedAt}`);

  // 全エントリの displayName が非空文字列であること
  for (const p of result.participants as ScrapedParticipant[]) {
    assertGreater(p.displayName.length, 0, `displayName が非空: got '${p.displayName}'`);
  }

  // attending が1件以上存在すること（サンプルイベントはオープン中）
  const attending = (result.participants as ScrapedParticipant[]).filter((p) => p.status === "attending");
  assertGreater(attending.length, 0, "attending participants > 0");

    console.log(`[live test] platform=${result.platform}, total=${result.participants.length}, attending=${attending.length}, capacity=${result.capacity}`);
  },
});
