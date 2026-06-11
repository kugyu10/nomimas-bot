// scraper Edge Function
// プロバイダーレジストリ経由でTwipla（将来的に他のプラットフォーム）から参加者を取得しDBに保存する
// Twipla固有コードをこのファイルに書かない（registry経由のみ）— EVENT-02

import { z } from "zod";
import { resolveProvider } from "../_shared/providers/registry.ts";
import { createServiceClient } from "../_shared/supabase.ts";

// zod 4 では z.url() で URL バリデーション（z.string().url() は旧 zod 3 の書き方）
const RequestSchema = z.object({
  url: z.url(),
});

Deno.serve(async (req: Request) => {
  // POST 以外は 405
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  // (1) リクエストボディを zod で検証
  let body: { url: string };
  try {
    const raw = await req.json();
    const parsed = RequestSchema.safeParse(raw);
    if (!parsed.success) {
      return new Response(JSON.stringify({ error: "invalid request", details: parsed.error.format() }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    body = parsed.data;
  } catch {
    return new Response(JSON.stringify({ error: "invalid json" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // (2) プロバイダーレジストリで URL を解決（hostname 許可リスト = SSRF 防止）
  const provider = resolveProvider(body.url);
  if (!provider) {
    return new Response(JSON.stringify({ error: "unsupported url" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // (3) 参加者リストを取得
  let result;
  try {
    result = await provider.fetchParticipants(body.url);
  } catch (err) {
    console.error(`[scraper] fetchParticipants failed: ${err instanceof Error ? err.message : String(err)}`);
    return new Response(JSON.stringify({ error: "fetch failed" }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }

  // (4) event_platform_urls テーブルで登録済み URL を照合し participants へ upsert
  const supabase = createServiceClient();
  let saved = false;

  const { data: epu } = await supabase
    .from("event_platform_urls")
    .select("id")
    .eq("url", body.url)
    .single();

  if (epu) {
    const rows = result.participants.map((p) => ({
      event_platform_url_id: epu.id,
      display_name: p.displayName,
      screen_name: p.screenName,
      profile_url: p.profileUrl,
      status: p.status,
      source_platform: result.platform,
      scraped_at: result.fetchedAt,
    }));

    const { error: upsertError } = await supabase
      .from("participants")
      .upsert(rows, { onConflict: "event_platform_url_id,display_name" });

    if (upsertError) {
      console.error(`[scraper] upsert error: ${upsertError.message}`);
    } else {
      saved = true;
      // 件数のみログ（参加者生データをログに残さない — T-01-08）
      console.log(`[scraper] upserted ${rows.length} participants for url=${body.url}`);
    }
  } else {
    console.log(`[scraper] url not registered in event_platform_urls: ${body.url}`);
  }

  // (5) レスポンスは platform / count / saved のみ（参加者生データは含めない — T-01-08）
  return new Response(
    JSON.stringify({
      platform: result.platform,
      count: result.participants.length,
      saved,
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    },
  );
});
