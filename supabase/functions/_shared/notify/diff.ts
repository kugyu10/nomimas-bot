/**
 * _shared/notify/diff.ts
 * scraper 変化検出の純関数（外部I/Oゼロ — Deno ユニットテスト対象）
 *
 * select-before-upsert 差分計算。
 * PostgREST/supabase-js の upsert().select() は新値のみ返す（旧 status 不可）→
 * upsert 前に1 select して既存 Map を作り、upsert 後にこの純関数で差分計算する。
 */

/** upsert 前に participants テーブルから取得した既存行 */
export interface ExistingRow {
  natural_key: string;
  status: string;
  display_name: string;
}

/** 差分計算結果 */
export interface DiffResult {
  /** 既存 Map に存在しなかった新規参加者 */
  newParticipants: { displayName: string; status: string }[];
  /** status が変化した参加者（from/to 保持） */
  statusChanges: { displayName: string; from: string; to: string }[];
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
  const result: DiffResult = { newParticipants: [], statusChanges: [] };
  for (const p of incoming) {
    const prev = before.get(p.naturalKey);
    if (!prev) {
      result.newParticipants.push({ displayName: p.displayName, status: p.status });
    } else if (prev.status !== p.status) {
      result.statusChanges.push({ displayName: p.displayName, from: prev.status, to: p.status });
    }
  }
  return result;
}
