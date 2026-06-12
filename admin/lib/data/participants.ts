// admin/lib/data/participants.ts
// 参加者データ層
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ParticipantWithAnswers } from "../answer-status";

export interface ParticipantRow {
  id: string;
  event_platform_url_id: string;
  display_name: string;
  screen_name: string | null;
  line_user_id: string | null;
  confirm_status: string;
  created_at?: string;
  updated_at?: string;
}

export interface ParticipantWithScrapeTime extends ParticipantRow {
  scraped_at: string | null; // event_platform_urls.created_at を代用
}

// Re-export for convenience
export type { ParticipantWithAnswers };

/** 紐付けタブ用: 未紐付け参加者 */
export interface UnlinkedParticipant {
  id: string;
  display_name: string;
  screen_name: string | null;
}

/** 紐付けタブ用: 紐付け済み参加者 */
export interface LinkedParticipant {
  id: string;
  display_name: string;
  screen_name: string | null;
  line_user_id: string;
  line_display_name: string | null;
}

/** 紐付けタブ用: LINE友だち候補 */
export interface LineUserCandidate {
  id: string;
  display_name: string | null;
  line_user_id: string;
}

/** getLinkingLists の戻り値 */
export interface LinkingLists {
  unlinked: UnlinkedParticipant[];
  linked: LinkedParticipant[];
  lineUserCandidates: LineUserCandidate[];
}

/**
 * イベントの参加者一覧を取得する
 * event_platform_urls → participants の join
 */
export async function listParticipantsByEvent(
  supabase: SupabaseClient,
  eventId: string
): Promise<ParticipantWithScrapeTime[]> {
  const { data, error } = await supabase
    .from("participants")
    .select(
      `id, event_platform_url_id, display_name, screen_name, line_user_id,
       confirm_status,
       event_platform_urls!inner(event_id, created_at)`
    )
    .eq("event_platform_urls.event_id", eventId)
    .order("display_name");

  if (error) {
    console.error("listParticipantsByEvent error:", error);
    return [];
  }
  if (!data) return [];

  return data.map((p) => {
    const epu = p.event_platform_urls as unknown as { created_at: string };
    return {
      id: p.id,
      event_platform_url_id: p.event_platform_url_id,
      display_name: p.display_name,
      screen_name: p.screen_name,
      line_user_id: p.line_user_id,
      confirm_status: p.confirm_status,
      scraped_at: epu?.created_at ?? null,
    };
  });
}

/**
 * ADMIN-01: 回答状況タブ用 — 参加者 × answers × line_users をネスト埋め込み1クエリで取得
 * （RESEARCH Pattern 7）
 */
export async function getParticipantsWithAnswers(
  supabase: SupabaseClient,
  eventId: string
): Promise<ParticipantWithAnswers[]> {
  const { data, error } = await supabase
    .from("participants")
    .select(
      `id, display_name, screen_name, line_user_id, confirm_status,
       line_user:line_users(display_name),
       answers(question_key, answer, answered_at),
       event_platform_urls!inner(event_id)`
    )
    .eq("event_platform_urls.event_id", eventId)
    .order("display_name");

  if (error) {
    console.error("getParticipantsWithAnswers error:", error);
    return [];
  }
  if (!data) return [];

  return data.map((p) => ({
    id: p.id,
    display_name: p.display_name,
    screen_name: p.screen_name as string | null,
    line_user_id: p.line_user_id as string | null,
    line_user: p.line_user as { display_name: string | null } | null,
    confirm_status: p.confirm_status,
    answers: (p.answers as Array<{ question_key: string; answer: string | null; answered_at: string }>)
      ?? [],
  }));
}

/**
 * ADMIN-02: 紐付けタブ用 — 未紐付け参加者・紐付け済み参加者・LINE友だち候補を取得
 *
 * @param supabase    - user JWT client
 * @param eventId     - 対象イベント UUID
 * @param oaConfigId  - OAスコープ（line_users の候補絞り込みに使用）
 */
export async function getLinkingLists(
  supabase: SupabaseClient,
  eventId: string,
  oaConfigId: string
): Promise<LinkingLists> {
  // 参加者一覧（line_user ネスト込み）を1クエリで取得
  const { data: participantsData, error: pErr } = await supabase
    .from("participants")
    .select(
      `id, display_name, screen_name, line_user_id,
       line_user:line_users(id, display_name, line_user_id),
       event_platform_urls!inner(event_id)`
    )
    .eq("event_platform_urls.event_id", eventId)
    .order("display_name");

  if (pErr) {
    console.error("getLinkingLists (participants) error:", pErr);
    return { unlinked: [], linked: [], lineUserCandidates: [] };
  }

  // LINE友だち一覧（対象OAに所属する全員）を取得
  const { data: lineUsersData, error: luErr } = await supabase
    .from("line_users")
    .select("id, display_name, line_user_id")
    .eq("oa_config_id", oaConfigId)
    .order("display_name");

  if (luErr) {
    console.error("getLinkingLists (line_users) error:", luErr);
    return { unlinked: [], linked: [], lineUserCandidates: [] };
  }

  const participants = participantsData ?? [];
  const lineUsers = lineUsersData ?? [];

  // 紐付け済み line_user_id セット（候補から除外するため）
  const linkedLineUserIds = new Set(
    participants
      .filter((p) => p.line_user_id != null)
      .map((p) => p.line_user_id as string)
  );

  const unlinked: UnlinkedParticipant[] = [];
  const linked: LinkedParticipant[] = [];

  for (const p of participants) {
    if (p.line_user_id == null) {
      unlinked.push({
        id: p.id,
        display_name: p.display_name,
        screen_name: p.screen_name as string | null,
      });
    } else {
      const lu = p.line_user as { id: string; display_name: string | null; line_user_id: string } | null;
      linked.push({
        id: p.id,
        display_name: p.display_name,
        screen_name: p.screen_name as string | null,
        line_user_id: p.line_user_id,
        line_display_name: lu?.display_name ?? null,
      });
    }
  }

  // 紐付け済み line_user_id を除外した候補リスト（UI-SPEC: コンボボックスの除外要件）
  const lineUserCandidates: LineUserCandidate[] = lineUsers
    .filter((lu) => !linkedLineUserIds.has(lu.id))
    .map((lu) => ({
      id: lu.id,
      display_name: lu.display_name,
      line_user_id: lu.line_user_id,
    }));

  return { unlinked, linked, lineUserCandidates };
}
