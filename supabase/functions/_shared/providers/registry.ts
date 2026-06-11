// プロバイダーレジストリ
// scraper関数はこのモジュールのみに依存し、Twipla固有コードを直接参照しない
// resolveProvider(url) → 対応プロバイダーを返す（SSRF防止の入り口 = canHandleがhostname許可リストを実装）

import type { ParticipantListProvider } from "./types.ts";
import { twiplaProvider } from "./twipla.ts";

const providers: ParticipantListProvider[] = [twiplaProvider];

/**
 * URLに対応するプロバイダーを返す
 * canHandle() が true を返す最初のプロバイダーを返す
 * 対応するプロバイダーがなければ null（= 非許可URLの拒否）
 */
export function resolveProvider(url: string): ParticipantListProvider | null {
  // 入力検証: URLとしてパースできない文字列は早期拒否（各providerのcanHandleも自前で再パースする）
  try {
    new URL(url);
  } catch {
    return null;
  }

  for (const provider of providers) {
    if (provider.canHandle(url)) {
      return provider;
    }
  }

  return null;
}
