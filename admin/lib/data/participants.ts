// admin/lib/data/participants.ts
// 参加者データ層
import type { SupabaseClient } from "@supabase/supabase-js";

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
