/**
 * scripts/v11/lib.ts
 * v1.1 ポーリング検証スクリプト群の共有定数・ヘルパー
 * （seed-dev-event.ts / check-live-poll.ts が同じ対象を解決するために使う）
 */

/** dev の対象 OA 名（`飲みmasDev` = oa_configs id が ...0001 の行） */
export const OA_NAME = "飲みmasDev";

/** 検証用イベントのタイトル（seed-dev-event.ts が作る行の識別に使う） */
export const EVENT_TITLE = "v1.1ポーリング検証イベント";

/**
 * 検証に使う Twipla イベントURL。これ以外のURLを叩いてはいけない
 * （実サイトへの通信は https://twipla.jp/events/741123 のみ・最短30秒間隔）
 */
export const TARGET_URL = "https://twipla.jp/events/741123";

/**
 * JST の日付文字列（YYYY-MM-DD）を返す。daysOffset で日をずらせる。
 * 例: jstDateString(1) = 「今日(JST)の翌日」
 */
export function jstDateString(daysOffset = 0): string {
  const now = new Date();
  const shifted = new Date(
    now.getTime() + 9 * 60 * 60 * 1000 + daysOffset * 24 * 60 * 60 * 1000,
  );
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const d = String(shifted.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
