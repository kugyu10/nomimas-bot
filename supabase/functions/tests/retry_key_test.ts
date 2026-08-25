// deriveRetryKey: LINE の X-Line-Retry-Key を決定的に導出する純関数のテスト
//
// なぜこの性質が要るか:
//   message-sender は claim-then-send で push 失敗時に pending へ差し戻して再試行させる。
//   retry key が試行ごとに変わると LINE 側では別送信として受理され、
//   「実は届いていたのに再送した」場合に利用者へ2通届く。
//   同じ送信意図なら**必ず同じキー**であることが、その事故を防ぐ前提になっている。
//
// 実行: deno test --config supabase/functions/deno.json supabase/functions/tests/retry_key_test.ts

import { assertEquals, assertMatch, assertNotEquals } from "jsr:@std/assert";
import { deriveRetryKey } from "../_shared/line/retry_key.ts";

// LINE は16進 UUID 形式を要求する
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

Deno.test("deriveRetryKey: UUID 形式を返す", async () => {
  const key = await deriveRetryKey("confirm-initial", "p-1", "e-1");
  assertMatch(key, UUID_RE);
});

Deno.test("deriveRetryKey: 同じ入力なら必ず同じ値（決定的）", async () => {
  const a = await deriveRetryKey("confirm-initial", "p-1", "e-1");
  const b = await deriveRetryKey("confirm-initial", "p-1", "e-1");
  assertEquals(a, b, "同じ送信意図で違うキーが出ると重複配信の原因になる");
});

Deno.test("deriveRetryKey: participant が違えば違う値", async () => {
  const a = await deriveRetryKey("confirm-initial", "p-1", "e-1");
  const b = await deriveRetryKey("confirm-initial", "p-2", "e-1");
  assertNotEquals(a, b);
});

Deno.test("deriveRetryKey: event が違えば違う値", async () => {
  const a = await deriveRetryKey("confirm-initial", "p-1", "e-1");
  const b = await deriveRetryKey("confirm-initial", "p-1", "e-2");
  assertNotEquals(a, b);
});

Deno.test("deriveRetryKey: 用途が違えば違う値", async () => {
  const a = await deriveRetryKey("confirm-initial", "p-1", "e-1");
  const b = await deriveRetryKey("confirm-resend", "p-1", "e-1");
  assertNotEquals(a, b);
});

Deno.test("deriveRetryKey: 部品の境界が曖昧にならない（連結の取り違えを防ぐ）", async () => {
  // "ab" + "c" と "a" + "bc" が同じキーになってはいけない
  const a = await deriveRetryKey("ab", "c");
  const b = await deriveRetryKey("a", "bc");
  assertNotEquals(a, b);
});
