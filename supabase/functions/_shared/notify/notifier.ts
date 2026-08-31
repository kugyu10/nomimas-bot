/**
 * _shared/notify/notifier.ts
 * 通知本体（受信者解決 → 窓判定 → push → notification_logs 記録）
 *
 * 公開関数:
 *   - notifyConfirmUpdate: webhook 経路（回答保存/完了時）
 *   - notifyScrapeChanges: scraper 経路（再スクレイプ差分時）
 *
 * 設計方針:
 *   - I/O 層。窓判定・差分計算・文面は _shared/notify 純関数を使用
 *   - 呼び出し側（webhook/scraper）は結果を try/catch で握り、失敗を 200 契約に漏らさない
 *   - notification_logs への INSERT は送信実行時のみ（窓外は行を書かない — Pattern 4）
 *   - console.log/error に LINE userId・参加者生データを含めない（T-04-06 / T-02-14）
 *
 * セキュリティ:
 *   - T-04-06: 文面は messages.ts 経由を強制。detail は件数 jsonb のみ
 *   - T-04-07: notify は reply 後 + 呼び出し側 try/catch で握る（Pitfall 3）
 *   - T-04-08: 1スクレイプ=1サマリ通知。初回スキップ
 *   - T-04-09: 保存成功後のみ到達（コード順で構造的に担保）
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { issueStatelessToken } from "../line/token.ts";
import { pushMessage } from "../line/client.ts";
import { isWithinNotifyWindow, todayJst } from "./window.ts";
import {
  buildAnswerNotification,
  buildCompletionNotification,
  buildScrapeChangesNotification,
} from "./messages.ts";

/** notifier の公開戻り値（Pattern 1） */
export interface NotifyResult {
  kind: "answer" | "completion" | "scrape_changes";
  /** false なら送信ゼロ・logs にも書かない（件数はconsoleログ） */
  inWindow: boolean;
  /** line_user_id 非null の owner/co-owner 数 */
  recipients: number;
  sent: number;
  failed: number;
  /** line_user_id null でスキップした member 数 */
  skippedNoLineId: number;
}

/**
 * webhook 経路: 回答保存/完了時に owner/co-owner へ通知
 *
 * @param supabase    - service role クライアント（RLS 非適用）
 * @param getToken    - webhook の既存トークンキャッシュを再利用する関数
 * @param params      - 参加者ID と通知種別
 */
