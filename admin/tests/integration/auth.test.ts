/**
 * admin/tests/integration/auth.test.ts
 * モック認証スモーク（成功条件1の機械検証）
 *
 * ゲート: RLS_TEST=1 のときのみ実行
 *
 * テスト:
 * 1. anon クライアントで dev-owner-1@nomimas.test + MOCK_USER_PASSWORD を signInWithPassword
 *    → oa_configs select が name 'dev-oa' の 1 行のみ（RLS スコープが実効）
 * 2. 同セッションで OA-2 の oa_configs UPDATE
 *    → 返却 0 行（エラーなし — silent-0-row の実挙動を退行検知）
 *
 * アプリ経路（supabase-js JWT → PostgREST → RLS）の退行検知スモーク。
 * pooler ハーネスとは別経路を確認することで多層防御のカバレッジを補完する。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.SUPABASE_PUBLISHABLE_KEY ??
  process.env.SUPABASE_ANON_KEY ??
  "";

const MOCK_USER_EMAIL = "dev-owner-1@nomimas.test";
const MOCK_USER_PASSWORD = process.env.MOCK_USER_PASSWORD ?? "";

const OA2_ID = "00000000-0000-0000-0000-000000000011";

let client: SupabaseClient;

beforeAll(async () => {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error(
      "[auth.test] ABORT: SUPABASE_URL または SUPABASE_ANON_KEY が設定されていません（env.dev を確認してください）",
    );
  }
  if (!MOCK_USER_PASSWORD) {
    throw new Error(
      "[auth.test] ABORT: MOCK_USER_PASSWORD が設定されていません（env.dev を確認してください）",
    );
  }

  client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      // テスト用: セッション永続化しない
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  // モックユーザーでログイン（成功条件1: signInWithPassword → JWT → RLS）
  const { error } = await client.auth.signInWithPassword({
    email: MOCK_USER_EMAIL,
    password: MOCK_USER_PASSWORD,
  });

  if (error) {
    throw new Error(
      `[auth.test] ログイン失敗: ${error.message}\n` +
        "  setup-dev.ts を実行してモックユーザーを作成してください。",
    );
  }
});

afterAll(async () => {
  // セッションをクリア
  await client.auth.signOut();
});

describe("モック認証スモーク（成功条件1）", () => {
  it("signInWithPassword 後 oa_configs SELECT → dev-oa の 1行のみ（RLS スコープが実効）", async () => {
    const { data, error } = await client.from("oa_configs").select("id, name").order("name");

    expect(error).toBeNull();
    expect(data).not.toBeNull();
    // user1 は dev-oa の owner のみ → dev-oa の 1行だけ返る
    expect(data!.length).toBe(1);
    expect(data![0].name).toBe("dev-oa");
  });

  it("同セッションで OA-2 の oa_configs UPDATE → 返却 0行（エラーなし — silent-0-row）", async () => {
    // Pitfall 4 の実挙動確認: RLS で不可視な行への UPDATE はエラーにならず 0 行
    const { data, error } = await client
      .from("oa_configs")
      .update({ name: "hacked" })
      .eq("id", OA2_ID)
      .select("id");

    // エラーは発生しない（silent）
    expect(error).toBeNull();
    // 返却行数が 0（RLS で弾かれた）
    expect(data).not.toBeNull();
    expect(data!.length).toBe(0);
  });
});
