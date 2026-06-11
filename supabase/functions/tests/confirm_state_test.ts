// ステートマシン transition() 純関数 Unit Test
// TDD RED: state.ts が未実装の状態でfailすることを確認する
// 実行: deno test --config supabase/functions/deno.json --allow-read supabase/functions/tests/confirm_state_test.ts

import { assertEquals } from "jsr:@std/assert";
import { transition } from "../_shared/confirm/state.ts";
import type { ConfirmStatus } from "../_shared/confirm/state.ts";

// 定型3問フィクスチャ（年齢確認・飲酒有無・遅刻早退予定）
const QUESTIONS = [
  {
    id: "q_age",
    text: "年齢確認: 20歳以上ですか？",
    options: ["20歳以上です", "未成年です"],
  },
  {
    id: "q_drink",
    text: "飲酒しますか？",
    options: ["飲む", "飲まない"],
  },
  {
    id: "q_late",
    text: "遅刻・早退の予定はありますか？",
    options: ["なし", "遅刻予定", "早退予定"],
  },
];

// ヘルパー: 指定のstatusとindexを持つcurrent
function current(status: ConfirmStatus, index: number) {
  return { status, index };
}

// ==================== 正常遷移 ====================

Deno.test("transition: sent + Q0への正答 → in_progress / index=1 / answer記録 / reply=next_question", () => {
  const result = transition(
    current("sent", 0),
    QUESTIONS,
    { questionId: "q_age", optionIndex: 0 },
  );

  assertEquals(result.nextStatus, "in_progress");
  assertEquals(result.nextIndex, 1);
  assertEquals(result.answer?.questionId, "q_age");
  assertEquals(result.answer?.questionText, QUESTIONS[0].text);
  assertEquals(result.answer?.answer, "20歳以上です");
  assertEquals(result.reply, "next_question");
});

Deno.test("transition: in_progress(index=1) + Q1正答 → in_progress / index=2 / reply=next_question", () => {
  const result = transition(
    current("in_progress", 1),
    QUESTIONS,
    { questionId: "q_drink", optionIndex: 1 },
  );

  assertEquals(result.nextStatus, "in_progress");
  assertEquals(result.nextIndex, 2);
  assertEquals(result.answer?.questionId, "q_drink");
  assertEquals(result.answer?.questionText, QUESTIONS[1].text);
  assertEquals(result.answer?.answer, "飲まない");
  assertEquals(result.reply, "next_question");
});

Deno.test("transition: in_progress(index=2) + 最終Q正答 → completed / index=3 / reply=completion", () => {
  const result = transition(
    current("in_progress", 2),
    QUESTIONS,
    { questionId: "q_late", optionIndex: 0 },
  );

  assertEquals(result.nextStatus, "completed");
  assertEquals(result.nextIndex, 3);
  assertEquals(result.answer?.questionId, "q_late");
  assertEquals(result.answer?.questionText, QUESTIONS[2].text);
  assertEquals(result.answer?.answer, "なし");
  assertEquals(result.reply, "completion");
});

// ==================== 境界ケース ====================

Deno.test("transition: 1問のみの配列で sent + Q0正答 → 即 completed（境界）", () => {
  const singleQuestion = [QUESTIONS[0]];
  const result = transition(
    current("sent", 0),
    singleQuestion,
    { questionId: "q_age", optionIndex: 1 },
  );

  assertEquals(result.nextStatus, "completed");
  assertEquals(result.nextIndex, 1);
  assertEquals(result.answer?.answer, "未成年です");
  assertEquals(result.reply, "completion");
});

// ==================== 再タップ・冪等性 ====================

Deno.test("transition: 過去質問の再タップ(in_progress index=2 で Q0のpostback) → answer記録/index不変/status不変/reply=reprompt", () => {
  const result = transition(
    current("in_progress", 2),
    QUESTIONS,
    { questionId: "q_age", optionIndex: 0 }, // 過去質問
  );

  assertEquals(result.nextStatus, "in_progress"); // 状態不変
  assertEquals(result.nextIndex, 2);              // index不変
  assertEquals(result.answer?.questionId, "q_age"); // 上書き用answer記録
  assertEquals(result.answer?.questionText, QUESTIONS[0].text);
  assertEquals(result.answer?.answer, "20歳以上です");
  assertEquals(result.reply, "reprompt");
});

Deno.test("transition: 同一質問の再受信（再配達相当）→ 2回目も同じ TransitionResult（純関数冪等）", () => {
  const state = current("in_progress", 1);
  const input = { questionId: "q_drink", optionIndex: 0 };

  const result1 = transition(state, QUESTIONS, input);
  const result2 = transition(state, QUESTIONS, input);

  // 純関数: 同じ入力 → 同じ出力（冪等）
  assertEquals(result1.nextStatus, result2.nextStatus);
  assertEquals(result1.nextIndex, result2.nextIndex);
  assertEquals(result1.answer?.answer, result2.answer?.answer);
  assertEquals(result1.reply, result2.reply);
});

// ==================== 異常入力 ====================

Deno.test("transition: 未知のquestionId → answer=null / 状態不変 / reply=reprompt", () => {
  const result = transition(
    current("in_progress", 1),
    QUESTIONS,
    { questionId: "q_unknown", optionIndex: 0 },
  );

  assertEquals(result.nextStatus, "in_progress");
  assertEquals(result.nextIndex, 1);
  assertEquals(result.answer, null);
  assertEquals(result.reply, "reprompt");
});

Deno.test("transition: optionIndex が options 範囲外（負数） → answer=null / 状態不変 / reply=reprompt", () => {
  const result = transition(
    current("in_progress", 1),
    QUESTIONS,
    { questionId: "q_drink", optionIndex: -1 },
  );

  assertEquals(result.nextStatus, "in_progress");
  assertEquals(result.nextIndex, 1);
  assertEquals(result.answer, null);
  assertEquals(result.reply, "reprompt");
});

Deno.test("transition: optionIndex が options 範囲外（超過） → answer=null / 状態不変 / reply=reprompt", () => {
  const result = transition(
    current("in_progress", 1),
    QUESTIONS,
    { questionId: "q_drink", optionIndex: 99 },
  );

  assertEquals(result.nextStatus, "in_progress");
  assertEquals(result.nextIndex, 1);
  assertEquals(result.answer, null);
  assertEquals(result.reply, "reprompt");
});

// ==================== completed / pending での無視 ====================

Deno.test("transition: completed + 任意postback → answer=null / 状態不変 / reply=none（D-07: 完了後は応答しない）", () => {
  const result = transition(
    current("completed", 3),
    QUESTIONS,
    { questionId: "q_age", optionIndex: 0 },
  );

  assertEquals(result.nextStatus, "completed");
  assertEquals(result.nextIndex, 3);
  assertEquals(result.answer, null);
  assertEquals(result.reply, "none");
});

Deno.test("transition: pending + postback → answer=null / 状態不変 / reply=none（配信前の入力は無視）", () => {
  const result = transition(
    current("pending", 0),
    QUESTIONS,
    { questionId: "q_age", optionIndex: 0 },
  );

  assertEquals(result.nextStatus, "pending");
  assertEquals(result.nextIndex, 0);
  assertEquals(result.answer, null);
  assertEquals(result.reply, "none");
});

// ==================== 防御 ====================

Deno.test("transition: questions が空配列 → answer=null / reply=none（防御）", () => {
  const result = transition(
    current("sent", 0),
    [],
    { questionId: "q_age", optionIndex: 0 },
  );

  assertEquals(result.answer, null);
  assertEquals(result.reply, "none");
});
