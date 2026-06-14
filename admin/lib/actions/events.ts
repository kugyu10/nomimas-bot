"use server";
// admin/lib/actions/events.ts
// イベント CRUD + scraper トリガー server actions
// - zod 多層防御: クライアント検証を信用せず safeParse で再検証
// - OA スコープ: resolveSelectedOaId で cookie から選択 OA を解決
// - service_role 不使用（Locked）
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { eventFormSchema } from "@/lib/schemas/event";
import { insertEvent, updateEvent as updateEventData } from "@/lib/data/events";
import { createClient } from "@/lib/supabase/server";
import { listMyOas, resolveSelectedOaId } from "@/lib/data/oa";

// ─────────────────────────────────────────────
// 型
// ─────────────────────────────────────────────

export interface ActionResult {
  success: boolean;
  error?: string;
  id?: string;
}

// ─────────────────────────────────────────────
// ヘルパー: 選択中 OA ID を解決する
// ─────────────────────────────────────────────

async function resolveOaId(supabase: Awaited<ReturnType<typeof createClient>>): Promise<string | null> {
  const cookieStore = await cookies();
  const selectedCookie = cookieStore.get("nomimas_selected_oa_id")?.value;
  const myOas = await listMyOas(supabase);
  return resolveSelectedOaId(selectedCookie, myOas);
}

// ─────────────────────────────────────────────
// createEvent: イベント作成
// ─────────────────────────────────────────────

export async function createEvent(
  formData: unknown
): Promise<ActionResult> {
  // zod 再検証（多層防御 — T-03-10）
  const parsed = eventFormSchema.safeParse(formData);
  if (!parsed.success) {
    return { success: false, error: "入力内容に誤りがあります" };
  }

  const supabase = await createClient();
  const oaId = await resolveOaId(supabase);
  if (!oaId) {
    return { success: false, error: "OAが選択されていません" };
  }

  const result = await insertEvent(supabase, oaId, parsed.data);
  if ("error" in result) {
    return { success: false, error: result.error };
  }

  revalidatePath("/events");
  return { success: true, id: result.id };
}

// ─────────────────────────────────────────────
// updateEvent: イベント更新
// ─────────────────────────────────────────────

export async function updateEvent(
  id: string,
  formData: unknown
): Promise<ActionResult> {
  // zod 再検証（多層防御 — T-03-10）
  const parsed = eventFormSchema.safeParse(formData);
  if (!parsed.success) {
    return { success: false, error: "入力内容に誤りがあります" };
  }

  const supabase = await createClient();

  const result = await updateEventData(supabase, id, parsed.data);
  if ("error" in result) {
    return { success: false, error: result.error };
  }

  revalidatePath("/events");
  revalidatePath(`/events/${id}`);
  return { success: true, id: result.id };
}

// ─────────────────────────────────────────────
// triggerScrape: scraper Edge Function をユーザーJWTで起動（Pattern 6）
// - getSession で access_token を取り出す（保護判定には使わない — RESEARCH 注記）
// - 登録済み event_platform_urls それぞれに POST
// ─────────────────────────────────────────────

export async function triggerScrape(
  eventId: string
): Promise<{ success: boolean; count?: number; error?: string }> {
  const supabase = await createClient();

  // token 取り出しのみ getSession で可（保護判定は getClaims — RESEARCH Pattern 6 注記）
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    return { success: false, error: "ログインが必要です" };
  }

  // 登録済み URL を取得
  const { data: urlRows, error: urlError } = await supabase
    .from("event_platform_urls")
    .select("url")
    .eq("event_id", eventId);

  if (urlError || !urlRows || urlRows.length === 0) {
    return { success: false, error: "参加者の取得に失敗しました。URLを確認してもう一度お試しください" };
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  let successCount = 0;
  const errors: string[] = [];

  for (const { url } of urlRows) {
    try {
      const res = await fetch(`${supabaseUrl}/functions/v1/scraper`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ url }),
        signal: AbortSignal.timeout(30_000),
      });

      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        // 件数集計: scraper が count を返すなら使用
        successCount += (body as { count?: number }).count ?? 1;
      } else {
        errors.push((body as { error?: string }).error ?? `HTTP ${res.status}`);
      }
    } catch (e) {
      errors.push(e instanceof Error ? e.message : "タイムアウト");
    }
  }

  revalidatePath(`/events/${eventId}`);

  if (errors.length > 0 && successCount === 0) {
    return {
      success: false,
      error: "参加者の取得に失敗しました。URLを確認してもう一度お試しください",
    };
  }

  return { success: true, count: successCount };
}

// ─────────────────────────────────────────────
// sendEventConfirmations: イベントの未確認者へ最終確認メッセージを手動配信
// - message-sender Edge Function を ユーザーJWT + { event_id } で呼ぶ（手動モード）
// - message-sender 側が RLS でイベントアクセス権を検証し、そのイベントの
//   「attending ∧ pending ∧ 紐付け済み」へ配信（N日前の窓は無視）
// - 既に送信済み(sent)の人には送られない（重複防止は get_confirm_targets が担保）
// ─────────────────────────────────────────────
export async function sendEventConfirmations(
  eventId: string
): Promise<{ success: boolean; sent?: number; failed?: number; targets?: number; error?: string }> {
  const supabase = await createClient();

  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    return { success: false, error: "ログインが必要です" };
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/message-sender`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ event_id: eventId }),
      signal: AbortSignal.timeout(30_000),
    });
    const body = (await res.json().catch(() => ({}))) as {
      status?: string;
      targets?: number;
      sent?: number;
      failed?: number;
    };

    if (!res.ok || body.status !== "ok") {
      if (res.status === 403) {
        return { success: false, error: "このイベントへの配信権限がありません" };
      }
      return { success: false, error: "配信に失敗しました。時間をおいてもう一度お試しください" };
    }

    revalidatePath(`/events/${eventId}`);
    return {
      success: true,
      targets: body.targets ?? 0,
      sent: body.sent ?? 0,
      failed: body.failed ?? 0,
    };
  } catch {
    return { success: false, error: "配信に失敗しました。時間をおいてもう一度お試しください" };
  }
}

// ─────────────────────────────────────────────
// sendParticipantConfirmation: 特定の1名へ最終確認メッセージを個別配信（送り直し）
// - message-sender を ユーザーJWT + { event_id, participant_id } で呼ぶ（個別送信モード）
// - message-sender 側が RLS でイベントアクセス権を検証し、participant が当該イベント配下か確認
// - confirm_status / status に関係なく送信し、既存回答を消して1問目からクリーン再開する
// ─────────────────────────────────────────────
export async function sendParticipantConfirmation(
  participantId: string,
  eventId: string
): Promise<{ success: boolean; sent?: number; failed?: number; error?: string }> {
  const supabase = await createClient();

  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    return { success: false, error: "ログインが必要です" };
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/message-sender`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ event_id: eventId, participant_id: participantId }),
      signal: AbortSignal.timeout(30_000),
    });
    const body = (await res.json().catch(() => ({}))) as {
      status?: string;
      sent?: number;
      failed?: number;
    };

    if (!res.ok || body.status !== "ok") {
      if (res.status === 403) {
        return { success: false, error: "この参加者への配信権限がありません" };
      }
      return { success: false, error: "配信に失敗しました。時間をおいてもう一度お試しください" };
    }

    revalidatePath(`/events/${eventId}`);
    return {
      success: true,
      sent: body.sent ?? 0,
      failed: body.failed ?? 0,
    };
  } catch {
    return { success: false, error: "配信に失敗しました。時間をおいてもう一度お試しください" };
  }
}
