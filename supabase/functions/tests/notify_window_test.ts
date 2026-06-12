// notify/window.ts — todayJst() + isWithinNotifyWindow() 純関数 Unit Test
// TDD RED: window.ts 未実装の状態で fail することを確認する
// 実行: deno test --config supabase/functions/deno.json --allow-read supabase/functions/tests/notify_window_test.ts

import { assertEquals } from "jsr:@std/assert";
import { isWithinNotifyWindow, todayJst } from "../_shared/notify/window.ts";

// todayJst() が YYYY-MM-DD 形式を返す
Deno.test("todayJst: YYYY-MM-DD 形式を返す", () => {
  const today = todayJst();
  assertEquals(typeof today, "string");
  assertEquals(/^\d{4}-\d{2}-\d{2}$/.test(today), true, `Expected YYYY-MM-DD, got: ${today}`);
});

// ==================== 通知窓判定の境界ケース ====================

Deno.test("isWithinNotifyWindow: diff=0（当日）→ true（窓内）", () => {
  const today = "2026-06-13";
  assertEquals(isWithinNotifyWindow("2026-06-13", today), true);
});

Deno.test("isWithinNotifyWindow: diff=1（1日後）→ true（窓内）", () => {
  const today = "2026-06-13";
  assertEquals(isWithinNotifyWindow("2026-06-14", today), true);
});

Deno.test("isWithinNotifyWindow: diff=2（2日後）→ true（窓内 — 境界値）", () => {
  const today = "2026-06-13";
  assertEquals(isWithinNotifyWindow("2026-06-15", today), true);
});

Deno.test("isWithinNotifyWindow: diff=3（3日後）→ false（窓外 — 境界値）", () => {
  const today = "2026-06-13";
  assertEquals(isWithinNotifyWindow("2026-06-16", today), false);
});

Deno.test("isWithinNotifyWindow: diff=-1（前日=終了後）→ false（窓外）", () => {
  const today = "2026-06-13";
  assertEquals(isWithinNotifyWindow("2026-06-12", today), false);
});

Deno.test("isWithinNotifyWindow: eventDate null → false（窓外）", () => {
  const today = "2026-06-13";
  assertEquals(isWithinNotifyWindow(null, today), false);
});

Deno.test("isWithinNotifyWindow: diff=10（遠い将来）→ false（窓外）", () => {
  const today = "2026-06-13";
  assertEquals(isWithinNotifyWindow("2026-06-23", today), false);
});
