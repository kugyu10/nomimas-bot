"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const isMock = process.env.NEXT_PUBLIC_AUTH_MOCK === "1";

  async function handleXLogin() {
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const next = new URLSearchParams(window.location.search).get("next") ?? "/events";
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "x",
      options: {
        redirectTo: `${location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });
    if (error) {
      setError("ログインに失敗しました。もう一度お試しください");
      setLoading(false);
    }
    // On success, browser is redirected by Supabase
  }

  async function handleMockLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setError("メールアドレスまたはパスワードが正しくありません");
      setLoading(false);
      return;
    }
    // モック経路の自動登録 (email identity では 0 行の no-op — 経路統一)
    await supabase.rpc("register_owner_by_identity");
    // IN-02: ディープリンク復帰 — origin 相対パスのみ許可。
    // "//evil.com" / "/\evil.com" は protocol-relative URL として解釈されるため明示的に拒否する
    const next = new URLSearchParams(window.location.search).get("next") ?? "/events";
    const isSafeNext = next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\");
    window.location.href = isSafeNext ? next : "/events";
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="w-full max-w-sm space-y-6 p-8">
        <div className="text-center space-y-2">
          <h1 className="text-xl font-semibold">Nomimas 管理画面</h1>
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <Button
          onClick={handleXLogin}
          disabled={loading}
          className="w-full"
        >
          X（Twitter）でログイン
        </Button>

        {isMock && (
          <div className="space-y-4">
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-background px-2 text-muted-foreground">または</span>
              </div>
            </div>

            <form onSubmit={handleMockLogin} className="space-y-4">
              <p className="text-xs text-muted-foreground text-center">
                テストユーザーでログイン（開発環境のみ）
              </p>
              <div className="space-y-2">
                <Label htmlFor="email">メールアドレス</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="test@example.com"
                  required
                  disabled={loading}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">パスワード</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  disabled={loading}
                />
              </div>
              <Button
                type="submit"
                variant="outline"
                disabled={loading}
                className="w-full"
              >
                {loading ? "ログイン中..." : "テストログイン"}
              </Button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
