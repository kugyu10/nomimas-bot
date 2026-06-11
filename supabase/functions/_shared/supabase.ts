// Supabase service roleクライアント生成
// SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY はEdge Functionsに自動注入される（supabase secrets setで上書き不要）
// RESEARCH.md Pitfall 6 参照

import { createClient } from "@supabase/supabase-js";

/**
 * service roleクライアントを生成する
 * service roleはRLSをバイパスするため、Edge Functions内のみで使用すること
 * クライアントサイドには絶対に露出させない
 */
export function createServiceClient() {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  // Edge Functionsでは自動注入されるが、ローカル実行等での欠落を明示エラーにする（IN-04）
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set");
  }
  return createClient(supabaseUrl, supabaseServiceRoleKey);
}
