// scraper Edge Function
// プロバイダーレジストリ経由でTwipla（将来的に他のプラットフォーム）から参加者を取得しDBに保存する
// Twipla固有コードをこのファイルに書かない（registry経由のみ）— EVENT-02

import { z } from "zod";
import { resolveProvider } from "../_shared/providers/registry.ts";
import { createServiceClient } from "../_shared/supabase.ts";
import { diffParticipants, shouldApplyDepartures } from "../_shared/notify/diff.ts";
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

  // (3b) セクション0件は「取得失敗」として扱う（誤検知防止）
  // parseTwiplaHtml は div.member_list が1つも無いHTML（マークアップ変更・エラーページ・
  // ログイン要求・レート制限ページ等）に対して例外を投げず participants: [] を返す。
  // これを「参加者が0人になった」と区別できないと、実際には取得に失敗しているだけなのに
  // 既存の参加者と比較して「全員離脱した」ように見える危険がある
  // （厳密には diffParticipants は消えた人を検出しないため直接の誤通知は起きないが、
  //  それでも upsert・差分計算・scraped_at 更新のいずれも取得失敗時には行うべきではない）。
  // fetch 失敗と同じ 502 として早期returnし、upsert/差分/通知のいずれにも進めない。
  if (result.sectionCount === 0) {
    // 件数のみログ（PII を出さない）
    console.error(`[scraper] no sections found (sectionCount=0) — treating as fetch failure`);
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
  let changes: { new: number; statusChanged: number; departed: number } = {
    new: 0,
    statusChanged: 0,
    departed: 0,
  };
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

    // 判断メモ: 「セクションはあるが参加者0人」(sectionCount > 0 && rows.length === 0) の場合に
    // upsert・通知を止めるべきか検討した結果、追加のガードは入れていない。理由:
    //   - diffParticipants は incoming をループするだけで「消えた人」を検出しないため、
    //     rows が空なら newParticipants/statusChanges は必ず空になり、この経路で
    //     誤通知が飛ぶことはそもそも無い（下の existingRows.length===0 分岐と合わせ
    //     通知は最大でも「変化なし」で完全にスキップされる）。
    //   - upsert(rows=[]) は PostgREST 上は0行の no-op で、既存行を書き換えたり消したりしない
    //     （既存参加者の行は残ったまま、scraped_at だけ更新されない）。これは
    //     「本当に参加者が0人になった」場合でも「本当に取得失敗だがsectionは残っていた」場合でも
    //     安全側（何もしない）に倒れるため、sectionCount>0 の時点でこれ以上区別する必要がない。
    //   - sectionCount===0（セクション自体が無い＝取得失敗）は既に上で早期returnしているため、
    //     ここに到達する時点で「セクションはHTML上存在した」ことは保証されている。
    console.log(`[scraper] rows.length=${rows.length} sectionCount=${result.sectionCount}`);

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

    // (4a') 同一OA内の既知の紐付けを引き継ぐ（screen_name一致・別イベント含む — ADMIN-02拡張）
    // 取得したばかりの未紐付け participants に、過去イベントで紐付け済みの line_user を自動適用。
    // service role 経由のため RLS バイパス。失敗してもスクレイプ自体は成功扱い（best-effort）。
    {
      const epuEvents = epu.events as unknown as { oa_config_id?: string } | null;
      if (epuEvents?.oa_config_id) {
        const { data: propagated, error: propErr } = await supabase.rpc(
          "propagate_oa_links",
          { p_oa_config_id: epuEvents.oa_config_id },
        );
        if (propErr) {
          console.error(`[scraper] propagate_oa_links failed: ${propErr.message}`);
        } else {
          console.log(`[scraper] propagated ${propagated ?? 0} link(s) within OA`);
        }
      }
    }

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

        // (4b-1) 離脱者（ページから行ごと消えた参加者）を 'left' として記録する。
        //
        // Twipla では参加を取り消すと行が消えるため、セクション間の移動とは別の変化になる。
        // 記録しないと DB の行が attending のまま残り、get_confirm_targets が
        // もう来ない人を配信対象に含め続ける（issue #2）。
        // status を 'left' にすれば get_confirm_targets（status='attending' で絞る）から
        // 自動的に外れるので、関数側の変更は要らない。
        let departedApplied = 0;
        if (diff.departedParticipants.length > 0) {
          if (!shouldApplyDepartures(incoming.length, existingRows.length)) {
            // 既存が居るのに今回0件 = 取得異常の疑い。全員を配信対象から外す事故を防ぐため適用しない。
            console.error(
              `[scraper] SUSPICIOUS: 既存 ${existingRows.length} 件に対し取得0件のため、` +
                `離脱 ${diff.departedParticipants.length} 件の記録を見送った（取得異常の疑い）`,
            );
          } else {
            const departedKeys = diff.departedParticipants.map((d) => d.naturalKey);
            const { error: leftError, count: leftCount } = await supabase
              .from("participants")
              .update({ status: "left" }, { count: "exact" })
              .eq("event_platform_url_id", epu.id)
              .in("natural_key", departedKeys);
            if (leftError) {
              // 記録失敗は保存経路を壊さない（次回のポーリングで再度検出される）
              console.error(`[scraper] departed update error: ${leftError.message}`);
            } else {
              departedApplied = leftCount ?? departedKeys.length;
              console.log(`[scraper] marked ${departedApplied} participant(s) as left`);
            }
          }
        }

        if (
          diff.newParticipants.length > 0 || diff.statusChanges.length > 0 ||
          departedApplied > 0
        ) {
          changes = {
            new: diff.newParticipants.length,
            statusChanged: diff.statusChanges.length,
            departed: departedApplied,
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
                departedParticipants: diff.departedParticipants.slice(0, departedApplied),
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
