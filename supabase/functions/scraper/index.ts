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
  let changes: {
    new: number;
    statusChanged: number;
    departed: number;
    /** 実際に 'left' に更新できた件数（departed は検出件数） */
    departedApplied: number;
    /**
     * 取得異常の疑いで離脱の適用を見送った件数。
     *
     * これをレスポンスに出さないと、`shouldApplyDepartures` が false を返した経路が
     * **正常系の「変化なし」と完全に同一のレスポンス**になる（incoming が空なので
     * new も statusChanged も0、departed も0のまま）。痕跡が console.error だけになり、
     * cron 駆動で誰もログを見ていなければ「スクレイプが壊れて既存全員が消えて見えている」
     * 状態が無言で続く（PR #5 レビュー2 の指摘）。
     */
    departuresSuspended: number;
  } = {
    new: 0,
    statusChanged: 0,
    departed: 0,
    departedApplied: 0,
    departuresSuspended: 0,
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

    // 判断メモ（2026-08-31 更新）: 「セクションはあるが参加者0人」
    // (sectionCount > 0 && rows.length === 0) のとき upsert・通知を止めるかどうか。
    //
    // **以前の根拠は無効になった。** かつては「diffParticipants は incoming をループするだけで
    // 消えた人を検出しないので、この経路で誤通知は構造的に起きない」と書いていたが、
    // issue #2 で離脱検出を入れたため前提が崩れている。
    //
    // いまこの経路を守っているのは以下の2つだけである:
    //   1. sectionCount === 0 は上で早期return（取得失敗として扱う）
    //   2. shouldApplyDepartures が「既存が居るのに今回0件」なら離脱を適用しない
    // **この2つを緩めると、一括 left のバグが復活する。**
    // なお upsert(rows=[]) 自体は PostgREST 上0行の no-op で、既存行を書き換えも削除もしない。
    console.log(`[scraper] rows.length=${rows.length} sectionCount=${result.sectionCount}`);

    // (4a) upsert 前に既存行を select — select-before-upsert 差分計算（Pattern 2）
    // existErr 時は差分検出を諦め通知スキップ（upsert 自体は続行 — 取得保存優先）
    // IN-01: display_name は diffParticipants で未使用のため select しない
    // id: 離脱を UPDATE するとき natural_key ではなく id（UUID）で絞るために取る
    //     （natural_key は 'dn:'+表示名 にフォールバックし、表示名は Twipla 側の任意テキスト。
    //      引用符やカンマを含む値を .in() に渡すと PostgREST 側で値が分割され、
    //      無関係な参加者を left にし本来の対象を取り逃がす — PR #5 レビュー指摘）
    // scraped_at: スクレイプで観測したことがある行かの判別（離脱判定の対象を限定する）
    const { data: existingRows, error: existErr } = await supabase
      .from("participants")
      .select("id, natural_key, status, scraped_at")
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
        let departuresSuspended = 0;
        if (diff.departedParticipants.length > 0) {
          if (!shouldApplyDepartures(incoming.length, existingRows.length)) {
            // 既存が居るのに今回0件 = 取得異常の疑い。全員を配信対象から外す事故を防ぐため適用しない。
            // 件数をレスポンスにも出す（この経路が正常系と区別できないと運用で気づけない）。
            departuresSuspended = diff.departedParticipants.length;
            console.error(
              `[scraper] SUSPICIOUS: 既存 ${existingRows.length} 件に対し取得0件のため、` +
                `離脱 ${diff.departedParticipants.length} 件の記録を見送った（取得異常の疑い）`,
            );
          } else {
            // 離脱の UPDATE は **id（UUID）** で絞る。
            // natural_key は 'dn:'+表示名 にフォールバックし、表示名は Twipla の任意テキストなので、
            // 引用符やカンマを含む値を .in() に渡すと PostgREST 側で値が分割され、
            // 無関係な参加者を left にして本来の対象を取り逃がす（PR #5 レビュー指摘）。
            // UUID なら固定長・記号なしなので、その問題も URL 長の暴れも起きない。
            const idByKey = new Map(
              (existingRows as { id: string; natural_key: string }[]).map((r) => [
                r.natural_key,
                r.id,
              ]),
            );
            const departedIds = diff.departedParticipants
              .map((d) => idByKey.get(d.naturalKey))
              .filter((v): v is string => typeof v === "string");

            // URL 長の上限に当たらないよう分割して投げる（件数が多いときの黙った失敗を防ぐ）
            const CHUNK = 50;
            let applied = 0;
            let updateFailed = false;
            for (let i = 0; i < departedIds.length; i += CHUNK) {
              const chunk = departedIds.slice(i, i + CHUNK);
              const { error: leftError, count: leftCount } = await supabase
                .from("participants")
                .update({ status: "left" }, { count: "exact" })
                .in("id", chunk);
              if (leftError) {
                // 記録失敗は保存経路を壊さない（次回のポーリングで再度検出される）
                console.error(`[scraper] departed update error: ${leftError.message}`);
                updateFailed = true;
                break;
              }
              applied += leftCount ?? chunk.length;
            }
            departedApplied = applied;
            console.log(
              `[scraper] marked ${departedApplied}/${departedIds.length} participant(s) as left` +
                (updateFailed ? " (一部失敗)" : ""),
            );
          }
        }

        // 適用を見送った場合も、レスポンスで区別できるように changes を更新する
        // （通知は飛ばさない — 実際には何も変わっていないため）。
        if (departuresSuspended > 0) {
          changes = {
            new: 0,
            statusChanged: 0,
            departed: 0,
            departedApplied: 0,
            departuresSuspended,
          };
        }

        if (
          diff.newParticipants.length > 0 || diff.statusChanges.length > 0 ||
          departedApplied > 0
        ) {
          changes = {
            new: diff.newParticipants.length,
            statusChanged: diff.statusChanges.length,
            // 検出件数と実適用件数の**両方**を出す。
            // 「検出と適用を分ける」のがこの設計の芯なので、報告側でも混ぜない
            // （PR #5 レビュー2 の指摘）。UPDATE が途中で失敗すると
            // departed > departedApplied になり、その差が運用の手がかりになる。
            departed: diff.departedParticipants.length,
            departedApplied,
            departuresSuspended: 0,
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
                departedParticipants: diff.departedParticipants,
                departedAppliedCount: departedApplied,
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
