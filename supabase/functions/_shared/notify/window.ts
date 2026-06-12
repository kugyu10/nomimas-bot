/**
 * _shared/notify/window.ts
 * 通知窓判定の純関数（外部I/Oゼロ — Deno ユニットテスト対象）
 *
 * 通知窓: event_date - 2日 <= today（2日前以降）かつ event_date >= today（未終了・当日含む）
 * 既存 get_confirm_targets の `(now() at time zone 'Asia/Tokyo')::date` 流儀を TS に写像
 */

/**
 * JST の今日を 'YYYY-MM-DD' で返す。
 * en-CA ロケールは ISO 形式（YYYY-MM-DD）を出力する。
 */
export function todayJst(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(new Date());
}

/**
 * 通知窓判定: event_date - 2日 <= today かつ event_date >= today ならば true。
 * - eventDate null は窓外扱い（通知しない）
 * - diff=0（当日）/ diff=1 / diff=2（2日後）→ true
 * - diff=3（3日後）/ diff<0（終了後）/ null → false
 *
 * Date.parse("YYYY-MM-DD") は UTC midnight 解釈 → 両辺同形で日数差が常に整数
 * [VERIFIED: ECMAScript date-only forms are UTC per ECMA-262]
 */
export function isWithinNotifyWindow(eventDate: string | null, today: string): boolean {
  if (!eventDate) return false;
  const diffDays = (Date.parse(eventDate) - Date.parse(today)) / 86_400_000;
  return diffDays >= 0 && diffDays <= 2;
}
