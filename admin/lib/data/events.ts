// admin/lib/data/events.ts
// イベントデータ層: SupabaseClient を引数に取る純粋な関数群
// user JWT クライアントのみ使用（service_role 禁止 — Locked）
import type { SupabaseClient } from "@supabase/supabase-js";
import type { EventFormValues } from "@/lib/schemas/event";
import { composeMeetingAt } from "@/lib/schemas/event";

// ─────────────────────────────────────────────
// 型定義
// ─────────────────────────────────────────────

export interface PlatformUrlRow {
  id: string;
  event_id: string;
  platform: string;
  url: string;
  created_at: string;
}

export interface ParticipantSummary {
  confirm_status: string;
}

export interface EventListItem {
  id: string;
  oa_config_id: string;
  title: string;
  event_date: string | null;
  meeting_at: string | null;
  updated_at: string;
  created_at: string;
  platform_urls: PlatformUrlRow[];
  // 集計列（TS で合成）
  participant_count: number;
  answered_count: number;
}

export interface EventDetail {
  id: string;
  oa_config_id: string;
  title: string;
  event_date: string | null;
  meeting_at: string | null;
  meeting_place: string | null;
  fee: string | null;
  venue_info: string | null;
  confirm_days_before: number;
  updated_at: string;
  created_at: string;
  platform_urls: PlatformUrlRow[];
}

export interface DataError {
  error: string;
}

// ─────────────────────────────────────────────
// listEvents: 選択中 OA のイベント一覧を取得
// ─────────────────────────────────────────────

export async function listEvents(
  supabase: SupabaseClient,
  oaConfigId: string
): Promise<EventListItem[]> {
  const { data, error } = await supabase
    .from("events")
    .select(
      `id, oa_config_id, title, event_date, meeting_at, updated_at, created_at,
       event_platform_urls(id, event_id, platform, url, created_at,
         participants(confirm_status)
       )`
    )
    .eq("oa_config_id", oaConfigId)
    .order("event_date", { ascending: false });

  if (error) {
    console.error("listEvents error:", error);
    return [];
  }

  if (!data) return [];

  return data.map((event) => {
    const platformUrls = (event.event_platform_urls ?? []) as Array<
      PlatformUrlRow & { participants: Array<{ confirm_status: string }> }
    >;
    const allParticipants = platformUrls.flatMap((epu) => epu.participants ?? []);
    const participantCount = allParticipants.length;
    const answeredCount = allParticipants.filter(
      (p) => p.confirm_status === "completed"
    ).length;

    return {
      id: event.id,
      oa_config_id: event.oa_config_id,
      title: event.title,
      event_date: event.event_date,
      meeting_at: event.meeting_at,
      updated_at: event.updated_at,
      created_at: event.created_at,
      platform_urls: platformUrls.map(({ participants: _p, ...rest }) => rest),
      participant_count: participantCount,
      answered_count: answeredCount,
    };
  });
}

// ─────────────────────────────────────────────
// getEvent: イベント詳細を取得（platform_urls 込み）
// ─────────────────────────────────────────────

export async function getEvent(
  supabase: SupabaseClient,
  id: string
): Promise<EventDetail | null> {
  const { data, error } = await supabase
    .from("events")
    .select(
      `id, oa_config_id, title, event_date, meeting_at, meeting_place, fee,
       venue_info, confirm_days_before, updated_at, created_at,
       event_platform_urls(id, event_id, platform, url, created_at)`
    )
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error("getEvent error:", error);
    return null;
  }
  if (!data) return null;

  return {
    ...data,
    platform_urls: (data.event_platform_urls ?? []) as PlatformUrlRow[],
  };
}

// ─────────────────────────────────────────────
// insertEvent: イベント作成（events INSERT → event_platform_urls INSERT）
// ─────────────────────────────────────────────

export async function insertEvent(
  supabase: SupabaseClient,
  oaConfigId: string,
  values: EventFormValues
): Promise<{ id: string } | DataError> {
  const meetingAt = composeMeetingAt(values.event_date, values.meeting_time);

  const { data: eventData, error: eventError } = await supabase
    .from("events")
    .insert({
      oa_config_id: oaConfigId,
      title: values.title,
      event_date: values.event_date,
      meeting_at: meetingAt,
      meeting_place: values.meeting_place ?? null,
      fee: values.fee ?? null,
      venue_info: values.venue_info ?? null,
      confirm_days_before: values.confirm_days_before,
    })
    .select("id")
    .single();

  if (eventError || !eventData) {
    console.error("insertEvent error:", eventError);
    return { error: "保存に失敗しました。入力内容を確認してもう一度お試しください" };
  }

  // event_platform_urls を追加（min 1 は schema で保証済み）
  const urlRows = values.platform_urls.map((pu) => ({
    event_id: eventData.id,
    platform: pu.platform,
    url: pu.url,
  }));

  const { error: urlError } = await supabase
    .from("event_platform_urls")
    .insert(urlRows);

  if (urlError) {
    console.error("insertEvent url error:", urlError);
    return { error: "保存に失敗しました。入力内容を確認してもう一度お試しください" };
  }

  return { id: eventData.id };
}

// ─────────────────────────────────────────────
// updateEvent: イベント更新
// - .select() 付きで返却行数を確認（Pitfall 4: RLS silent-0-row 罠）
// - 返却行数 0 なら「保存に失敗しました」エラーを返す
// - URL は追加のみ（削除 UI/処理は v1 なし — RESEARCH Open Question 2）
// ─────────────────────────────────────────────

export async function updateEvent(
  supabase: SupabaseClient,
  id: string,
  values: EventFormValues
): Promise<{ id: string } | DataError> {
  const meetingAt = composeMeetingAt(values.event_date, values.meeting_time);

  const { data: updated, error: updateError } = await supabase
    .from("events")
    .update({
      title: values.title,
      event_date: values.event_date,
      meeting_at: meetingAt,
      meeting_place: values.meeting_place ?? null,
      fee: values.fee ?? null,
      venue_info: values.venue_info ?? null,
      confirm_days_before: values.confirm_days_before,
    })
    .eq("id", id)
    .select("id");  // .select() で返却行数チェック（Pitfall 4 対策）

  if (updateError) {
    console.error("updateEvent error:", updateError);
    return { error: "保存に失敗しました。入力内容を確認してもう一度お試しください" };
  }

  // RLS の silent-0-row 罠: 他OAのイベントへの更新は 0 行返却
  if (!updated || updated.length === 0) {
    return { error: "保存に失敗しました。入力内容を確認してもう一度お試しください" };
  }

  // URL は追加のみ（既存 URL の削除は v1 対象外）
  // 既存 URL を取得して、新規分だけ INSERT する
  const { data: existingUrls } = await supabase
    .from("event_platform_urls")
    .select("url")
    .eq("event_id", id);

  const existingUrlSet = new Set((existingUrls ?? []).map((u) => u.url));
  const newUrls = values.platform_urls.filter((pu) => !existingUrlSet.has(pu.url));

  if (newUrls.length > 0) {
    const urlRows = newUrls.map((pu) => ({
      event_id: id,
      platform: pu.platform,
      url: pu.url,
    }));
    const { error: urlError } = await supabase
      .from("event_platform_urls")
      .insert(urlRows);
    if (urlError) {
      console.error("updateEvent url error:", urlError);
      return { error: "保存に失敗しました。入力内容を確認してもう一度お試しください" };
    }
  }

  return { id: updated[0].id };
}