export async function notifyConfirmUpdate(
  supabase: SupabaseClient,
  getToken: () => Promise<string | null>,
  params: { participantId: string; kind: "answer" | "completion" },
): Promise<NotifyResult> {
  const baseResult: NotifyResult = {
    kind: params.kind,
    inWindow: false,
    recipients: 0,
    sent: 0,
    failed: 0,
    skippedNoLineId: 0,
  };

  // (a) participants → epu → event を1クエリで解決（Code Examples のネスト select）
  const { data: participantData, error: participantError } = await supabase
    .from("participants")
    .select("id, display_name, event_platform_urls(events(id, title, event_date, oa_config_id))")
    .eq("id", params.participantId)
    .single();

  if (participantError || !participantData) {
    console.log(
      `notify: participant not found — skipping (kind=${params.kind}, participant_id=${params.participantId})`,
    );
    return baseResult;
  }

  // 型安全な取り出し（supabase-js のネスト select は unknown として受け取り）
  const epuData = participantData.event_platform_urls as unknown as
    | { events: { id: string; title: string; event_date: string | null; oa_config_id: string } | null }
    | null;
  const ev = epuData?.events;

  if (!ev) {
    console.log(
      `notify: event not found for participant — skipping (kind=${params.kind})`,
    );
    return baseResult;
  }

  // (b) 窓判定（Pattern 3）— 窓外は logs に行を書かず return（Pattern 4 の検証規約）
  if (!isWithinNotifyWindow(ev.event_date, todayJst())) {
    console.log(
      `notify: out of window — skipped (kind=${params.kind}, event_id=${ev.id})`,
    );
    return { ...baseResult, inWindow: false };
  }

  // (c) チャネル一致ガード（Pitfall 4: マルチOAとグローバルLINEチャネルの不一致）
  const lineChannelId = Deno.env.get("LINE_CHANNEL_ID") ?? "";
  const { data: oaData } = await supabase
    .from("oa_configs")
    .select("line_channel_id")
    .eq("id", ev.oa_config_id)
    .single();

  if (!oaData || oaData.line_channel_id !== lineChannelId) {
    console.log(
      `notify: oa_config line_channel_id mismatch — skipped (kind=${params.kind}, event_id=${ev.id})`,
    );
    return { ...baseResult, inWindow: true };
  }

  // (d) 受信者解決（oa_members を service role で読む — RLS 非適用）
  const { data: members, error: membersError } = await supabase
    .from("oa_members")
    .select("line_user_id")
    .eq("oa_config_id", ev.oa_config_id);

  // 04-REVIEW WR-04: SELECT 失敗を「受信者が本当に0」と区別する。
  // recipients=0 に偽装すると notification_logs（NOTIF-01 の機械検証基盤）が
  // インフラ障害を正常ゼロ送信として記録してしまうため、detail.recipients_error
  // 付きの行を記録して return（件数のみ・PII なし — T-04-06。throw しない — T-04-07）
  if (membersError) {
    console.error(
      `notify: oa_members select failed (kind=${params.kind}): ${membersError.message}`,
    );
    const { error: logError } = await supabase
      .from("notification_logs")
      .insert({
        oa_config_id: ev.oa_config_id,
        event_id: ev.id,
        participant_id: params.participantId,
        kind: params.kind,
        recipients: 0,
        sent: 0,
        failed: 0,
        skipped_no_line_id: 0,
        detail: { recipients_error: true },
      });
    if (logError) {
      console.error(`notify: notification_logs insert failed: ${logError.message}`);
    }
    return { ...baseResult, inWindow: true };
  }

  const allMembers = members ?? [];
  const recipientMembers = allMembers.filter((m) => m.line_user_id != null);
  const skippedNoLineId = allMembers.length - recipientMembers.length;
  const recipients = recipientMembers.length;

  // (e) push 送信（宛先ごとに try/catch で failed カウントして継続 — message-sender の per-target 継続パターン）
  const token = await getToken();
  let sent = 0;
  let failed = 0;

  if (token && recipients > 0) {
    const displayName = (participantData as { display_name?: string }).display_name ?? "参加者";
    let text: string;
    if (params.kind === "completion") {
      // 確定（最終確認完了）参加者数を算出して文面に含める。
      // この時点で当該participantは既に confirm_status='completed' に更新済み（webhook (b)）。
      // カウント失敗時は件数なしの文面にフォールバック（通知自体は止めない）
      const { count, error: countError } = await supabase
        .from("participants")
        .select("id, event_platform_urls!inner(event_id)", { count: "exact", head: true })
        .eq("confirm_status", "completed")
        .eq("event_platform_urls.event_id", ev.id);
      if (countError) {
        console.error(`notify: completed count failed (event_id=${ev.id}): ${countError.message}`);
      }
      text = buildCompletionNotification(
        ev.title,
        displayName,
        typeof count === "number" ? count : undefined,
      );
    } else {
      text = buildAnswerNotification(ev.title, displayName);
    }
    const messages = [{ type: "text", text }];

    for (const member of recipientMembers) {
      try {
        await pushMessage(token, member.line_user_id as string, messages);
        sent++;
      } catch (err) {
        // 宛先ごとの失敗はカウントして継続（T-04-07）— userId をログしない
        console.error(`notify: push failed (kind=${params.kind}): ${(err as Error).message}`);
        failed++;
      }
    }
  } else if (!token) {
    console.error(`notify: token unavailable — skipping push (kind=${params.kind})`);
    failed = recipients;
  }

  // (f) notification_logs に1行 INSERT（送信実行時のみ）
  const { error: logError } = await supabase
    .from("notification_logs")
    .insert({
      oa_config_id: ev.oa_config_id,
      event_id: ev.id,
      participant_id: params.participantId,
      kind: params.kind,
      recipients,
      sent,
      failed,
      skipped_no_line_id: skippedNoLineId,
      detail: null, // answer/completion は detail null（件数のみ）
    });

  if (logError) {
    console.error(`notify: notification_logs insert failed: ${logError.message}`);
  }

  return {
    kind: params.kind,
    inWindow: true,
    recipients,
    sent,
    failed,
    skippedNoLineId,
  };
}

/**
 * scraper 経路: 再スクレイプで差分が生じた時に owner/co-owner へ通知
 * トークンは notifier 内で issueStatelessToken（scraper はキャッシュを持たない）
 *
 * @param supabase - service role クライアント
 * @param params   - イベント情報 + 差分情報（Pattern 1 のシグネチャ）
 */
