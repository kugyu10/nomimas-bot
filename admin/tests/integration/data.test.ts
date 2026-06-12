/**
 * admin/tests/integration/data.test.ts
 * getParticipantsWithAnswers の統合テスト（RLS_TEST=1 ゲート）
 *
 * 検証:
 * 1. user1 JWT で dev-event (OA-1) の getParticipantsWithAnswers → seed 参加者 …0005 が
 *    q_age の回答付きで返る（answers ネストの構造 assert）
 * 2. OA-2 の dev-event-2 (…0012) に対する同クエリ → 0 行（クロスOA 不可視）
 *
 * 固定UUID (seed.sql より):
 *   dev-event (OA-1):        00000000-0000-0000-0000-000000000002
 *   dev-event-2 (OA-2):      00000000-0000-0000-0000-000000000012
 *   dev-participant (OA-1):  00000000-0000-0000-0000-000000000005
 *   dev-answer (q_age):      00000000-0000-0000-0000-000000000006
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { getParticipantsWithAnswers } from "../../lib/data/participants";

const DEV_PROJECT_REF = "cmsxvxtcdniqgvhxjqri";
const OA1_EVENT_ID = "00000000-0000-0000-0000-000000000002";
const OA2_EVENT_ID = "00000000-0000-0000-0000-000000000012";
const PARTICIPANT_ID = "00000000-0000-0000-0000-000000000005";

let supabaseUser1: ReturnType<typeof createClient>;

beforeAll(async () => {
  // dev only ガード
  const ref = process.env.DEV_PROJECT_REF ?? "";
  if (ref !== DEV_PROJECT_REF) {
    throw new Error(`[data.test] SAFETY ABORT: DEV_PROJECT_REF='${ref}' !== '${DEV_PROJECT_REF}'`);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.SUPABASE_ANON_KEY ??
    "";
  const email = process.env.MOCK_USER_EMAIL ?? "dev-owner-1@nomimas.test";
  const password = process.env.MOCK_USER_PASSWORD ?? "";

  if (!url || !anonKey || !password) {
    throw new Error("[data.test] ABORT: SUPABASE_URL / key / MOCK_USER_PASSWORD が未設定です（env.dev を source してください）");
  }

  // user1 (dev-owner-1) で signInWithPassword
  supabaseUser1 = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await supabaseUser1.auth.signInWithPassword({ email, password });
  if (error) {
    throw new Error(`[data.test] signInWithPassword failed: ${error.message}`);
  }
});

afterAll(async () => {
  // セッションをクリア（タイムアウト 15s — signOut は非同期ネットワーク呼出）
  if (supabaseUser1) {
    try {
      await supabaseUser1.auth.signOut();
    } catch {
      // signOut の失敗はテスト結果に影響しない
    }
  }
}, 15000);

describe("getParticipantsWithAnswers", () => {
  it("user1 が dev-event (OA-1) の参加者を回答ネスト付きで取得できる", async () => {
    const rows = await getParticipantsWithAnswers(supabaseUser1, OA1_EVENT_ID);

    // 少なくとも seed 参加者 …0005 が含まれる
    expect(rows.length).toBeGreaterThan(0);

    const target = rows.find((r) => r.id === PARTICIPANT_ID);
    expect(target).toBeDefined();

    // answers ネストの構造確認
    expect(Array.isArray(target!.answers)).toBe(true);
    expect(target!.answers.length).toBeGreaterThan(0);

    // q_age の回答が存在する
    const qAgeAnswer = target!.answers.find((a) => a.question_key === "q_age");
    expect(qAgeAnswer).toBeDefined();
    expect(qAgeAnswer!.answer).toBe("20歳以上です");

    // confirm_status が存在する
    expect(target!.confirm_status).toBe("pending");

    // line_user フィールドが存在する（null または object）
    expect("line_user" in target!).toBe(true);
  });

  it("user1 が OA-2 の dev-event-2 を参照しても 0 行（クロスOA 不可視）", async () => {
    const rows = await getParticipantsWithAnswers(supabaseUser1, OA2_EVENT_ID);
    // RLS により user1 (OA-1 owner) は OA-2 のデータを見られない → 0 行
    expect(rows).toHaveLength(0);
  });
});
