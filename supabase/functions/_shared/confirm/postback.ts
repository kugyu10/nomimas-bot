// postback data の encode/decode + zod検証
// LINE postback data 形式: "p=<participant_uuid>&q=<question_id>&a=<option_index>"
// LINE制約: postback data は最大300字 (RESEARCH A1)

import { z } from "zod";

export interface PostbackPayload {
  participantId: string;
  questionId: string;
  optionIndex: number;
}

// UUID-like パターン（8-4-4-4-12 の16進数形式）
// zod 4 の z.string().uuid() はRFC 4122の版・変形ビットを厳格に検証するため、
// seed/テストUUIDを含む開発環境の00000000-0000-0000-0000-xxxxxxxxxx系を拒否する。
// postback dataのparticipant_idはDB外部で発行されるため、DB側のFK制約（uuid型）に
// 任せてアプリ層では形式チェックのみ行う（スポーフィング防止はuserId照合が本体）。
const UUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

// zod スキーマ: UUID形式 / 非空文字列 / 0以上の整数
const PostbackPayloadSchema = z.object({
  p: z.string().regex(UUID_PATTERN),
  q: z.string().min(1),
  a: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(0)),
});

/**
 * PostbackPayload を URLSearchParams 形式にエンコードする。
 * 結果が LINE postback data 上限の 300 字を超える場合は Error を throw する。
 */
export function encodePostbackData(payload: PostbackPayload): string {
  const params = new URLSearchParams({
    p: payload.participantId,
    q: payload.questionId,
    a: String(payload.optionIndex),
  });
  const result = params.toString();
  if (result.length > 300) {
    throw new Error(
      `postback data が LINE 上限の 300 字を超えています: ${result.length} 字`,
    );
  }
  return result;
}

/**
 * URLSearchParams 形式の postback data をデコードする。
 * zodスキーマ検証が失敗した場合は null を返す（例外を投げない）。
 */
export function decodePostbackData(data: string): PostbackPayload | null {
  try {
    const params = new URLSearchParams(data);
    const raw = {
      p: params.get("p") ?? undefined,
      q: params.get("q") ?? undefined,
      a: params.get("a") ?? undefined,
    };
    const result = PostbackPayloadSchema.safeParse(raw);
    if (!result.success) {
      return null;
    }
    return {
      participantId: result.data.p,
      questionId: result.data.q,
      optionIndex: result.data.a,
    };
  } catch {
    return null;
  }
}
