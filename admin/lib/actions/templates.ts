"use server";
/**
 * admin/lib/actions/templates.ts
 * 質問テンプレートの server actions
 */
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { templateSchema } from "@/lib/schemas/template";

/**
 * 質問テンプレートを保存する server action
 * - zod 再検証（サーバー側でも必ず検証）→ insert + select（INSERT は RLS 違反で 403 エラーになる）
 * → revalidatePath
 */
export async function saveQuestionTemplate(
  oaConfigId: string,
  rawInput: { name: string; questions: unknown },
): Promise<{ success: boolean; error?: string }> {
  // zod 再検証（サーバー側でも必ず検証 — T-04-11 Tampering 対策）
  const parsed = templateSchema.safeParse(rawInput);
  if (!parsed.success) {
    const firstError = parsed.error.issues[0]?.message ?? "入力内容に誤りがあります";
    return { success: false, error: firstError };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("question_templates")
    .insert({
      oa_config_id: oaConfigId,
      name: parsed.data.name,
      questions: parsed.data.questions,
    })
    .select("id"); // INSERT は RLS 違反で 403 エラーになる（silent-0-row にならない）

  if (error) {
    return {
      success: false,
      error: "テンプレートの保存に失敗しました。もう一度お試しください",
    };
  }

  revalidatePath("/oa/settings");
  return { success: true };
}
