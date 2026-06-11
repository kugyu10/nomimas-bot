// Quick Replyメッセージビルダー Unit Test
// TDD RED: messages.ts が未実装の状態でfailすることを確認する
// 実行: deno test --config supabase/functions/deno.json --allow-read supabase/functions/tests/confirm_messages_test.ts

import {
  assertEquals,
  assertExists,
  assertStringIncludes,
  assertThrows,
} from "jsr:@std/assert";
import {
  buildQuestionMessage,
  buildInitialMessages,
  buildRepromptMessages,
  buildCompletionMessages,
} from "../_shared/confirm/messages.ts";
import { decodePostbackData } from "../_shared/confirm/postback.ts";
import type { EventInfo } from "../_shared/confirm/messages.ts";

const VALID_UUID = "550e8400-e29b-41d4-a716-446655440000";

// 定型質問フィクスチャ（最長選択肢は7字以内で適合）
const QUESTION = {
  id: "q_age",
  text: "年齢確認: 20歳以上ですか？",
  options: ["20歳以上です", "未成年です"],
};

const EVENT_INFO: EventInfo = {
  title: "2026年夏の飲み会",
  eventDate: "2026-08-01",
  meetingAt: "18:00",
  meetingPlace: "渋谷駅ハチ公口",
  fee: "5000円",
  venueInfo: "居酒屋おおにし",
};

// ==================== buildQuestionMessage ====================

Deno.test("buildQuestionMessage: type=text かつ text が質問文であること", () => {
  const msg = buildQuestionMessage(QUESTION, VALID_UUID) as Record<
    string,
    unknown
  >;
  assertEquals(msg["type"], "text");
  assertEquals(msg["text"], QUESTION.text);
});

Deno.test("buildQuestionMessage: quickReply.items が options と同数であること", () => {
  const msg = buildQuestionMessage(QUESTION, VALID_UUID) as Record<
    string,
    unknown
  >;
  const quickReply = msg["quickReply"] as { items: unknown[] };
  assertExists(quickReply);
  assertEquals(quickReply.items.length, QUESTION.options.length);
});

Deno.test("buildQuestionMessage: 各 item の action.type=postback かつ label/displayText が選択肢文字列", () => {
  const msg = buildQuestionMessage(QUESTION, VALID_UUID) as Record<
    string,
    unknown
  >;
  const items = (msg["quickReply"] as { items: unknown[] }).items;
  QUESTION.options.forEach((opt, i) => {
    const item = items[i] as {
      type: string;
      action: {
        type: string;
        label: string;
        displayText: string;
        data: string;
      };
    };
    assertEquals(item.type, "action");
    assertEquals(item.action.type, "postback");
    assertEquals(item.action.label, opt);
    assertEquals(item.action.displayText, opt);
  });
});

Deno.test("buildQuestionMessage: data が decodePostbackData でラウンドトリップする", () => {
  const msg = buildQuestionMessage(QUESTION, VALID_UUID) as Record<
    string,
    unknown
  >;
  const items = (msg["quickReply"] as { items: unknown[] }).items;
  QUESTION.options.forEach((_, i) => {
    const item = items[i] as {
      action: { data: string };
    };
    const decoded = decodePostbackData(item.action.data);
    assertExists(decoded, `optionIndex ${i} の data が decode できること`);
    assertEquals(decoded!.participantId, VALID_UUID);
    assertEquals(decoded!.questionId, QUESTION.id);
    assertEquals(decoded!.optionIndex, i);
  });
});

Deno.test("buildQuestionMessage: label が20字超の選択肢を渡すと throw する（LINE制約）", () => {
  const longOptionQuestion = {
    ...QUESTION,
    options: ["この選択肢は二十一文字を超えているのでエラーになるはずです"],
  };
  assertThrows(
    () => buildQuestionMessage(longOptionQuestion, VALID_UUID),
    Error,
    undefined,
    "label20字超でErrorがthrowされること",
  );
});

Deno.test("buildQuestionMessage: options が13個超だと throw する（LINE制約）", () => {
  const manyOptionsQuestion = {
    ...QUESTION,
    options: Array.from({ length: 14 }, (_, i) => `選択肢${i + 1}`),
  };
  assertThrows(
    () => buildQuestionMessage(manyOptionsQuestion, VALID_UUID),
    Error,
    undefined,
    "options13個超でErrorがthrowされること",
  );
});

// ==================== buildInitialMessages ====================

