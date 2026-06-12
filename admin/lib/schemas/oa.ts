/**
 * admin/lib/schemas/oa.ts
 * OA設定フォームの zod スキーマ定義
 *
 * questionSchema は Phase 2 Bot の {id,text,options[]} 形状と完全一致させる（T-03-14）
 */
import { z } from "zod";

// WR-07: LINE Messaging API 制約と整合させる上限値
// （Phase 2 supabase/functions/_shared/confirm/messages.ts の実行時 assert と同値 —
//   違反データを保存すると bot 配信時に throw して配信が止まるため、保存時点で弾く）
export const MAX_QUESTIONS = 20;
export const MAX_QUESTION_TEXT_LENGTH = 200;
export const MAX_OPTION_LABEL_LENGTH = 20; // LINE Quick Reply label 上限（messages.ts MAX_LABEL_LENGTH）
export const MAX_OPTIONS_PER_QUESTION = 13; // LINE Quick Reply items 上限（messages.ts MAX_QUICK_REPLY_ITEMS）

/**
 * 質問項目スキーマ（Phase 2 JSONB と同形）
 * - id: 非空文字列
 * - text: 非空文字列（max 200）
 * - options: 非空文字列の配列（min 1 / max 13、各要素 max 20字 — LINE 制約）
 */
export const questionSchema = z.object({
  id: z.string().min(1, "質問IDは必須です"),
  text: z
    .string()
    .min(1, "質問テキストは必須です")
    .max(MAX_QUESTION_TEXT_LENGTH, `質問テキストは${MAX_QUESTION_TEXT_LENGTH}文字以内で入力してください`),
  options: z
    .array(
      z
        .string()
        .min(1, "選択肢は空にできません")
        .max(MAX_OPTION_LABEL_LENGTH, `選択肢は${MAX_OPTION_LABEL_LENGTH}文字以内で入力してください`),
    )
    .min(1, "選択肢を1件以上設定してください")
    .max(MAX_OPTIONS_PER_QUESTION, `選択肢は${MAX_OPTIONS_PER_QUESTION}件以内で設定してください`),
});

export type Question = z.infer<typeof questionSchema>;

/**
 * admin_twitter_id の正規化変換
 * '@a, b ,, @c ' → 'a,b,c'
 * - 各要素をトリム
 * - @ 前置を除去
 * - 空要素を除去
 * - カンマ区切りで結合
 */
function normalizeAdminTwitterId(raw: string): string {
  return raw
    .split(",")
    .map((s) => s.trim().replace(/^@/, ""))
    .filter((s) => s.length > 0)
    .join(",");
}

/**
 * OA設定スキーマ
 * - name: 非空文字列（OA名）
 * - admin_twitter_id: カンマ区切り文字列（正規化変換あり）
 * - greeting_message: nullable 文字列（最終確認メッセージ冒頭）
 * - completion_message: nullable 文字列（完了メッセージ）
 * - questions: questionSchema の配列
 */
/**
 * 質問配列スキーマ（superRefine id 一意性 + LINE 上限込み）
 * template.ts から再利用するため export する（T-03-14 同型性維持）
 */
export const questionsSchema = z
  .array(questionSchema)
  .max(MAX_QUESTIONS, `質問は${MAX_QUESTIONS}件以内で設定してください`)
  .superRefine((qs, ctx) => {
    const seen = new Set<string>();
    qs.forEach((q, index) => {
      if (seen.has(q.id)) {
        ctx.addIssue({
          code: "custom",
          message: "質問IDが重複しています",
          path: [index, "id"],
        });
      }
      seen.add(q.id);
    });
  });

export const oaSettingsSchema = z.object({
  name: z.string().min(1, "OA名は必須です"),
  admin_twitter_id: z
    .string()
    .transform(normalizeAdminTwitterId),
  greeting_message: z.string().nullable().optional(),
  completion_message: z.string().nullable().optional(),
  // WR-07: 件数上限 + id 一意性（重複 id は answers の question_key Map と
  // bot 側1問1答の進行キーを衝突させ、回答が黙って collapse する）
  questions: questionsSchema,
});

export type OaSettingsInput = z.input<typeof oaSettingsSchema>;
export type OaSettings = z.infer<typeof oaSettingsSchema>;
