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
import { insertEvent } from "../../lib/data/events";
import { connectDev } from "./rls.helpers";

const DEV_PROJECT_REF = "cmsxvxtcdniqgvhxjqri";
const OA1_ID = "00000000-0000-0000-0000-000000000001";
const OA1_EVENT_ID = "00000000-0000-0000-0000-000000000002";
const OA1_EPU_ID = "00000000-0000-0000-0000-000000000003";
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

// ===========================================================
// insertEvent — create_event_with_urls RPC（03-REVIEW WR-04: アトミック性）
// ===========================================================
describe("insertEvent (create_event_with_urls RPC)", () => {
  const baseValues = {
    title: "",
    event_date: "2026-12-30",
    meeting_time: "18:30",
    meeting_place: "テスト集合場所",
    fee: "1000",
    venue_info: "",
    confirm_days_before: 3 as const,
    platform_urls: [] as Array<{ platform: "twipla"; url: string }>,
  };

  it("重複URL → 専用エラーを返し、孤児 events 行を残さない（アトミック）", async () => {
    // seed 済み URL（dev-epu …0003）を取得して衝突させる
    const { data: epu, error: epuErr } = await supabaseUser1
      .from("event_platform_urls")
      .select("url")
      .eq("id", OA1_EPU_ID)
      .single();
    expect(epuErr).toBeNull();
    const duplicateUrl = (epu as unknown as { url: string }).url;

    const title = "wr04-orphan-check";
    const result = await insertEvent(supabaseUser1, OA1_ID, {
      ...baseValues,
      title,
      platform_urls: [{ platform: "twipla", url: duplicateUrl }],
    });

    // 23505 → 明示メッセージ
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toBe("このURLは既に他のイベントに登録されています");
    }

    // 旧実装の孤児（events 行のみ commit 済み）が残っていないこと
    const { data: orphans } = await supabaseUser1
      .from("events")
      .select("id")
      .eq("title", title);
    expect(orphans ?? []).toHaveLength(0);
  });

  it("新規URL → events + event_platform_urls が両方作成される（成功後クリーンアップ）", async () => {
    const title = `wr04-success-${Date.now()}`;
    const uniqueUrl = `https://twipla.jp/events/9${Date.now() % 100000000}`;

    const result = await insertEvent(supabaseUser1, OA1_ID, {
      ...baseValues,
      title,
      platform_urls: [{ platform: "twipla", url: uniqueUrl }],
    });

    expect("id" in result).toBe(true);
    const eventId = (result as { id: string }).id;

    try {
      // meeting_at が JST 18:30 として保存されている（composeMeetingAt 経由）
      const { data: ev } = await supabaseUser1
        .from("events")
        .select("id, title, meeting_at")
        .eq("id", eventId)
        .single();
      expect(ev).toBeDefined();
      const evRow = ev as unknown as { title: string; meeting_at: string };
      expect(evRow.title).toBe(title);
      expect(new Date(evRow.meeting_at).getTime()).toBe(
        new Date("2026-12-30T18:30:00+09:00").getTime(),
      );

      // URL 行も同一トランザクションで作成済み
      const { data: urls } = await supabaseUser1
        .from("event_platform_urls")
        .select("url")
        .eq("event_id", eventId);
      const urlRows = (urls ?? []) as unknown as Array<{ url: string }>;
      expect(urlRows.map((u) => u.url)).toContain(uniqueUrl);
    } finally {
      // DELETE ポリシーは無いので postgres ロールで掃除（epu は cascade）
      const sql = connectDev();
      try {
        await sql`delete from public.events where id = ${eventId}`;
      } finally {
        await sql.end();
      }
    }
  });
});
