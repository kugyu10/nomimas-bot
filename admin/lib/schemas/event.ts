// admin/lib/schemas/event.ts
// イベントフォームの zod スキーマ + composeMeetingAt 純関数
// Locked stack: zod 4.4.3
import { z } from "zod";

// プラットフォーム種別（v1 は twipla のみ — RESEARCH Open Question 2）
export const PLATFORM_OPTIONS = ["twipla"] as const;
export type Platform = (typeof PLATFORM_OPTIONS)[number];

// confirm_days_before の選択肢（UI-SPEC Copywriting Contract: 1日前/2日前/3日前/5日前/7日前）
export const CONFIRM_DAYS_OPTIONS = [1, 2, 3, 5, 7] as const;
export type ConfirmDays = (typeof CONFIRM_DAYS_OPTIONS)[number];

/**
 * platformUrlSchema: Twipla URL 正規形強制
 * - https 必須（http 不可）
 * - query / fragment 不可
 * - 末尾スラッシュ不可
 * - scraper の canHandle と完全一致（canHandle が query/hash/port を拒否済み）
 */
export const platformUrlSchema = z.object({
  platform: z.enum(["twipla"]),
  url: z
    .string()
    .min(1, "URLを入力してください")
    .regex(
      /^https:\/\/twipla\.jp\/events\/[0-9]+$/,
      "Twipla イベント URL の形式で入力してください（例: https://twipla.jp/events/123456）"
    ),
});

export type PlatformUrl = z.infer<typeof platformUrlSchema>;

/**
 * eventFormSchema: イベント作成/編集フォームのバリデーション
 * - title: 必須
 * - event_date: 必須（date 文字列 YYYY-MM-DD）
 * - meeting_time: 任意（HH:mm）— DB 保存時は composeMeetingAt で timestamptz に変換
 * - meeting_place: 任意
 * - fee: 任意（数値を文字列として入力）
 * - venue_info: 任意
 * - confirm_days_before: 1/2/3/5/7 の整数、default 3
 * - platform_urls: min 1 グループ
 */
export const eventFormSchema = z.object({
  title: z.string().min(1, "イベント名を入力してください"),
  event_date: z.string().min(1, "開催日を入力してください").regex(
    /^\d{4}-\d{2}-\d{2}$/,
    "開催日は YYYY-MM-DD 形式で入力してください"
  ),
  meeting_time: z.string().optional(),
  meeting_place: z.string().optional(),
  fee: z.string().optional(),
  venue_info: z.string().optional(),
  confirm_days_before: z
    .number()
    .int()
    .refine(
      (n): boolean => (CONFIRM_DAYS_OPTIONS as readonly number[]).includes(n),
      { message: "confirm_days_before は 1/2/3/5/7 のいずれかを選択してください" }
    ),
  platform_urls: z
    .array(platformUrlSchema)
    .min(1, "プラットフォームURLを1件以上入力してください"),
});

export type EventFormValues = z.infer<typeof eventFormSchema>;

/**
 * composeMeetingAt: event_date + 集合時刻(HH:mm) を JST 固定の timestamptz 文字列に変換する純関数
 * - time 未入力（空文字/undefined）なら null を返す
 * - 返却形式: "YYYY-MM-DDTHH:mm:00+09:00"（Supabase timestamptz として有効）
 */
export function composeMeetingAt(
  date: string,
  time: string | undefined | null
): string | null {
  if (!time || time.trim() === "") return null;
  return `${date}T${time}:00+09:00`;
}

/**
 * extractTimeJst: timestamptz 文字列から JST の HH:mm を取り出す純関数
 * （composeMeetingAt の逆方向 — 編集フォームの初期値用）
 *
 * PostgREST は timestamptz を DB タイムゾーン（Supabase は UTC）で返すため、
 * "2026-06-15T09:30:00+00:00"（= 18:30 JST）のような値が来る。
 * 文字列の HH:mm を直接読むとUTC時刻を JST として再保存し -9h ずれるため、
 * 必ず Date 経由で Asia/Tokyo に変換してから抽出する（03-REVIEW WR-01）。
 */
export function extractTimeJst(meetingAt: string | null | undefined): string {
  if (!meetingAt) return "";
  const d = new Date(meetingAt);
  if (isNaN(d.getTime())) return "";
  // JST 固定で HH:mm を取り出す（composeMeetingAt の +09:00 と対称）
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(d);
}
