// admin/tests/unit/event-schema.test.ts
// eventFormSchema / platformUrlSchema / composeMeetingAt の vitest ユニットテスト
// ネット不要・決定的
import { describe, it, expect } from "vitest";
import {
  platformUrlSchema,
  eventFormSchema,
  composeMeetingAt,
  CONFIRM_DAYS_OPTIONS,
} from "@/lib/schemas/event";

// ─────────────────────────────────────────────
// platformUrlSchema
// ─────────────────────────────────────────────
describe("platformUrlSchema", () => {
  // accept ケース
  it("正規形の Twipla URL を accept する", () => {
    const result = platformUrlSchema.safeParse({
      platform: "twipla",
      url: "https://twipla.jp/events/123456",
    });
    expect(result.success).toBe(true);
  });

  it("別のイベント ID でも accept する", () => {
    const result = platformUrlSchema.safeParse({
      platform: "twipla",
      url: "https://twipla.jp/events/1",
    });
    expect(result.success).toBe(true);
  });

  // reject ケース
  it("http（http:// 始まり）を reject する", () => {
    const result = platformUrlSchema.safeParse({
      platform: "twipla",
      url: "http://twipla.jp/events/123456",
    });
    expect(result.success).toBe(false);
  });

  it("クエリ文字列付きを reject する", () => {
    const result = platformUrlSchema.safeParse({
      platform: "twipla",
      url: "https://twipla.jp/events/123456?foo=bar",
    });
    expect(result.success).toBe(false);
  });

  it("末尾スラッシュ付きを reject する", () => {
    const result = platformUrlSchema.safeParse({
      platform: "twipla",
      url: "https://twipla.jp/events/123456/",
    });
    expect(result.success).toBe(false);
  });

  it("twipla 以外のドメインを reject する", () => {
    const result = platformUrlSchema.safeParse({
      platform: "twipla",
      url: "https://peatix.com/events/123456",
    });
    expect(result.success).toBe(false);
  });

  it("フラグメント付きを reject する", () => {
    const result = platformUrlSchema.safeParse({
      platform: "twipla",
      url: "https://twipla.jp/events/123456#section",
    });
    expect(result.success).toBe(false);
  });

  it("数値以外のパスを reject する", () => {
    const result = platformUrlSchema.safeParse({
      platform: "twipla",
      url: "https://twipla.jp/events/abc",
    });
    expect(result.success).toBe(false);
  });

  it("空文字 URL を reject する", () => {
    const result = platformUrlSchema.safeParse({
      platform: "twipla",
      url: "",
    });
    expect(result.success).toBe(false);
  });

  it("ポート付きを reject する", () => {
    const result = platformUrlSchema.safeParse({
      platform: "twipla",
      url: "https://twipla.jp:8080/events/123456",
    });
    expect(result.success).toBe(false);
  });

  it("無効なプラットフォームを reject する", () => {
    const result = platformUrlSchema.safeParse({
      platform: "peatix",
      url: "https://twipla.jp/events/123456",
    });
    expect(result.success).toBe(false);
  });
});

// ─────────────────────────────────────────────
// eventFormSchema
// ─────────────────────────────────────────────
describe("eventFormSchema", () => {
  const validBase = {
    title: "テストイベント",
    event_date: "2026-06-15",
    confirm_days_before: 3,
    platform_urls: [{ platform: "twipla", url: "https://twipla.jp/events/123" }],
  };

  it("最小限の必須フィールドで accept する", () => {
    const result = eventFormSchema.safeParse(validBase);
    expect(result.success).toBe(true);
  });

  it("全フィールドを含めても accept する", () => {
    const result = eventFormSchema.safeParse({
      ...validBase,
      meeting_time: "18:30",
      meeting_place: "渋谷",
      fee: "1000",
      venue_info: "B1F 居酒屋",
    });
    expect(result.success).toBe(true);
  });

  it("title が空文字の場合 reject する", () => {
    const result = eventFormSchema.safeParse({ ...validBase, title: "" });
    expect(result.success).toBe(false);
  });

  it("event_date が空文字の場合 reject する", () => {
    const result = eventFormSchema.safeParse({ ...validBase, event_date: "" });
    expect(result.success).toBe(false);
  });

  it("platform_urls が空配列の場合 reject する", () => {
    const result = eventFormSchema.safeParse({ ...validBase, platform_urls: [] });
    expect(result.success).toBe(false);
  });

  it("confirm_days_before が選択肢以外の値（4）を reject する", () => {
    const result = eventFormSchema.safeParse({
      ...validBase,
      confirm_days_before: 4,
    });
    expect(result.success).toBe(false);
  });

  it("confirm_days_before の全有効値（1/2/3/5/7）を accept する", () => {
    for (const days of CONFIRM_DAYS_OPTIONS) {
      const result = eventFormSchema.safeParse({
        ...validBase,
        confirm_days_before: days,
      });
      expect(result.success, `confirm_days_before=${days} should pass`).toBe(true);
    }
  });

  it("platform_urls に無効な URL が含まれる場合 reject する", () => {
    const result = eventFormSchema.safeParse({
      ...validBase,
      platform_urls: [{ platform: "twipla", url: "http://twipla.jp/events/123" }],
    });
    expect(result.success).toBe(false);
  });

  it("default の confirm_days_before は 3", () => {
    const result = eventFormSchema.safeParse({
      title: "テスト",
      event_date: "2026-06-15",
      platform_urls: [{ platform: "twipla", url: "https://twipla.jp/events/123" }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.confirm_days_before).toBe(3);
    }
  });
});

// ─────────────────────────────────────────────
// composeMeetingAt
// ─────────────────────────────────────────────
describe("composeMeetingAt", () => {
  it("date と time を JST 固定の timestamptz 文字列に合成する", () => {
    expect(composeMeetingAt("2026-06-15", "18:30")).toBe(
      "2026-06-15T18:30:00+09:00"
    );
  });

  it("time が undefined のとき null を返す", () => {
    expect(composeMeetingAt("2026-06-15", undefined)).toBeNull();
  });

  it("time が null のとき null を返す", () => {
    expect(composeMeetingAt("2026-06-15", null)).toBeNull();
  });

  it("time が空文字のとき null を返す", () => {
    expect(composeMeetingAt("2026-06-15", "")).toBeNull();
  });

  it("time がスペースのみのとき null を返す", () => {
    expect(composeMeetingAt("2026-06-15", "   ")).toBeNull();
  });

  it("00:00 は有効な time として合成する", () => {
    expect(composeMeetingAt("2026-01-01", "00:00")).toBe(
      "2026-01-01T00:00:00+09:00"
    );
  });

  it("23:59 は有効な time として合成する", () => {
    expect(composeMeetingAt("2026-12-31", "23:59")).toBe(
      "2026-12-31T23:59:00+09:00"
    );
  });
});
