/**
 * _shared/notify/diff.ts
 * scraper 変化検出の純関数（外部I/Oゼロ — Deno ユニットテスト対象）
 *
 * select-before-upsert 差分計算。
 * PostgREST/supabase-js の upsert().select() は新値のみ返す（旧 status 不可）→
 * upsert 前に1 select して既存 Map を作り、upsert 後にこの純関数で差分計算する。
 */

/** upsert 前に participants テーブルから取得した既存行
 * （04-REVIEW IN-01: display_name は差分計算で未使用のため保持しない —
 *   新規/変化エントリの displayName は incoming 側から取る） */
export interface ExistingRow {
  natural_key: string;
  status: string;
}

/** 差分計算結果 */
export interface DiffResult {
  /** 既存 Map に存在しなかった新規参加者 */
  newParticipants: { displayName: string; status: string }[];
  /** status が変化した参加者（from/to 保持） */
  statusChanges: { displayName: string; from: string; to: string }[];
  /**
   * 既存にあったが今回のスクレイプに現れなかった参加者（= ページから消えた）。
   *
   * Twipla では「参加を取り消す」と行そのものが消え、セクション間の移動
   * （attending→declined 等）とは別の変化になる。以前はここを見ていなかったため:
   *   - 主催者に「減った」ことが通知されない
   *   - DB の行は attending のまま残り、get_confirm_targets が
   *     もう来ない人を配信対象に含めてしまう
   * という穴があった（issue #2）。
   *
   * displayName は持たない。既存行のスナップショット(ExistingRow)は
   * natural_key と status しか持たないため。通知は件数のみ使うので不要。
   */
  departedParticipants: { naturalKey: string; status: string }[];
}

/**
 * 既存行のスナップショットと新規スクレイプ結果を比較して差分を返す純関数。
 *
 * 初回スクレイプ（existing 空）: 全員が newParticipants に分類される。
 * 呼び出し側（notifier）が `existing.length === 0` で通知スキップを判断する。
 */
export function diffParticipants(
  existing: ExistingRow[],
  incoming: { naturalKey: string; displayName: string; status: string }[],
): DiffResult {
  const before = new Map(existing.map((r) => [r.natural_key, r]));
  const result: DiffResult = {
    newParticipants: [],
    statusChanges: [],
    departedParticipants: [],
  };
  const seen = new Set<string>();
  for (const p of incoming) {
    seen.add(p.naturalKey);
    const prev = before.get(p.naturalKey);
    if (!prev) {
      result.newParticipants.push({ displayName: p.displayName, status: p.status });
    } else if (prev.status !== p.status) {
      result.statusChanges.push({ displayName: p.displayName, from: prev.status, to: p.status });
    }
  }
  // 既存にあって今回現れなかったもの = 離脱。
  // 既に 'left' と記録済みの行は「今回も居ない」だけなので離脱として数えない
  // （毎回のポーリングで同じ人を離脱として通知し続けないため）。
  for (const r of existing) {
    if (!seen.has(r.natural_key) && r.status !== "left") {
      result.departedParticipants.push({ naturalKey: r.natural_key, status: r.status });
    }
  }
  return result;
}

/**
 * 離脱の記録を適用してよいかを判定する純関数。
 *
 * なぜ要るか: パースが構造的には成功しても（セクションは在る）中身が取れなかった場合、
 * 「全員が離脱した」と誤って記録しうる。それは全員を confirm 対象から外すため、
 * 「誰にも確認配信が届かない」という最悪の失敗につながる。
 *
 * 判定: **既存が居るのに今回0件だったときは適用しない。**
 * イベントが本当に全員取り消しになることは有り得るが、その頻度よりも
 * スクレイプ異常の頻度の方が高く、誤って全員を外す損害の方が大きいと判断した。
 * （0件でない場合は件数をログ・通知に出して運用で気づけるようにする。
 *   割合しきい値は入れていない — 正当な離脱を黙って無視する新しい穴になるため。）
 */
export function shouldApplyDepartures(
  incomingCount: number,
  existingCount: number,
): boolean {
  if (existingCount === 0) return false; // 初回スクレイプ: 離脱は起こりえない
  if (incomingCount === 0) return false; // 全員消えた = 取得異常の疑い
  return true;
}
