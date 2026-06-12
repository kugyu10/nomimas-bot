import type { SupabaseClient } from "@supabase/supabase-js";
import type { OaSettings } from "@/lib/schemas/oa";

export interface OaConfig {
  id: string;
  name: string;
}

/**
 * OA設定の全フィールドを含む詳細型
 */
export interface OaConfigDetail {
  id: string;
  name: string;
  line_channel_id: string | null;
  admin_twitter_id: string | null;
  greeting_message: string | null;
  completion_message: string | null;
  questions: Array<{ id: string; text: string; options: string[] }>;
}

/**
 * 自分が所属する OA の一覧を取得する（RLS により自 OA のみ返る）
 */
export async function listMyOas(supabase: SupabaseClient): Promise<OaConfig[]> {
  const { data, error } = await supabase
    .from("oa_configs")
    .select("id, name")
    .order("name");

  if (error) {
    console.error("listMyOas error:", error);
    return [];
  }

  return data ?? [];
}

/**
 * cookie 値が自分の OA 一覧に含まれなければ先頭 OA にフォールバックする純関数
 * UI-SPEC: OA Selector Interaction Contract
 */
export function resolveSelectedOaId(
  cookieValue: string | undefined,
  myOas: OaConfig[],
): string | null {
  if (myOas.length === 0) return null;
  if (cookieValue && myOas.some((oa) => oa.id === cookieValue)) {
    return cookieValue;
  }
  return myOas[0].id;
}

/**
 * 指定 OA の設定を取得する
 * RLS により自 OA のみアクセス可能
 */
export async function getOaSettings(
  supabase: SupabaseClient,
  oaConfigId: string,
): Promise<OaConfigDetail | null> {
  const { data, error } = await supabase
    .from("oa_configs")
    .select("id, name, line_channel_id, admin_twitter_id, greeting_message, completion_message, questions")
    .eq("id", oaConfigId)
    .single();

  if (error) {
    console.error("getOaSettings error:", error);
    return null;
  }

  return data as OaConfigDetail;
}

/**
 * OA設定を更新する
 * .select() 付き UPDATE で返却行数を確認（Pitfall 4: silent-0-row trap）
 * 返却 0 行 = RLS により更新不可 → error を返す
 */
export async function updateOaSettings(
  supabase: SupabaseClient,
  oaConfigId: string,
  input: OaSettings,
): Promise<{ data: OaConfigDetail | null; error: string | null }> {
  const { data, error } = await supabase
    .from("oa_configs")
    .update({
      name: input.name,
      admin_twitter_id: input.admin_twitter_id || null,
      greeting_message: input.greeting_message ?? null,
      completion_message: input.completion_message ?? null,
      questions: input.questions,
    })
    .eq("id", oaConfigId)
    .select("id, name, line_channel_id, admin_twitter_id, greeting_message, completion_message, questions");

  if (error) {
    console.error("updateOaSettings error:", error);
    return { data: null, error: "保存に失敗しました。入力内容を確認してもう一度お試しください" };
  }

  // silent-0-row trap: RLS で弾かれた UPDATE は 0 行で成功する（Pitfall 4）
  if (!data || data.length === 0) {
    return { data: null, error: "保存に失敗しました。入力内容を確認してもう一度お試しください" };
  }

  return { data: data[0] as OaConfigDetail, error: null };
}
