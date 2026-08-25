// Twiplaプロバイダー実装
// parseTwiplaHtml: HTMLからセクション単位で参加者を抽出する純関数
// twiplaProvider: ParticipantListProvider 実装（fetch + parse + SSRF防止）
//
// 落とし穴: $("a.card.namelist") をページ全体に適用すると「興味あり」「不参加」も全件ヒットする
// 必ず div.member_list セクション単位でスコープし先頭テキストでステータス判別すること（RESEARCH.md Pitfall 1）

import * as cheerio from "cheerio";
import type {
  ParticipantListProvider,
  ParticipantStatus,
  ScrapedParticipant,
  ScrapeResult,
} from "./types.ts";

/**
 * TwiplaイベントページのHTMLを解析し参加者リストを返す純関数
 * セクション（参加者/興味あり/不参加）ごとにスコープして抽出することで
 * 「興味あり」「不参加」の混入を防ぐ
 */
export function parseTwiplaHtml(html: string, sourceUrl: string): ScrapeResult {
  const $ = cheerio.load(html);
  const participants: ScrapedParticipant[] = [];
  let capacity: number | null = null;

  // 見つかった div.member_list セクション数。
  // 0件なら「セクションはあるが空」ではなく「取得失敗（マークアップ変更等）」の可能性が高い —
  // 呼び出し側（scraper/index.ts）でこの区別を使う。
  const sectionCount = $("div.member_list").length;

  // deno-lint-ignore no-explicit-any
  $("div.member_list").each((_: number, section: any) => {
    // セクション先頭テキストでステータスを判別する
    // 例: "参加者 (2人／定員15人) " / "興味あり (2人) " / "不参加 (0人) "
    const label = $(section).contents().first().text().trim();

    const status: ParticipantStatus = label.startsWith("参加者")
      ? "attending"
      : label.startsWith("興味あり")
      ? "interested"
      : label.startsWith("不参加")
      ? "declined"
      : "unknown";

    // 「参加者」セクションのヘッダから定員を抽出
    // 例: "参加者 (2人／定員15人)" → 15
    if (status === "attending") {
      const capacityMatch = label.match(/定員(\d+)人/);
      if (capacityMatch) {
        capacity = parseInt(capacityMatch[1], 10);
      }
    }

    // セクション配下の a.card.namelist からのみ参加者を抽出（スコープ固定）
    // deno-lint-ignore no-explicit-any
    $(section).find("a.card.namelist").each((_: number, el: any) => {
      // `||` で空文字のn属性もテキストへフォールバックさせる（?? は空文字を素通しする — WR-06）
      const displayName = ($(el).attr("n") || $(el).text().trim()) || "";
      if (!displayName) {
        // 名前が取れないエントリはスキップ（空display_name行をDBに作らない）
        return;
      }
      const screenName = $(el).attr("s") ?? null;
      const profileUrl = $(el).attr("href") ?? null;

      participants.push({
        displayName,
        screenName: screenName || null,
        profileUrl: profileUrl || null,
        status,
      });
    });
  });

  return {
    platform: "twipla",
    sourceUrl,
    participants,
    capacity,
    fetchedAt: new Date().toISOString(),
    sectionCount,
  };
}

/**
 * Twiplaプロバイダー実装
 * canHandle: twipla.jp の /events/<数字> URLのみ許可（SSRF防止の一次関門）
 * fetchParticipants: fetchしてparseTwiplaHtmlに渡す
 */
export const twiplaProvider: ParticipantListProvider = {
  platform: "twipla",

  canHandle(url: string): boolean {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return false;
    }

    // スキームはhttp/httpsのみ（ftp://等は拒否）
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return false;
    }

    // hostnameは厳密に twipla.jp（サブドメインを拒否）
    if (parsed.hostname !== "twipla.jp") {
      return false;
    }

    // ポート明示のURLを拒否（URL.hostnameはポートを含まないため別途チェック — WR-02）
    // 標準ポートのWebページのみ許可し、twipla.jpへのポートスキャンを防ぐ
    if (parsed.port !== "") {
      return false;
    }

    // pathnameは /events/<数字> の形式のみ許可
    if (!/^\/events\/\d+$/.test(parsed.pathname)) {
      return false;
    }

    // IN-08: クエリ文字列やフラグメントが付いたURLを拒否する
    // eq("url") によるDB照合は正規URLと完全一致するため、
    // クエリ/ハッシュ付きURLは保存される正規URLと一致せず saved:false になる
    // canHandle で早期拒否することで照合不整合経路を遮断する
    // （URL正規化はPhase 3のURL登録UIで再検討 — IN-08軽量対応）
    if (parsed.search !== "" || parsed.hash !== "") {
      return false;
    }

    return true;
  },

  async fetchParticipants(url: string): Promise<ScrapeResult> {
    // リダイレクト追跡を無効化（SSRF対策: リダイレクト先の制御を防ぐ）
    // タイムアウト10秒: twipla.jpの応答保留でEdge Functionが滞留するのを防ぐ（WR-04）
    const response = await fetch(url, {
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      throw new Error(`Twipla fetch failed: ${response.status} ${response.statusText}`);
    }

    const html = await response.text();
    return parseTwiplaHtml(html, url);
  },
};
