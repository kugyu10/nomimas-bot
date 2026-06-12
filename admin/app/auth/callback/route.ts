// admin/app/auth/callback/route.ts
// Source: supabase.com/docs/guides/auth/server-side（PKCE フロー）
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/events";

  // next パラメータは origin 相対パスのみ許可（先頭 '/' 検証 — T-03-09 open redirect 対策）
  const safeNext = next.startsWith("/") ? next : "/events";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // 初回 owner 自動登録（SECURITY DEFINER RPC — 冪等・email identity では 0 行）
      await supabase.rpc("register_owner_by_identity");
      return NextResponse.redirect(`${origin}${safeNext}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth`);
}
