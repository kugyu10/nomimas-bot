// scraper Edge Function
// プロバイダーレジストリ経由でTwipla（将来的に他のプラットフォーム）から参加者を取得しDBに保存する
// Twipla固有コードをこのファイルに書かない（registry経由のみ）— EVENT-02

import { z } from "zod";
import { resolveProvider } from "../_shared/providers/registry.ts";
import { createServiceClient } from "../_shared/supabase.ts";
import { diffParticipants } from "../_shared/notify/diff.ts";
import { notifyScrapeChanges } from "../_shared/notify/notifier.ts";

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

  // maybeSingle: 0行は data:null で返り error にならない（DB障害と「URL未登録」を区別する — WR-03）
  // events をネスト select に拡張（通知に必要な event_id / title / event_date / oa_config_id を1クエリで — Pattern 2）
  const { data: epu, error: epuError } = await supabase
    .from("event_platform_urls")
    .select("id, events(id, title, event_date, oa_config_id)")
    .eq("url", body.url)
    .maybeSingle();

  if (epuError) {
    console.error(`[scraper] epu lookup error: ${epuError.message}`);
    return new Response(JSON.stringify({ error: "db error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  // 通知結果（レスポンスに含める）
  let changes: { new: number; statusChanged: number } = { new: 0, statusChanged: 0 };
  let notified = 0;

  if (epu) {
    // 参加者の同一性キー（CR-01対応）:
    //   screen_name があればそれを、なければ 'dn:' + display_name をキーにする
    //   （'dn:' プレフィックスで screen_name 値とのキー空間衝突を防ぐ）
    // バッチ内で同一キーが重複すると Postgres が
    // "ON CONFLICT DO UPDATE command cannot affect row a second time" で
    // バッチ全体を reject するため、upsert 前に last-wins で重複除去する
    const byKey = new Map<string, Record<string, unknown>>();
    for (const p of result.participants) {
      const naturalKey = p.screenName ?? `dn:${p.displayName}`;
      byKey.set(naturalKey, {
        event_platform_url_id: epu.id,
        display_name: p.displayName,
        screen_name: p.screenName,
        profile_url: p.profileUrl,
        natural_key: naturalKey,
        status: p.status,
        source_platform: result.platform,
        scraped_at: result.fetchedAt,
      });
    }
    const rows = [...byKey.values()];

    // (4a) upsert 前に既存行を select — select-before-upsert 差分計算（Pattern 2）
    // existErr 時は差分検出を諦め通知スキップ（upsert 自体は続行 — 取得保存優先）
    // IN-01: display_name は diffParticipants で未使用のため select しない
    const { data: existingRows, error: existErr } = await supabase
      .from("participants")
      .select("natural_key, status")
      .eq("event_platform_url_id", epu.id);

    if (existErr) {
      console.error(`[scraper] existing rows select error (skipping diff): ${existErr.message}`);
    }

    const { error: upsertError } = await supabase
      .from("participants")
      .upsert(rows, { onConflict: "event_platform_url_id,natural_key" });

    if (upsertError) {
      // upsert失敗は500で返し、呼び出し側（将来のcron/管理画面）がリトライ判断できるようにする（WR-03）
      console.error(`[scraper] upsert error: ${upsertError.message}`);
      return new Response(JSON.stringify({ error: "db error" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
    saved = true;
    // 件数のみログ（参加者生データをログに残さない — T-01-08）
    console.log(`[scraper] upserted ${rows.length} participants for url=${body.url}`);

    // (4b) 差分計算 + 通知（upsert 成功後）
    if (!existErr && existingRows) {
      if (existingRows.length === 0) {
        // 初回スクレイプ: 全員が「新規」になるため通知スキップ+件数ログ（Pitfall 2）
        console.log(`[scraper] initial scrape — skipping notification (${rows.length} participants)`);
      } else {
        // incoming 形式に変換して純関数 diffParticipants で差分計算
        const incoming = rows.map((r) => ({
          naturalKey: r.natural_key as string,
          displayName: r.display_name as string,
          status: r.status as string,
        }));
        const diff = diffParticipants(existingRows, incoming);

        if (diff.newParticipants.length > 0 || diff.statusChanges.length > 0) {
          changes = {
            new: diff.newParticipants.length,
            statusChanged: diff.statusChanges.length,
          };

          // イベント情報をネスト select から取得（型を安全に取り出す）
          const eventsData = epu.events as unknown as
            | { id: string; title: string; event_date: string | null; oa_config_id: string }
            | null;

          if (eventsData) {
            try {
              const r = await notifyScrapeChanges(supabase, {
                eventId: eventsData.id,
                oaConfigId: eventsData.oa_config_id,
                eventTitle: eventsData.title,
                eventDate: eventsData.event_date,
                newParticipants: diff.newParticipants,
                statusChanges: diff.statusChanges,
              });
              notified = r.sent;
              console.log(
                `[scraper] notify kind=${r.kind} inWindow=${r.inWindow} sent=${r.sent} failed=${r.failed} skipped=${r.skippedNoLineId}`,
              );
            } catch (err) {
              // 通知失敗はログのみ（upsert 成功済み — 保存経路を壊さない）
              console.error(`[scraper] notify failed: ${(err as Error).message}`);
            }
          } else {
            console.log(`[scraper] event not found from epu — skipping notification`);
          }
        } else {
          console.log(`[scraper] no changes detected — skipping notification`);
        }
      }
    }
  } else {
    console.log(`[scraper] url not registered in event_platform_urls: ${body.url}`);
  }

  // (5) レスポンスは platform / count / saved + changes / notified（既存キー不変 — A5）
  return new Response(
    JSON.stringify({
      platform: result.platform,
      count: result.participants.length,
      saved,
      changes,
      notified,
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    },
  );
});
