"use server";
/**
 * admin/lib/actions/linking.ts
 * 手動紐付け / 解除 server actions（ADMIN-02）
 *
 * T-03-02: 他OAの line_user への紐付けは DB 側 with check（participants_oa_member_update）が拒否し
 *          RLS が raise exception する。このアクションはその例外を捕捉してエラー文言を返す。
 * T-03-12: .select() 付き UPDATE + 0行チェックで silent-0-row 罠を回避。
 */
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/** linkParticipant / unlinkParticipant の共通戻り型 */
export interface LinkActionResult {
  success: boolean;
  error?: string;
}

/**
 * 参加者に LINE ユーザーを紐付ける
 *
 * @param participantId - 紐付け対象の participants.id
 * @param lineUserId    - 紐付け先の line_users.id（UUID）
 * @param eventId       - revalidatePath 用のイベント ID
 */
export async function linkParticipant(
  participantId: string,
  lineUserId: string,
  eventId: string,
): Promise<LinkActionResult> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("participants")
    .update({ line_user_id: lineUserId })
    .eq("id", participantId)
    .select("id"); // T-03-12: 返却行数チェックで silent-0-row を検出

  if (error) {
    console.error("linkParticipant error:", error);
    // RLS with check 違反（他OA line_user への紐付け）も含め統一エラー文言
    return {
      success: false,
      error: "保存に失敗しました。入力内容を確認してもう一度お試しください",
    };
  }

  if (!data || data.length === 0) {
    // silent-0-row: RLS で行が見えなかった or with check 拒否
    return {
      success: false,
      error: "保存に失敗しました。入力内容を確認してもう一度お試しください",
    };
  }

  revalidatePath(`/events/${eventId}`);
  return { success: true };
}

/**
 * 参加者の LINE ユーザー紐付けを解除する
 *
 * @param participantId - 解除対象の participants.id
 * @param eventId       - revalidatePath 用のイベント ID
 */
export async function unlinkParticipant(
  participantId: string,
  eventId: string,
): Promise<LinkActionResult> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("participants")
    .update({ line_user_id: null })
    .eq("id", participantId)
    .select("id"); // T-03-12: 0行チェック

  if (error) {
    console.error("unlinkParticipant error:", error);
    return {
      success: false,
      error: "保存に失敗しました。入力内容を確認してもう一度お試しください",
    };
  }

  if (!data || data.length === 0) {
    return {
      success: false,
      error: "保存に失敗しました。入力内容を確認してもう一度お試しください",
    };
  }

  revalidatePath(`/events/${eventId}`);
  return { success: true };
}
