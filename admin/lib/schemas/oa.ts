/**
 * admin/lib/schemas/oa.ts
 * OA設定フォームの zod スキーマ定義
 *
 * questionSchema は Phase 2 Bot の {id,text,options[]} 形状と完全一致させる（T-03-14）
 */
import { z } from "zod";

/**
 * 質問項目スキーマ（Phase 2 JSONB と同形）
 * - id: 非空文字列
 * - text: 非空文字列
 * - options: 非空文字列の配列（min 1）
 */
export const questionSchema = z.object({
  id: z.string().min(1, "質問IDは必須です"),
  text: z.string().min(1, "質問テキストは必須です"),
  options: z
    .array(z.string().min(1, "選択肢は空にできません"))
    .min(1, "選択肢を1件以上設定してください"),
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
export const oaSettingsSchema = z.object({
  name: z.string().min(1, "OA名は必須です"),
  admin_twitter_id: z
    .string()
    .transform(normalizeAdminTwitterId),
  greeting_message: z.string().nullable().optional(),
  completion_message: z.string().nullable().optional(),
  questions: z.array(questionSchema),
});

export type OaSettingsInput = z.input<typeof oaSettingsSchema>;
export type OaSettings = z.infer<typeof oaSettingsSchema>;
