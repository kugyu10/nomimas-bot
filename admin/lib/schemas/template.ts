/**
 * admin/lib/schemas/template.ts
 * 質問テンプレートの zod スキーマ定義
 *
 * questionsSchema は lib/schemas/oa.ts から import して再利用する（T-03-14 同型性維持）
 * — 独自スキーマを定義してはならない（CONTEXT locked）
 */
import { z } from "zod";
import { questionsSchema } from "@/lib/schemas/oa";

/**
 * テンプレート保存スキーマ
 * - name: 必須（min 1 / max 100）・空文字拒否
 * - questions: oaSettingsSchema.questions と完全同一検証（questionsSchema を直接参照）
 */
export const templateSchema = z.object({
  name: z
    .string()
    .min(1, "テンプレート名は必須です")
    .max(100, "テンプレート名は100文字以内で入力してください"),
  questions: questionsSchema,
});

export type TemplateInput = z.infer<typeof templateSchema>;
