// webhookイベントzodスキーマ Unit Test
// TDD RED: events.ts が未実装の状態でfailすることを確認する
// 実行: deno test --config supabase/functions/deno.json --allow-read supabase/functions/tests/line_events_test.ts

import { assertEquals, assertExists } from "jsr:@std/assert";
import { parseWebhookEvent } from "../_shared/line/events.ts";

// 正規のpostbackイベントJSON（LINE Messaging API仕様準拠）
const VALID_POSTBACK_EVENT = {
  type: "postback",
  replyToken: "reply-token-abc123",
  source: {
    type: "user",
    userId: "Uabc123456789",
  },
  postback: {
    data: "p=550e8400-e29b-41d4-a716-446655440000&q=q_age&a=0",
  },
  deliveryContext: {
    isRedelivery: false,
  },
  webhookEventId: "event-id-001",
};

// followイベントJSON
const VALID_FOLLOW_EVENT = {
  type: "follow",
  replyToken: "reply-token-follow",
  source: {
    type: "user",
    userId: "Ufollow123",
  },
  follow: {
    isUnblocked: false,
  },
};

// textメッセージイベントJSON
const VALID_MESSAGE_EVENT = {
  type: "message",
  replyToken: "reply-token-msg",
  source: {
    type: "user",
    userId: "Umsg456",
  },
  message: {
    type: "text",
    id: "msg-001",
    text: "こんにちは",
  },
};

Deno.test("parseWebhookEvent: 正規のpostbackイベント → kind:postback にパースされる", () => {
  const result = parseWebhookEvent(VALID_POSTBACK_EVENT);

  assertExists(result, "結果がnullでないこと");
  assertEquals(result.kind, "postback");
  if (result.kind === "postback") {
    assertEquals(result.replyToken, "reply-token-abc123");
    assertEquals(result.userId, "Uabc123456789");
    assertEquals(result.data, "p=550e8400-e29b-41d4-a716-446655440000&q=q_age&a=0");
    assertEquals(result.isRedelivery, false);
  }
});

Deno.test("parseWebhookEvent: postbackイベントでdeliveryContext省略時は isRedelivery=false がデフォルト", () => {
  const eventWithoutDeliveryContext = {
    type: "postback",
    replyToken: "reply-token-abc",
    source: { type: "user", userId: "Uabc123" },
    postback: { data: "p=550e8400-e29b-41d4-a716-446655440000&q=q_age&a=0" },
  };
  const result = parseWebhookEvent(eventWithoutDeliveryContext);

  assertExists(result, "結果がnullでないこと");
  assertEquals(result.kind, "postback");
  if (result.kind === "postback") {
    assertEquals(result.isRedelivery, false, "deliveryContext省略時はisRedelivery=false");
  }
});

Deno.test("parseWebhookEvent: isRedelivery=true のpostbackイベントが正しくパースされる", () => {
  const redeliveryEvent = {
    ...VALID_POSTBACK_EVENT,
    deliveryContext: { isRedelivery: true },
  };
  const result = parseWebhookEvent(redeliveryEvent);

  assertExists(result, "結果がnullでないこと");
  assertEquals(result.kind, "postback");
  if (result.kind === "postback") {
    assertEquals(result.isRedelivery, true, "isRedelivery=trueが保持される");
  }
});

Deno.test("parseWebhookEvent: followイベント → kind:follow にパースされる", () => {
  const result = parseWebhookEvent(VALID_FOLLOW_EVENT);

  assertExists(result, "結果がnullでないこと");
  assertEquals(result.kind, "follow");
  if (result.kind === "follow") {
    assertEquals(result.userId, "Ufollow123");
  }
});

Deno.test("parseWebhookEvent: textメッセージイベント → kind:message にパースされ textを保持する", () => {
  const result = parseWebhookEvent(VALID_MESSAGE_EVENT);

  assertExists(result, "結果がnullでないこと");
  assertEquals(result.kind, "message");
  if (result.kind === "message") {
    assertEquals(result.replyToken, "reply-token-msg");
    assertEquals(result.userId, "Umsg456");
    assertEquals(result.text, "こんにちは");
  }
});

Deno.test("parseWebhookEvent: スタンプ(sticker)メッセージ → kind:message / text=null（WR-04: 非テキストも再誘導経路へ）", () => {
  const stickerEvent = {
    type: "message",
    replyToken: "reply-token-sticker",
    source: { type: "user", userId: "Usticker789" },
    message: {
      type: "sticker",
      id: "msg-sticker-001",
      packageId: "446",
      stickerId: "1988",
    },
  };
  const result = parseWebhookEvent(stickerEvent);

  assertExists(result, "スタンプメッセージが破棄されないこと");
  assertEquals(result.kind, "message");
  if (result.kind === "message") {
    assertEquals(result.replyToken, "reply-token-sticker");
    assertEquals(result.userId, "Usticker789");
    assertEquals(result.text, null, "非テキストは text=null");
  }
});

Deno.test("parseWebhookEvent: 画像(image)メッセージ → kind:message / text=null（WR-04）", () => {
  const imageEvent = {
    type: "message",
    replyToken: "reply-token-image",
    source: { type: "user", userId: "Uimage789" },
    message: {
      type: "image",
      id: "msg-image-001",
      contentProvider: { type: "line" },
    },
  };
  const result = parseWebhookEvent(imageEvent);

  assertExists(result, "画像メッセージが破棄されないこと");
  assertEquals(result.kind, "message");
  if (result.kind === "message") {
    assertEquals(result.text, null, "非テキストは text=null");
  }
});

Deno.test("parseWebhookEvent: source.userId 欠損 → null を返す（throwしない）", () => {
  const eventWithoutUserId = {
    type: "postback",
    replyToken: "reply-token-abc",
    source: { type: "user" }, // userId がない
    postback: { data: "some-data" },
  };
  const result = parseWebhookEvent(eventWithoutUserId);
  assertEquals(result, null, "userId欠損でnullが返る");
});

Deno.test("parseWebhookEvent: 未知のイベントtype → null を返す（throwしない）", () => {
  const unknownEvent = {
    type: "unknown_type_xyz",
    source: { type: "user", userId: "Uabc" },
  };
  const result = parseWebhookEvent(unknownEvent);
  assertEquals(result, null, "未知typeでnullが返る");
});

Deno.test("parseWebhookEvent: 非オブジェクト（null） → null を返す（throwしない）", () => {
  const result = parseWebhookEvent(null);
  assertEquals(result, null, "nullでnullが返る");
});

Deno.test("parseWebhookEvent: 非オブジェクト（文字列） → null を返す（throwしない）", () => {
  const result = parseWebhookEvent("some-string");
  assertEquals(result, null, "文字列でnullが返る");
});

Deno.test("parseWebhookEvent: 非オブジェクト（数値） → null を返す（throwしない）", () => {
  const result = parseWebhookEvent(42);
  assertEquals(result, null, "数値でnullが返る");
});

Deno.test("parseWebhookEvent: 空オブジェクト → null を返す（throwしない）", () => {
  const result = parseWebhookEvent({});
  assertEquals(result, null, "空オブジェクトでnullが返る");
});
