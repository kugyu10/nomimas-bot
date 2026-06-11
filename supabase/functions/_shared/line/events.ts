// webhookイベント（postback/follow/message）のzodスキーマと判別ヘルパー
// LINE Messaging API Webhook Event Objects準拠
// Source: developers.line.biz/en/reference/messaging-api/ Webhook Event Objects

import { z } from "zod";

// --- Zod スキーマ定義 ---

const PostbackEventSchema = z.object({
  type: z.literal("postback"),
  replyToken: z.string(),
  source: z.object({ type: z.string(), userId: z.string() }),
  postback: z.object({ data: z.string() }),
  deliveryContext: z.object({ isRedelivery: z.boolean() }).optional(),
  webhookEventId: z.string().optional(),
});

const FollowEventSchema = z.object({
  type: z.literal("follow"),
  replyToken: z.string().optional(),
  source: z.object({ type: z.string(), userId: z.string() }),
  follow: z.object({ isUnblocked: z.boolean() }).optional(),
});

const MessageEventSchema = z.object({
  type: z.literal("message"),
  replyToken: z.string(),
  source: z.object({ type: z.string(), userId: z.string() }),
  message: z.object({
    type: z.literal("text"),
    id: z.string().optional(),
    text: z.string(),
  }),
});

// --- 判別済み ParsedEvent 型 ---

export type ParsedEvent =
  | {
    kind: "postback";
    replyToken: string;
    userId: string;
    data: string;
    isRedelivery: boolean;
  }
  | {
    kind: "follow";
    userId: string;
  }
  | {
    kind: "message";
    replyToken: string;
    userId: string;
    text: string;
  };

/**
 * LINE webhook raw イベントを判別済みの軽量オブジェクトに正規化する。
 * 未知形状・必須フィールド欠損・非オブジェクトは null を返す（例外を投げない）。
 */
export function parseWebhookEvent(raw: unknown): ParsedEvent | null {
  if (raw === null || typeof raw !== "object") {
    return null;
  }

  // type フィールドで分岐
  const obj = raw as Record<string, unknown>;
  const type = obj["type"];

  if (type === "postback") {
    const result = PostbackEventSchema.safeParse(raw);
    if (!result.success) {
      return null;
    }
    const d = result.data;
    return {
      kind: "postback",
      replyToken: d.replyToken,
      userId: d.source.userId,
      data: d.postback.data,
      isRedelivery: d.deliveryContext?.isRedelivery ?? false,
    };
  }

  if (type === "follow") {
    const result = FollowEventSchema.safeParse(raw);
    if (!result.success) {
      return null;
    }
    const d = result.data;
    return {
      kind: "follow",
      userId: d.source.userId,
    };
  }

  if (type === "message") {
    const result = MessageEventSchema.safeParse(raw);
    if (!result.success) {
      return null;
    }
    const d = result.data;
    return {
      kind: "message",
      replyToken: d.replyToken,
      userId: d.source.userId,
      text: d.message.text,
    };
  }

  return null;
}
