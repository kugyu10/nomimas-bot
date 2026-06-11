// 日時表示整形ヘルパー Unit Test（02-REVIEW CR-01対応）
// timestamptz の UTC ISO 入力が JST 表記に変換されることを検証する
// 実行: deno test --config supabase/functions/deno.json --allow-read supabase/functions/tests/confirm_format_test.ts

import { assertEquals } from "jsr:@std/assert";
import {
  formatEventDate,
  formatMeetingAt,
} from "../_shared/confirm/format.ts";

// ==================== formatMeetingAt ====================

Deno.test("formatMeetingAt: UTC ISO (09:00+00:00) → JST '6/15 18:00' に変換される（CR-01本体）", () => {
  // PostgREST が timestamptz を返す形式そのもの
  assertEquals(formatMeetingAt("2026-06-15T09:00:00+00:00"), "6/15 18:00");
});

Deno.test("formatMeetingAt: Zサフィックス UTC ISO も JST に変換される", () => {
  assertEquals(formatMeetingAt("2026-12-31T15:30:00Z"), "1/1 00:30");
});

Deno.test("formatMeetingAt: JST オフセット付き ISO はそのままの時刻表記になる", () => {
  assertEquals(formatMeetingAt("2026-06-15T18:00:00+09:00"), "6/15 18:00");
});

Deno.test("formatMeetingAt: null → null（行ごと省略）", () => {
  assertEquals(formatMeetingAt(null), null);
});

Deno.test("formatMeetingAt: パース不能な文字列 → null（誤読を招く生文字列を出さない）", () => {
  assertEquals(formatMeetingAt("not-a-date"), null);
});

// ==================== formatEventDate ====================

Deno.test("formatEventDate: 'YYYY-MM-DD' → 'YYYY年M月D日' に整形される", () => {
  assertEquals(formatEventDate("2026-06-15"), "2026年6月15日");
});

Deno.test("formatEventDate: null → null", () => {
  assertEquals(formatEventDate(null), null);
});

Deno.test("formatEventDate: パース不能な文字列 → raw のまま返す（情報を落とさない）", () => {
  assertEquals(formatEventDate("invalid"), "invalid");
});
