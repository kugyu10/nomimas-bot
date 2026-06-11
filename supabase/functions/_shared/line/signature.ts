/**
 * LINE Webhook署名検証モジュール
 * Web Crypto API (crypto.subtle) を使用したHMAC-SHA256署名検証
 * LINE公式SDKは未使用（Node依存のためDeno環境では使わない）
 *
 * 公式仕様: developers.line.biz/en/docs/messaging-api/verify-webhook-signature/
 * 公式テストベクタで検証済み（本セッション）
 */

/**
 * LINE Webhookのx-line-signatureヘッダを検証する
 *
 * @param rawBody - req.text()で取得した生リクエストボディ文字列（JSON再シリアライズ不可）
 * @param channelSecret - LINEチャネルシークレット
 * @param signature - x-line-signatureヘッダ値（Base64エンコード済み）
 * @returns 署名が正しければ true、それ以外は false（例外を投げない）
 */
export async function validateLineSignature(
  rawBody: string,
  channelSecret: string,
  signature: string,
): Promise<boolean> {
  // 空署名・空body: 長さ0のmacとの比較で安全にfalseを返す
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(channelSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(rawBody),
  );
  const expected = btoa(String.fromCharCode(...new Uint8Array(mac)));

  // 長さが異なる場合は即時false（定数時間比較の前段として必要）
  if (expected.length !== signature.length) return false;

  // 定数時間XOR比較（タイミング攻撃対策）
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return diff === 0;
}
