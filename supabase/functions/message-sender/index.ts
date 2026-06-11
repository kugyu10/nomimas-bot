/**
 * message-sender Edge Function（Phase 1: 雛形）
 *
 * Phase 1の役割: ステートレストークン（v3）の実行時発行成功を確認する雛形。
 * push送信はPhase 2で実装予定。
 *
 * TODO(Phase 2): issueStatelessTokenで取得したトークンを使って
 *   POST https://api.line.me/v2/bot/message/push でpushメッセージ送信を実装する
 *
 * ゲートウェイJWT検証: 有効のまま（config.tomlに[functions.message-sender]を追加しない）
 * 呼び出しには Authorization: Bearer $SUPABASE_ANON_KEY が必要
 */

import { issueStatelessToken } from "../_shared/line/token.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const channelId = Deno.env.get("LINE_CHANNEL_ID") ?? "";
  const channelSecret = Deno.env.get("LINE_CHANNEL_SECRET") ?? "";

  try {
    // ステートレストークン発行（v3・有効15分・都度発行）
    // トークン値を応答・ログに含めないこと（セキュリティ要件）
    await issueStatelessToken(channelId, channelSecret);

    // トークン発行成功を確認できる最小限のレスポンス（値は含めない）
    return new Response(
      JSON.stringify({ status: "ok", tokenIssued: true, expiresIn: 900 }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    console.error(
      `message-sender: token issue failed: ${(err as Error).message}`,
    );
    return new Response(
      JSON.stringify({ status: "error" }),
      {
        status: 502,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
});
