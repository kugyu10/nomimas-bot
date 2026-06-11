// postback dataのエンコード/デコード Unit Test
// TDD RED: postback.ts が未実装の状態でfailすることを確認する
// 実行: deno test --config supabase/functions/deno.json --allow-read supabase/functions/tests/postback_data_test.ts

import { assertEquals, assertNotEquals, assertThrows } from "jsr:@std/assert";
import {
  encodePostbackData,
  decodePostbackData,
} from "../_shared/confirm/postback.ts";

const VALID_UUID = "550e8400-e29b-41d4-a716-446655440000";
const VALID_Q_ID = "q_age";
const VALID_OPT_IDX = 0;

Deno.test("encodePostbackData: encode→decode ラウンドトリップで全フィールドが一致する", () => {
  const encoded = encodePostbackData({
    participantId: VALID_UUID,
    questionId: VALID_Q_ID,
    optionIndex: VALID_OPT_IDX,
  });
  const decoded = decodePostbackData(encoded);

  assertEquals(decoded?.participantId, VALID_UUID);
  assertEquals(decoded?.questionId, VALID_Q_ID);
  assertEquals(decoded?.optionIndex, VALID_OPT_IDX);
});

Deno.test("encodePostbackData: URLSearchParams p=&q=&a= 形式で、uuid+短いid+1桁indexなら100字未満", () => {
  const encoded = encodePostbackData({
    participantId: VALID_UUID,
    questionId: VALID_Q_ID,
    optionIndex: 1,
  });

  // URLSearchParams 形式に p= q= a= が含まれる
  assertEquals(encoded.includes("p="), true, "p= が含まれる");
  assertEquals(encoded.includes("q="), true, "q= が含まれる");
  assertEquals(encoded.includes("a="), true, "a= が含まれる");

  // uuid(36) + question_id(5) + index(1) + keys(6) + & x2 = 約50字 → 100字未満
  assertEquals(encoded.length < 100, true, `エンコード結果が100字未満であること: ${encoded.length}字`);
});

Deno.test("encodePostbackData: optionIndex が異なれば結果も異なる", () => {
  const enc0 = encodePostbackData({ participantId: VALID_UUID, questionId: VALID_Q_ID, optionIndex: 0 });
  const enc1 = encodePostbackData({ participantId: VALID_UUID, questionId: VALID_Q_ID, optionIndex: 1 });
  assertNotEquals(enc0, enc1, "optionIndex が違えば encode 結果も違う");
});

Deno.test("encodePostbackData: 合計が300字を超える questionId を渡すと throw する", () => {
  const longQId = "q".repeat(270); // uuid(36) + 270 + a=N + keys → 300字超
  assertThrows(
    () => encodePostbackData({ participantId: VALID_UUID, questionId: longQId, optionIndex: 0 }),
    Error,
    undefined,
    "300字超のquestionIdでErrorがthrowされること",
  );
});

Deno.test("decodePostbackData: pが非uuid文字列 → null を返す（throwしない）", () => {
  const data = new URLSearchParams({ p: "not-a-uuid", q: VALID_Q_ID, a: "0" }).toString();
  const result = decodePostbackData(data);
  assertEquals(result, null, "非uuid pに対してnullが返る");
});

Deno.test("decodePostbackData: qが空文字 → null を返す", () => {
  const data = new URLSearchParams({ p: VALID_UUID, q: "", a: "0" }).toString();
  const result = decodePostbackData(data);
  assertEquals(result, null, "空のqに対してnullが返る");
});

Deno.test("decodePostbackData: aが非整数文字列 → null を返す", () => {
  const data = new URLSearchParams({ p: VALID_UUID, q: VALID_Q_ID, a: "abc" }).toString();
  const result = decodePostbackData(data);
  assertEquals(result, null, "非整数aに対してnullが返る");
});

Deno.test("decodePostbackData: aが負数 → null を返す", () => {
  const data = new URLSearchParams({ p: VALID_UUID, q: VALID_Q_ID, a: "-1" }).toString();
  const result = decodePostbackData(data);
  assertEquals(result, null, "負数aに対してnullが返る");
});

Deno.test("decodePostbackData: キー欠損（pがない） → null を返す", () => {
  const data = new URLSearchParams({ q: VALID_Q_ID, a: "0" }).toString();
  const result = decodePostbackData(data);
  assertEquals(result, null, "pキー欠損でnullが返る");
});

Deno.test("decodePostbackData: キー欠損（qがない） → null を返す", () => {
  const data = new URLSearchParams({ p: VALID_UUID, a: "0" }).toString();
  const result = decodePostbackData(data);
  assertEquals(result, null, "qキー欠損でnullが返る");
});

Deno.test("decodePostbackData: キー欠損（aがない） → null を返す", () => {
  const data = new URLSearchParams({ p: VALID_UUID, q: VALID_Q_ID }).toString();
  const result = decodePostbackData(data);
  assertEquals(result, null, "aキー欠損でnullが返る");
});

Deno.test("decodePostbackData: 完全な無関係文字列 → null を返す（throwしない）", () => {
  const result = decodePostbackData("totally-invalid-string!!!");
  assertEquals(result, null, "無関係文字列でnullが返る");
});

Deno.test("decodePostbackData: 空文字列 → null を返す", () => {
  const result = decodePostbackData("");
  assertEquals(result, null, "空文字列でnullが返る");
});