export async function notifyScrapeChanges(
  supabase: SupabaseClient,
  params: {
    eventId: string;
    oaConfigId: string;
    eventTitle: string;
    eventDate: string | null;
    newParticipants: { displayName: string; status: string }[];
    statusChanges: { displayName: string; from: string; to: string }[];
    /** ページから消えた参加者（= 参加取消）。件数のみ使う */
    departedParticipants?: { naturalKey: string; status: string }[];
  },
): Promise<NotifyResult> {
  const baseResult: NotifyResult = {
    kind: "scrape_changes",
    inWindow: false,
    recipients: 0,
    sent: 0,
    failed: 0,
    skippedNoLineId: 0,
  };

  // (b) 窓判定（窓外は logs に行を書かず return）
  if (!isWithinNotifyWindow(params.eventDate, todayJst())) {
    console.log(
      `notify: scrape out of window — skipped (event_id=${params.eventId})`,
    );
    return baseResult;
  }

  // (c) チャネル一致ガード（Pitfall 4）
  const lineChannelId = Deno.env.get("LINE_CHANNEL_ID") ?? "";
  const { data: oaData } = await supabase
    .from("oa_configs")
    .select("line_channel_id")
    .eq("id", params.oaConfigId)
    .single();

  if (!oaData || oaData.line_channel_id !== lineChannelId) {
    console.log(
      `notify: scrape oa_config line_channel_id mismatch — skipped (event_id=${params.eventId})`,
    );
    return { ...baseResult, inWindow: true };
  }

  // (d) 受信者解決
  const { data: members, error: membersError } = await supabase
    .from("oa_members")
    .select("line_user_id")
    .eq("oa_config_id", params.oaConfigId);

  // 04-REVIEW WR-04: SELECT 失敗を「受信者0」と区別する（notifyConfirmUpdate と同様）
  if (membersError) {
    console.error(
      `notify: oa_members select failed (kind=scrape_changes): ${membersError.message}`,
    );
    const { error: logError } = await supabase
      .from("notification_logs")
      .insert({
        oa_config_id: params.oaConfigId,
        event_id: params.eventId,
        participant_id: null,
        kind: "scrape_changes",
        recipients: 0,
        sent: 0,
        failed: 0,
        skipped_no_line_id: 0,
        detail: {
          recipients_error: true,
          new: params.newParticipants.length,
          statusChanged: params.statusChanges.length,
          departed: params.departedParticipants?.length ?? 0,
        },
      });
    if (logError) {
      console.error(`notify: notification_logs insert failed (scrape): ${logError.message}`);
    }
    return { ...baseResult, inWindow: true };
  }

  const allMembers = members ?? [];
  const recipientMembers = allMembers.filter((m) => m.line_user_id != null);
  const skippedNoLineId = allMembers.length - recipientMembers.length;
  const recipients = recipientMembers.length;

  // (e) push 送信（scraper はトークンキャッシュを持たない → notifier 内で発行）
  let sent = 0;
  let failed = 0;

  if (recipients > 0) {
    const lineSecret = Deno.env.get("LINE_CHANNEL_SECRET") ?? "";
    let token: string | null = null;

    try {
      token = await issueStatelessToken(lineChannelId, lineSecret);
    } catch (err) {
      console.error(`notify: scrape token issue failed: ${(err as Error).message}`);
    }

    if (token) {
      const text = buildScrapeChangesNotification(params.eventTitle, {
        newCount: params.newParticipants.length,
        statusChangedCount: params.statusChanges.length,
        departedCount: params.departedParticipants?.length ?? 0,
      });
      const messages = [{ type: "text", text }];

      for (const member of recipientMembers) {
        try {
          await pushMessage(token, member.line_user_id as string, messages);
          sent++;
        } catch (err) {
          // userId をログしない（T-04-06）
          console.error(`notify: scrape push failed: ${(err as Error).message}`);
          failed++;
        }
      }
    } else {
      failed = recipients;
    }
  }

  // (f) notification_logs に1行 INSERT（1スクレイプ=1サマリ通知 — Pitfall 2）
  const { error: logError } = await supabase
    .from("notification_logs")
    .insert({
      oa_config_id: params.oaConfigId,
      event_id: params.eventId,
      participant_id: null, // scrape 通知は特定参加者に紐付かない
      kind: "scrape_changes",
      recipients,
      sent,
      failed,
      skipped_no_line_id: skippedNoLineId,
      detail: {
        new: params.newParticipants.length,
        statusChanged: params.statusChanges.length,
        departed: params.departedParticipants?.length ?? 0,
      },
    });

  if (logError) {
    console.error(`notify: notification_logs insert failed (scrape): ${logError.message}`);
  }

  return {
    kind: "scrape_changes",
    inWindow: true,
    recipients,
    sent,
    failed,
    skippedNoLineId,
  };
}
