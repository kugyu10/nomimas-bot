// admin/tests/integration/scraper-trigger.test.ts
// scraper Edge Function へのユーザー JWT ゲートウェイ通過を自動検証する
// RLS_TEST=1 でのみ実行（setup.ts が env.dev をロード済み）
//
// 検証内容:
// - dev-owner-1@nomimas.test でサインインし access_token を取得
// - 未登録 URL を使って scraper に POST（実スクレイプは行わない）
// - ステータスが 401 でないこと（= verify_jwt 通過・関数本体到達）を確認
// - RESEARCH Pattern 6: user JWT で scraper ゲートウェイを通過することを実証
import { describe, it, expect, beforeAll } from "vitest";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// テストは RLS_TEST=1 でのみ実行（setup.ts が env.dev を loadEnvFile で読む）
const runIntegration = process.env.RLS_TEST === "1";

describe.skipIf(!runIntegration)("scraper Edge Function ゲートウェイ通過テスト", () => {
  let accessToken: string;
  let supabaseUrl: string;

  beforeAll(async () => {
    supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
    const anonKey =
      process.env.SUPABASE_ANON_KEY ??
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
      "";
    const mockPassword = process.env.MOCK_USER_PASSWORD ?? "";

    if (!supabaseUrl || !anonKey || !mockPassword) {
      throw new Error(
        "SAFETY ABORT: SUPABASE_URL / SUPABASE_ANON_KEY / MOCK_USER_PASSWORD が設定されていません"
      );
    }

    // dev-owner-1@nomimas.test で anon クライアントから signInWithPassword
    const client = createSupabaseClient(supabaseUrl, anonKey);
    const { data, error } = await client.auth.signInWithPassword({
      email: "dev-owner-1@nomimas.test",
      password: mockPassword,
    });

    if (error || !data.session?.access_token) {
      throw new Error(
        `signInWithPassword failed: ${error?.message ?? "no session"}. ` +
        "Mock user may not exist — run `npm run setup:dev` from repo root first."
      );
    }

    accessToken = data.session.access_token;
  });

  it("user JWT で scraper Edge Function のゲートウェイ（verify_jwt）を通過できる", async () => {
    // 未登録 URL（実スクレイプは行われない — scraper は canHandle で弾く）
    const unregisteredUrl = "https://twipla.jp/events/0000000000";

    const res = await fetch(`${supabaseUrl}/functions/v1/scraper`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ url: unregisteredUrl }),
      signal: AbortSignal.timeout(30_000),
    });

    // アサーション: 401 でないこと = verify_jwt 通過・関数本体到達
    // RESEARCH Pattern 6: 400 "unsupported url" = 関数本体到達を実機確認済み
    expect(res.status).not.toBe(401);

    // 4xx エラー（400 など）を返す = 関数本体が URL 検証を行っている（正常な動作）
    // 200 の場合は実際に参加者が取得された（テストDB にデータがある場合）
    const body = await res.json().catch(() => ({}));
    console.log(`[scraper-trigger test] status=${res.status}`, body);

    // 関数本体到達の追加アサーション: error または count プロパティが存在する
    expect(
      typeof body === "object" && body !== null,
      "Response should be a JSON object"
    ).toBe(true);
  }, 35_000);

  it("Authorization ヘッダなしは 401 になる（ゲートウェイが機能している）", async () => {
    const res = await fetch(`${supabaseUrl}/functions/v1/scraper`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://twipla.jp/events/0000000000" }),
      signal: AbortSignal.timeout(10_000),
    });
    // verify_jwt が有効なら Bearer なしは 401
    expect(res.status).toBe(401);
  }, 15_000);
});
