/**
 * _shared/notify/broadcast_log.ts
 * message-sender（参加者本人への最終確認配信）の実行結果を
 * notification_logs 用の行データに変換する純関数群。
 *
 * 設計方針:
 *   - I/O を含まない（DBアクセス・console出力なし）。message-sender 側が
 *     この関数の戻り値をそのまま insert する。
 *   - kind: "confirm_broadcast" は主催者向け（notifier.ts）とは別カテゴリ。
 *     イベント単位（1イベント=1行）で集計する。
 *   - detail は recipients/sent/failed/skipped_no_line_id の件数キーのみ
 *     （名前・LINE userId 等の PII は入れない — T-04-06 と同じ規約）。
 */

/** 対象1名分の配信試行結果（PII を含まない最小限の情報） */
export interface ConfirmBroadcastTargetResult {
  eventId: string;
  oaConfigId: string;
  /** push 成功なら true。questions未設定/buildInitialMessages失敗/push失敗はすべて false */
  success: boolean;
}

/** イベント単位に集計した結果 */
export interface ConfirmBroadcastAggregate {
  eventId: string;
  oaConfigId: string;
  recipients: number;
  sent: number;
  failed: number;
}

/** notification_logs への insert 用の行（participant_id は常に null — 1行=Nイベント参加者の集計） */
export interface ConfirmBroadcastLogRow {
  oa_config_id: string;
  event_id: string;
  participant_id: null;
  kind: "confirm_broadcast";
  recipients: number;
  sent: number;
  failed: number;
  skipped_no_line_id: number;
  detail: {
    recipients: number;
    sent: number;
    failed: number;
    skipped_no_line_id: number;
  };
}

/**
 * 対象0件のとき notification_logs に行を書くか。
 *
 * cron モードで「その日は配信対象者がいなかった」は日常的に起きる正常状態であり、
 * notifier.ts の「窓外は行を書かない（行が無いこと自体が検証情報）」という既存の
 * 設計方針（Pattern 4）と揃える。対象が1件でもあれば行を書く。
 */
export function shouldLogConfirmBroadcast(targetCount: number): boolean {
  return targetCount > 0;
}

/**
 * 対象ごとの結果を event_id 単位に集計する。
 * 入力の出現順を保持して安定した順序で返す（同一 eventId の最初の出現順）。
 */
export function aggregateConfirmBroadcastResults(
  results: ConfirmBroadcastTargetResult[],
): ConfirmBroadcastAggregate[] {
  const order: string[] = [];
  const byEvent = new Map<string, ConfirmBroadcastAggregate>();

  for (const r of results) {
    let agg = byEvent.get(r.eventId);
    if (!agg) {
      agg = { eventId: r.eventId, oaConfigId: r.oaConfigId, recipients: 0, sent: 0, failed: 0 };
      byEvent.set(r.eventId, agg);
      order.push(r.eventId);
    }
    agg.recipients++;
    if (r.success) {
      agg.sent++;
    } else {
      agg.failed++;
    }
  }

  return order.map((eventId) => byEvent.get(eventId) as ConfirmBroadcastAggregate);
}

/**
 * イベント単位の集計から notification_logs insert 行を組み立てる。
 *
 * skippedNoLineId（count_unlinked_confirm_targets() の戻り値）は cron モードの
 * 全体集計であり、特定のイベントに紐づく数値ではない。event_id が NOT NULL の
 * ため必ずどこかのイベント行に載せる必要があるが、同じ値を複数行に重複して載せると
 * 「行を横断して skipped_no_line_id を合計すると値が増幅する」ため、最初の
 * イベント行にのみ記録し、残りは 0 にする。
 * 手動配信モード（イベント1件に絞られる）では常に aggregates.length === 1 のため
 * この分岐は影響しない。
 */
export function buildConfirmBroadcastLogRows(
  aggregates: ConfirmBroadcastAggregate[],
  skippedNoLineId: number,
): ConfirmBroadcastLogRow[] {
  return aggregates.map((agg, index) => {
    const skipped = index === 0 ? skippedNoLineId : 0;
    return {
      oa_config_id: agg.oaConfigId,
      event_id: agg.eventId,
      participant_id: null,
      kind: "confirm_broadcast",
      recipients: agg.recipients,
      sent: agg.sent,
      failed: agg.failed,
      skipped_no_line_id: skipped,
      detail: {
        recipients: agg.recipients,
        sent: agg.sent,
        failed: agg.failed,
        skipped_no_line_id: skipped,
      },
    };
  });
}
