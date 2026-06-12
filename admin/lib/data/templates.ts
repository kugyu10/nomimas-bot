import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * 質問テンプレートの型（question_templates テーブルの SELECT 結果）
 */
export interface QuestionTemplate {
  id: string;
  oa_config_id: string;
  name: string;
  questions: Array<{ id: string; text: string; options: string[] }>;
}

/**
 * 自分がアクセスできる全OAの質問テンプレート一覧を取得する
 *
 * フィルタなし SELECT — RLS の oa_members チェーンが「自分がアクセスできる全OA」へ
 * 自動スコープするため where 句は不要（Pattern 6 — クロスOA適用候補の充足）
 */
export async function listQuestionTemplates(
  supabase: SupabaseClient,
): Promise<QuestionTemplate[]> {
  const { data, error } = await supabase
    .from("question_templates")
    .select("id, oa_config_id, name, questions")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("listQuestionTemplates error:", error);
    return [];
  }

  return (data ?? []) as QuestionTemplate[];
}
