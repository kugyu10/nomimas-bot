/**
 * LINE Webhook受信Edge Function
 *
 * 処理順（順序厳守）:
 * 1. raw body取得（JSON parse前に必ずawait req.text()）
 * 2. x-line-signature検証 → 不正なら401
 * 3. JSON.parse(rawBody) → zodで形状検証 → 不正なら400
 * 4. Phase 1: イベント件数のみログ出力 → 200
 *
 * verify_jwt=false: config.toml [functions.webhook] + --no-verify-jwt フラグで二重指定
 * LINEプラットフォームはSupabase JWTを送れないため必須
 */

import { z } from "zod";
import { validateLineSignature } from "../_shared/line/signature.ts";

// Webhookペイロードのzodスキーマ（形状検証のみ。events詳細はPhase 2で拡張）
const WebhookPayloadSchema = z.object({
  destination: z.string(),
  events: z.array(z.unknown()),
});

Deno.serve(async (req) => {
  // GET等の非POSTメソッドは405
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  // (1) raw bodyを最初に取得（必ずJSON.parseより前）
  const rawBody = await req.text();

  // (2) x-line-signature検証（不正なら401 — ビジネスロジックは一切実行しない）
  const sig = req.headers.get("x-line-signature") ?? "";
  const channelSecret = Deno.env.get("LINE_CHANNEL_SECRET") ?? "";
  const isValid = await validateLineSignature(rawBody, channelSecret, sig);
  if (!isValid) {
    return new Response("invalid signature", { status: 401 });
  }

  // (3) JSON.parse(rawBody) → zodで形状検証
  let payload: z.infer<typeof WebhookPayloadSchema>;
  try {
    const parsed = JSON.parse(rawBody);
    const result = WebhookPayloadSchema.safeParse(parsed);
    if (!result.success) {
      return new Response("invalid payload", { status: 400 });
    }
    payload = result.data;
  } catch {
    return new Response("invalid json", { status: 400 });
  }

  // (4) Phase 1: イベント件数のみログ（ペイロード本文・ユーザーIDはログしない）
  console.log(`webhook: received ${payload.events.length} event(s)`);

  return new Response("ok", { status: 200 });
});
