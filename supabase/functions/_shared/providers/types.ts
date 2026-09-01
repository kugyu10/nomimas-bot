// プロバイダー抽象化インターフェース型定義
// EVENT-02: プラットフォームURL（Twipla/将来的にPeatix等）から参加者リストを取得するプロバイダーの契約
// RESEARCH.md Pattern 1 のシグネチャに準拠

/**
 * **ページ上のセクションから読み取れる値**。パース結果にのみ使う。
 * DB の participants.status はこれに 'left'（ページから消えた = 参加取消）を
 * 加えた集合であり、'left' はパーサが返す値ではないのでここには含めない。
 */
export type ParticipantStatus = "attending" | "interested" | "declined" | "unknown";

export interface ScrapedParticipant {
  displayName: string; // Twipla: a.card.namelist の n属性（フォールバック: テキストノード）
  screenName: string | null; // Twipla: s属性（Xスクリーンネーム）
  profileUrl: string | null; // Twipla: href（/users/<screenName>）
  status: ParticipantStatus;
}

export interface ScrapeResult {
  platform: string; // "twipla" 等
  sourceUrl: string;
  participants: ScrapedParticipant[];
  capacity: number | null; // "参加者 (2人／定員15人)" から抽出。表記なしの場合 null
  fetchedAt: string; // ISO8601
  // 見つかったセクション数（Twipla: div.member_list の個数）。
  // 「セクションが1つも無い」（=取得失敗・マークアップ変更・エラーページ等）と
  // 「セクションはあるが参加者0人」を区別するためのフィールド。
  // sectionCount === 0 のときは participants が空でも「取得失敗」として扱うべきで、
  // 「全員が離脱した」という意味の0件と混同してはならない。
  sectionCount: number;
}

export interface ParticipantListProvider {
  readonly platform: string; // "twipla"
  canHandle(url: string): boolean; // hostnameがtwipla.jpか等 — SSRF対策を兼ねる
  fetchParticipants(url: string): Promise<ScrapeResult>;
}
