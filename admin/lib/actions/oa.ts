"use server";
/**
 * admin/lib/actions/oa.ts
 * OA設定の server actions
 */
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { oaSettingsSchema, type OaSettingsInput } from "@/lib/schemas/oa";
import { updateOaSettings } from "@/lib/data/oa";

/**
 * OA設定を保存する server action
 * - zod 再検証 → updateOaSettings → revalidatePath
 */
export async function saveOaSettings(
  oaConfigId: string,
  rawInput: OaSettingsInput,
): Promise<{ success: boolean; error?: string }> {
  // zod 再検証（サーバー側でも必ず検証）
  const parsed = oaSettingsSchema.safeParse(rawInput);
  if (!parsed.success) {
    const issues = parsed.error.issues;
    const firstError = issues[0]?.message ?? "入力内容に誤りがあります";
    return { success: false, error: firstError };
  }

  const supabase = await createClient();
  const { error } = await updateOaSettings(supabase, oaConfigId, parsed.data);

  if (error) {
    return { success: false, error };
  }

  revalidatePath("/oa/settings");
  return { success: true };
}
