// Quick Replyメッセージビルダー
// LINE Messaging API のメッセージオブジェクト形状を返す純粋な構築関数群
// Flex メッセージは使わない（D-03）
// 文言はClaude裁量（CONTEXT.md明記）

import { encodePostbackData } from "./postback.ts";
import type { Question } from "./state.ts";

// LINE 制約定数（RESEARCH A1 + T-02-06）
const MAX_QUICK_REPLY_ITEMS = 13;
const MAX_LABEL_LENGTH = 20;
const MAX_PUSH_MESSAGES = 5; // push/reply 1リクエスト上限

/** イベント情報（buildInitialMessages で使用）。null のフィールドは行ごと省略 */
export interface EventInfo {
  title: string;
  eventDate: string | null;
  meetingAt: string | null;
  meetingPlace: string | null;
  fee: string | null;
  venueInfo: string | null;
}

/**
 * Quick Reply 付き質問メッセージを構築する。
 * LINE 制約違反（items>13 / label>20字）は Error を throw する。
 */
export function buildQuestionMessage(
  q: Question,
  participantId: string,
): object {
  // 実行時 assert: LINE 制約チェック
  if (q.options.length > MAX_QUICK_REPLY_ITEMS) {
    throw new Error(
      `Quick Reply items は最大 ${MAX_QUICK_REPLY_ITEMS} 個です（現在: ${q.options.length} 個）`,
    );
  }
  for (const opt of q.options) {
    if (opt.length > MAX_LABEL_LENGTH) {
      throw new Error(
        `Quick Reply label は最大 ${MAX_LABEL_LENGTH} 字です（"${opt}": ${opt.length} 字）`,
      );
    }
  }

  return {
    type: "text",
    text: q.text,
    quickReply: {
      items: q.options.map((opt, i) => ({
        type: "action",
        action: {
          type: "postback",
          label: opt,
          displayText: opt,
          data: encodePostbackData({
            participantId,
            questionId: q.id,
            optionIndex: i,
          }),
        },
      })),
    },
  };
}

/**
 * 初回配信バンドル: イベント情報テキスト + 案内文 + Q1 の3バブルを返す。
 * 1 push リクエストに同梱する前提（≤5バブル: D-02）。
 * null フィールドは行ごと省略。
 */
/** 案内文（定型文）が未設定の場合のデフォルト文 */
const DEFAULT_GUIDANCE =
  "イベント当日に向けて、最終確認のご協力をお願いします。\nこれからいくつかの質問にお答えください。";

export function buildInitialMessages(
  event: EventInfo,
  q1: Question,
  participantId: string,
  greeting?: string | null,
): object[] {
  // イベント情報テキスト（null フィールドは省略）
  const lines: string[] = [];
  lines.push(`【${event.title}】最終確認のお知らせ`);
  lines.push("");
  if (event.eventDate !== null) {
    lines.push(`開催日: ${event.eventDate}`);
  }
  if (event.meetingAt !== null) {
    lines.push(`集合時間: ${event.meetingAt}`);
  }
  if (event.meetingPlace !== null) {
    lines.push(`集合場所: ${event.meetingPlace}`);
  }
  if (event.fee !== null) {
    lines.push(`参加費: ${event.fee}`);
  }
  if (event.venueInfo !== null) {
    lines.push(`会場: ${event.venueInfo}`);
  }

  const eventInfoMessage = {
    type: "text",
    text: lines.join("\n"),
  };

  // 案内文（OA設定の定型文 greeting_message を優先。空ならデフォルト文）
  const guidanceText = greeting && greeting.trim().length > 0
    ? greeting
    : DEFAULT_GUIDANCE;
  const guidanceMessage = {
    type: "text",
    text: guidanceText,
  };

  // Q1 の Quick Reply 付きメッセージ
  const q1Message = buildQuestionMessage(q1, participantId);

  const messages = [eventInfoMessage, guidanceMessage, q1Message];

  // 安全網: push 上限チェック
  if (messages.length > MAX_PUSH_MESSAGES) {
    throw new Error(
      `push メッセージ数が上限 ${MAX_PUSH_MESSAGES} を超えています（${messages.length} 件）`,
    );
  }

  return messages;
}

/**
 * 再誘導メッセージ: 誘導文 + 現在の質問 Quick Reply の 2 バブル。
 * 1 回の reply 呼び出し（RESEARCH Pattern 3: replyToken は 1 回限り）。
 */
export function buildRepromptMessages(
  q: Question,
  participantId: string,
): object[] {
  const guideMessage = {
    type: "text",
    text:
      "ボタンから選択肢をお選びください。\n下の質問にお答えいただくと続けることができます。",
  };

  const questionMessage = buildQuestionMessage(q, participantId);

  return [guideMessage, questionMessage];
}

/**
 * 全問回答完了メッセージ。
 * D-08: 修正があれば主催者へ連絡の旨を含める。
 */
export function buildCompletionMessages(): object[] {
  return [
    {
      type: "text",
      text:
        "ご回答ありがとうございました！\nすべての質問にお答えいただきました。\n\n修正が必要な場合は、主催者まで直接ご連絡ください。",
    },
  ];
}
