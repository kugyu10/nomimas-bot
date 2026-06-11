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
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    // URLパース失敗 = 不正なURL
    return null;
  }

  // 解析成功でも canHandle で絞る
  void parsed; // parsed is used implicitly by providers' canHandle

  for (const provider of providers) {
    if (provider.canHandle(url)) {
      return provider;
    }
  }

  return null;
}
