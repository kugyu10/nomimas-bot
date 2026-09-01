/**
 * _shared/notify/messages.ts
 * 通知テキスト組み立て純関数（外部I/Oゼロ — Deno ユニットテスト対象）
 *
 * Locked: 文面は「参加者名・更新種別・イベント名」の3要素のみ。
 * 質問内容・回答値・LINE userId は引数にも文面にも入れない（T-04-03）。
 * シグネチャに userId 引数がないことが型による担保。
 *
 * 文面例（Pitfall 11 準拠）:
 *   answer:          「【夏の飲み会】田中太郎さんが最終確認の回答を更新しました」
 *   completion:      「【夏の飲み会】山田花子さんが最終確認を完了しました\n現在の確定参加者: 5名」
 *   scrape_changes:  「【夏の飲み会】参加者情報が更新されました（新規2名・出欠変更1名）」
 */

/**
 * 回答更新通知テキストを組み立てる。
 * @param eventTitle イベント名
 * @param participantName 参加者の表示名
 */
export function buildAnswerNotification(eventTitle: string, participantName: string): string {
  return `【${eventTitle}】${participantName}さんが最終確認の回答を更新しました`;
}

/**
 * 最終確認完了通知テキストを組み立てる。
 * @param eventTitle イベント名
 * @param participantName 参加者の表示名
 * @param confirmedCount 現在の確定（最終確認完了）参加者数。未指定なら件数行を出さない
 */
export function buildCompletionNotification(
  eventTitle: string,
  participantName: string,
  confirmedCount?: number,
): string {
  const base = `【${eventTitle}】${participantName}さんが最終確認を完了しました`;
  return typeof confirmedCount === "number"
    ? `${base}\n現在の確定参加者: ${confirmedCount}名`
    : base;
}

/**
 * スクレイプ差分通知テキストを組み立てる（1スクレイプ = 1サマリ）。
 * @param eventTitle イベント名
 * @param counts 新規参加者数と出欠変更数
 */
export function buildScrapeChangesNotification(
  eventTitle: string,
  // departedCount は**必須**にしてある。オプショナルだと将来別の呼び出しを足したとき
  // 渡し忘れが型で捕まらず、黙って「参加取消0名」になる（PR #5 レビュー2 の指摘）。
  // 本番の呼び出し元は notifier.ts の1箇所だけなので、必須化のコストは小さい。
  counts: { newCount: number; statusChangedCount: number; departedCount: number },
): string {
  // 参加取消（ページから行ごと消えた人）は出欠変更とは別の変化なので独立して出す。
  // 0 のときも表示して「減っていない」ことを明示する。
  const departed = counts.departedCount;
  return `【${eventTitle}】参加者情報が更新されました（新規${counts.newCount}名・出欠変更${counts.statusChangedCount}名・参加取消${departed}名）`;
}
