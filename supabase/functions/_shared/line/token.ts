/**
 * LINEステートレスチャネルアクセストークン発行モジュール（v3）
 * 公式仕様: developers.line.biz/en/docs/basics/channel-access-token/
 *
 * 特性:
 * - 有効期間: 15分（expires_in: 900）
 * - 発行制限: なし（都度発行が公式推奨設計）
 * - 取り消し: 不可
 *
 * 重要: トークン値を保存・キャッシュ・ログ出力しないこと
 */

/**
 * LINEステートレスチャネルアクセストークンを発行する
 *
 * @param channelId - LINEチャネルID
 * @param channelSecret - LINEチャネルシークレット
 * @returns access_token文字列（expires_in: 900秒）
 * @throws トークン発行失敗時はステータスコードのみ含むError
 *         （レスポンスボディはログしない — シークレット混入防止）
 */
export async function issueStatelessToken(
  channelId: string,
  channelSecret: string,
): Promise<string> {
  const res = await fetch("https://api.line.me/oauth2/v3/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: channelId,
      client_secret: channelSecret,
    }),
  });

  if (!res.ok) {
    // レスポンスボディはログしない（シークレットが映り込む可能性）
    throw new Error(`token issue failed: ${res.status}`);
  }

  const json = await res.json();
  return json.access_token as string; // expires_in: 900
}