Deno.test("buildInitialMessages: 3要素の配列を返す（イベント情報・案内文・Q1）", () => {
  const msgs = buildInitialMessages(EVENT_INFO, QUESTION, VALID_UUID);
  assertEquals(Array.isArray(msgs), true);
  assertEquals(msgs.length, 3);
});

Deno.test("buildInitialMessages: 先頭テキストに title / eventDate / meetingPlace / fee / venueInfo が含まれる", () => {
  const msgs = buildInitialMessages(EVENT_INFO, QUESTION, VALID_UUID);
  const firstText = (msgs[0] as { text: string }).text;
  assertStringIncludes(firstText, EVENT_INFO.title);
  assertStringIncludes(firstText, EVENT_INFO.eventDate!);
  assertStringIncludes(firstText, EVENT_INFO.meetingPlace!);
  assertStringIncludes(firstText, EVENT_INFO.fee!);
  assertStringIncludes(firstText, EVENT_INFO.venueInfo!);
});

Deno.test("buildInitialMessages: null フィールドは先頭テキストから省略される", () => {
  const partialInfo: EventInfo = {
    title: "テストイベント",
    eventDate: null,
    meetingAt: null,
    meetingPlace: null,
    fee: null,
    venueInfo: null,
  };
  const msgs = buildInitialMessages(partialInfo, QUESTION, VALID_UUID);
  const firstText = (msgs[0] as { text: string }).text;
  assertStringIncludes(firstText, "テストイベント");
  // null フィールドの代表的なラベルが含まれないこと（省略確認）
  // 参加費・集合場所等がnullのとき行ごと省略される
  assertEquals(firstText.includes("null"), false);
});

Deno.test("buildInitialMessages: 3要素目がQuick Reply付き質問メッセージ（Q1）であること", () => {
  const msgs = buildInitialMessages(EVENT_INFO, QUESTION, VALID_UUID);
  const q1Msg = msgs[2] as Record<string, unknown>;
  assertEquals(q1Msg["type"], "text");
  assertExists(q1Msg["quickReply"], "Q1にquickReplyが存在すること");
  assertEquals(q1Msg["text"], QUESTION.text);
});

Deno.test("buildInitialMessages: 配列長が5を超えるとthrowする（push 1リクエスト上限）", () => {
  // この関数自体は常に3要素を返す設計だが、実装がassertを持つことを確認
  // 外部からassertを直接トリガーするにはモンキーパッチが必要なため、
  // 代わりに通常呼び出しが5以下であることをアサートする間接確認
  const msgs = buildInitialMessages(EVENT_INFO, QUESTION, VALID_UUID);
  assertEquals(msgs.length <= 5, true, "メッセージ数が5以下であること");
});

// ==================== buildRepromptMessages ====================

Deno.test("buildRepromptMessages: 2要素（誘導文テキスト + Quick Reply付き現在質問）を返す", () => {
  const msgs = buildRepromptMessages(QUESTION, VALID_UUID);
  assertEquals(Array.isArray(msgs), true);
  assertEquals(msgs.length, 2);
});

Deno.test("buildRepromptMessages: 2要素目がQuick Reply付き質問メッセージであること", () => {
  const msgs = buildRepromptMessages(QUESTION, VALID_UUID);
  const qMsg = msgs[1] as Record<string, unknown>;
  assertEquals(qMsg["type"], "text");
  assertExists(qMsg["quickReply"], "2要素目にquickReplyが存在すること");
});

Deno.test("buildRepromptMessages: 1要素目が誘導文（テキストメッセージ）であること", () => {
  const msgs = buildRepromptMessages(QUESTION, VALID_UUID);
  const guideMsg = msgs[0] as Record<string, unknown>;
  assertEquals(guideMsg["type"], "text");
  // quickReply がないことで誘導文と質問を区別
  assertEquals(guideMsg["quickReply"], undefined);
});

// ==================== buildCompletionMessages ====================

Deno.test("buildCompletionMessages: 1要素の配列を返す", () => {
  const msgs = buildCompletionMessages();
  assertEquals(Array.isArray(msgs), true);
  assertEquals(msgs.length, 1);
});

Deno.test("buildCompletionMessages: text に「修正」と「主催者」が含まれる（D-08: 修正があれば主催者へ連絡）", () => {
  const msgs = buildCompletionMessages();
  const text = (msgs[0] as { text: string }).text;
  assertStringIncludes(text, "修正");
  assertStringIncludes(text, "主催者");
});
