import type { SupabaseClient } from "@supabase/supabase-js";

export interface OaConfig {
  id: string;
  name: string;
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
