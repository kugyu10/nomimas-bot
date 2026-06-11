// 日時表示整形ヘルパー（02-REVIEW CR-01対応）
// timestamptz の UTC ISO 文字列 / date 文字列を Asia/Tokyo のユーザー向け表記に変換する純関数。
// PostgREST 経由の meeting_at は UTC ISO 8601（例: "2026-06-15T09:00:00+00:00"）で返るため、
// そのままユーザーに見せると JST 利用者が時刻を誤読する（CR-01）。

/**
 * meeting_at（timestamptz の ISO 8601 文字列）を JST 表記に整形する。
 * 例: "2026-06-15T09:00:00+00:00" → "6/15 18:00"
 *
 * null・パース不能な値は null を返す（誤解を招く生文字列を表示するより行ごと省略する）。
 */
export function formatMeetingAt(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

/**
 * event_date（date 列の "YYYY-MM-DD" 文字列）を日本語表記に整形する。
 * 例: "2026-06-15" → "2026年6月15日"
 *
 * date 列はタイムゾーンを持たないため JST の日付として解釈する。
 * パース不能な値は raw のまま返す（日付文字列はTZ誤読の危険がないため情報を落とさない）。
 */
export function formatEventDate(dateStr: string | null): string | null {
  if (!dateStr) return null;
  const d = new Date(`${dateStr}T00:00:00+09:00`);
  if (isNaN(d.getTime())) return dateStr;
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(d);
}
