/**
 * message-sender Edge Function（Phase 2: cron配信本体）
 *
 * 役割: pg_cronから呼ばれ、配信対象参加者全員に初回確認バンドルを push し
 *       confirm_status を 'sent' に更新する。
 *
 * ゲートウェイJWT検証: 有効のまま（config.tomlに[functions.message-sender]を追加しない）
 * cronはVaultのanonキーで正規に通過する設計（RESEARCH Pattern 1 / T-02-07）
 *
 * セキュリティ:
 *   - WR-01: ゲートウェイJWT（anonキー）に加えて x-cron-key ヘッダを専用シークレット
 *     CRON_FUNCTION_KEY と照合する（anonキーがクライアント配布されても配信を起動できない）。
 *     cron側はVaultの 'cron_shared_secret' から同値を送る（scripts/setup-dev.ts が投入）
 *   - トークン値・メッセージ本文・フルUserIdはログしない（T-02-08）
 *   - participant_id（UUID）はログ可
 *
 * 処理フロー:
 *   0. x-cron-key 認可チェック（WR-01）
 *   1. 環境変数チェック（LINE_CHANNEL_ID / LINE_CHANNEL_SECRET）
 *   2. get_confirm_targets() で配信対象取得。0件なら早期 return
 *   3. count_unlinked_confirm_targets() で未紐付け件数をログ
 *   4. issueStatelessToken を 1バッチ 1回発行
 *   5. OA設定（questions）を取得しzod検証
 *   6. 対象ごとに buildInitialMessages → **claim（pending限定でsentへ）** → pushMessage
 *      （claim-then-send: 同時実行での二重送信を構造的に防ぐ。push 失敗時は pending に戻す。
 *        個別送信モードは confirm_status を無視する仕様のため claim を掛けない）
 *   7. notification_logs に配信結果を記録（イベント単位で1行。kind: confirm_broadcast）
 *   8. {status, targets, sent, failed, skippedUnlinked, skippedConcurrent} を JSON 200 で返す
 *
 * notification_logs 記録について:
 *   - 参加者本人への配信結果はこれまで notification_logs に一切残っておらず、
 *     「本人には届いていたのにログはsent:0」という観測の矛盾を生んでいた
 *     （docs/v1.1-notification-log-audit.md）。集計は純関数
 *     _shared/notify/broadcast_log.ts に切り出し、ここでは insert のみ行う。
 *   - insert 失敗は console.error に落として続行する（notifier.ts と同じ流儀）。
 *     配信自体は成功扱いのまま、レスポンス形状も変えない。
 */

import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { createServiceClient } from "../_shared/supabase.ts";
import { issueStatelessToken } from "../_shared/line/token.ts";
import { pushMessage } from "../_shared/line/client.ts";
import { buildInitialMessages } from "../_shared/confirm/messages.ts";
import type { EventInfo } from "../_shared/confirm/messages.ts";
import { formatEventDate, formatMeetingAt } from "../_shared/confirm/format.ts";
import {
  aggregateConfirmBroadcastResults,
  buildConfirmBroadcastLogRows,
  shouldLogConfirmBroadcast,
} from "../_shared/notify/broadcast_log.ts";
import type { ConfirmBroadcastTargetResult } from "../_shared/notify/broadcast_log.ts";

// --- Zod スキーマ ---

/** oa_configs.questions の各要素スキーマ */
const QuestionSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  options: z.array(z.string().min(1)).min(1),
});

/** oa_configs.questions 配列スキーマ */
const QuestionsSchema = z.array(QuestionSchema);

// --- RPC レスポンス型（get_confirm_targets の各行） ---
interface ConfirmTarget {
  participant_id: string;
  line_user_id: string; // "U..." 文字列（line_users.line_user_id から JOIN 済み）
  event_id: string;
  event_title: string;
  event_date: string | null;
  meeting_at: string | null;
  meeting_place: string | null;
  fee: string | null;
  venue_info: string | null;
  oa_config_id: string;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  // 0. 認可チェック — 2モード
  //    (A) cron 自動配信: x-cron-key === CRON_FUNCTION_KEY（全OA・窓内）
  //    (B) 管理画面の手動配信: Authorization の ユーザーJWT で event_id への
  //        アクセス権を RLS 検証（owner/co-owner/root のみ通過）→ そのイベントに絞る
  //    どちらにも該当しなければ 401。
  const cronKey = Deno.env.get("CRON_FUNCTION_KEY") ?? "";
  if (!cronKey) {
    console.error("message-sender: CRON_FUNCTION_KEY is not set");
    return new Response(JSON.stringify({ status: "error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  // 手動モードで絞り込む event_id（cron モードでは null）
  let manualEventId: string | null = null;
  // 個別送信モードで指定された participant_id（指定時は status 無視で1名へ送り直し）
  let manualParticipantId: string | null = null;

  if (req.headers.get("x-cron-key") === cronKey) {
    // (A) cron モード — 追加検証なし
  } else {
    // (B) 手動モード候補: Authorization ユーザーJWT + body.event_id
    //     body.participant_id があれば「個別送信モード」（status 無視で1名へ送り直し）
    const authHeader = req.headers.get("Authorization") ?? "";
    let bodyEventId: string | null = null;
    let bodyParticipantId: string | null = null;
    try {
      const body = await req.json();
      bodyEventId = typeof body?.event_id === "string" ? body.event_id : null;
      bodyParticipantId = typeof body?.participant_id === "string" ? body.participant_id : null;
    } catch {
      bodyEventId = null;
      bodyParticipantId = null;
    }

    if (!authHeader.startsWith("Bearer ") || !bodyEventId) {
      console.warn("message-sender: neither cron-key nor (user JWT + event_id) — rejecting");
      return new Response(JSON.stringify({ status: "unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    // ユーザーJWTでイベントにアクセスできるか RLS 検証（owner/co-owner/root のみ可視）
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ??
      Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "";
    if (!supabaseUrl || !anonKey) {
      console.error("message-sender: SUPABASE_URL / anon key not set for user-scoped check");
      return new Response(JSON.stringify({ status: "error" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: ev, error: evErr } = await userClient
      .from("events")
      .select("id")
      .eq("id", bodyEventId)
      .maybeSingle();
    if (evErr || !ev) {
      // RLS で隠れた = アクセス権なし（403）
      console.warn("message-sender: manual broadcast denied — event not accessible");
      return new Response(JSON.stringify({ status: "forbidden" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      });
    }
    manualEventId = bodyEventId;
    manualParticipantId = bodyParticipantId;
  }

  // 1. 環境変数チェック（設定エラー 500 でLINE障害 502 と区別）
  const channelId = Deno.env.get("LINE_CHANNEL_ID") ?? "";
  const channelSecret = Deno.env.get("LINE_CHANNEL_SECRET") ?? "";
  if (!channelId || !channelSecret) {
    console.error(
      "message-sender: missing LINE env (LINE_CHANNEL_ID / LINE_CHANNEL_SECRET)",
    );
    return new Response(JSON.stringify({ status: "error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const supabase = createServiceClient();

  // 2. 配信対象取得（RPC: service role）
  //    個別送信モード: participant_id 1名のみ（confirm_status 無視・送り直し）
  //    手動モード    : event_id で絞り N日前の窓を無視
  //    cron モード   : 全OA・窓内
  const { data: targets, error: targetsError } = manualParticipantId
    ? await supabase.rpc("get_participant_confirm_target", {
        p_participant_id: manualParticipantId,
      })
    : await supabase.rpc(
        "get_confirm_targets",
        manualEventId ? { p_event_id: manualEventId } : {},
      );
  if (targetsError) {
    console.error(
      `message-sender: target RPC failed: ${targetsError.message}`,
    );
    return new Response(JSON.stringify({ status: "error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  let confirmedTargets = (targets as ConfirmTarget[]) ?? [];

  // 個別送信モードの追加防御: 対象participantが認可済みevent配下であることを確認
  // （他イベントの participant_id を渡して別OAへ送る攻撃を防ぐ）
  if (manualParticipantId) {
    confirmedTargets = confirmedTargets.filter((t) => t.event_id === manualEventId);
    if (confirmedTargets.length === 0) {
      console.warn(
        "message-sender: individual send rejected — participant not in accessible event or not linked",
      );
      return new Response(JSON.stringify({ status: "forbidden" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      });
    }
    // クリーン再送: 既存回答を削除し1問目からやり直す（confirm_status/index は push成功後にリセット）
    const { error: delErr } = await supabase
      .from("answers")
      .delete()
      .eq("participant_id", manualParticipantId);
    if (delErr) {
      console.error(
        `message-sender: failed to clear answers for participant_id=${manualParticipantId}: ${delErr.message}`,
      );
      return new Response(JSON.stringify({ status: "error" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  // 0件なら早期 return（トークン発行もスキップ）
  if (confirmedTargets.length === 0) {
    return new Response(
      JSON.stringify({ status: "ok", targets: 0, sent: 0 }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }

  // 3. 未紐付け件数をログ（D-11: 件数のみ — userId等は出さない）
  //    count_unlinked_confirm_targets は全体集計のため cron モードのみ意味を持つ。
  //    手動（event絞り）モードでは集計しない（0 を返す）。
  let skippedUnlinked = 0;
  if (!manualEventId) {
    const { data: unlinkedCount, error: unlinkedError } = await supabase.rpc(
      "count_unlinked_confirm_targets",
    );
    if (unlinkedError) {
      // 未紐付けカウントは警告のみ（配信ロジックをブロックしない）
      console.warn(
        `message-sender: count_unlinked_confirm_targets failed: ${unlinkedError.message}`,
      );
    } else {
      console.log(`message-sender: skipped unlinked targets: ${unlinkedCount ?? 0}`);
      skippedUnlinked = typeof unlinkedCount === "number" ? unlinkedCount : 0;
    }
  }

  // 4. ステートレストークンを 1バッチ 1回発行（State of the Art）
  let token: string;
  try {
    token = await issueStatelessToken(channelId, channelSecret);
  } catch (err) {
    console.error(
      `message-sender: token issue failed: ${(err as Error).message}`,
    );
    return new Response(JSON.stringify({ status: "error" }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }

  // 5. OA設定（questions）を oa_config_id ごとに取得・zod検証
  //    同一 oa_config_id が複数 target に存在する場合は 1回のみ取得する
  const oaConfigIds = [...new Set(confirmedTargets.map((t) => t.oa_config_id))];
  const oaQuestionsMap = new Map<
    string,
    Array<{ id: string; text: string; options: string[] }>
  >();
  // 定型文（greeting_message）も oa_config_id ごとに保持
  const oaGreetingMap = new Map<string, string | null>();

  for (const oaConfigId of oaConfigIds) {
    const { data: oaData, error: oaError } = await supabase
      .from("oa_configs")
      .select("questions, greeting_message")
      .eq("id", oaConfigId)
      .single();
    oaGreetingMap.set(oaConfigId, (oaData?.greeting_message as string | null) ?? null);

    if (oaError || !oaData) {
      console.error(
        `message-sender: oa_configs fetch failed for oa_config_id=${oaConfigId}: ${oaError?.message ?? "not found"}`,
      );
      // このOAの全対象をスキップ（配信できない）
      oaQuestionsMap.set(oaConfigId, []);
      continue;
    }

    const parsed = QuestionsSchema.safeParse(oaData.questions);
    if (!parsed.success) {
      // 質問定義が不正な場合はスキップ（配信できない）
      console.error(
        `message-sender: invalid questions for oa_config_id=${oaConfigId}: ${parsed.error.message}`,
      );
      oaQuestionsMap.set(oaConfigId, []);
      continue;
    }

    if (parsed.data.length === 0) {
      // 質問未設定OA — スキップ
      console.error(
        `message-sender: oa_config_id=${oaConfigId} has empty questions — skipping all targets`,
      );
      oaQuestionsMap.set(oaConfigId, []);
      continue;
    }

    oaQuestionsMap.set(oaConfigId, parsed.data);
  }

  // 6. 各対象に初回バンドルを push → confirm_status='sent' 更新
  let sent = 0;
  let failed = 0;
  // 他の実行が先に確保した（claim できなかった）件数。二重送信を避けて意図的にスキップした数で、
  // 失敗ではない。同一分に配信ジョブが重なっていないかを運用で気づくための観測値。
  let skippedConcurrent = 0;
  // notification_logs 記録用（PII なし: eventId/oaConfigId/成否のみ）
  const targetResults: ConfirmBroadcastTargetResult[] = [];

  for (const target of confirmedTargets) {
    const questions = oaQuestionsMap.get(target.oa_config_id);
    if (!questions || questions.length === 0) {
      // 質問未設定OAはスキップ
      failed++;
      targetResults.push({ eventId: target.event_id, oaConfigId: target.oa_config_id, success: false });
      continue;
    }

    // EventInfo 構築（RPC が返す snake_case → camelCase 変換）
    // CR-01: meeting_at は UTC ISO で返るため Asia/Tokyo に整形してから渡す
    const eventInfo: EventInfo = {
      title: target.event_title,
      eventDate: formatEventDate(target.event_date),
      meetingAt: formatMeetingAt(target.meeting_at),
      meetingPlace: target.meeting_place,
      fee: target.fee,
      venueInfo: target.venue_info,
    };

    // 初回バンドル生成（イベント情報 + 案内文 + Q1 = 3バブル）
    let messages: object[];
    try {
      messages = buildInitialMessages(
        eventInfo,
        questions[0],
        target.participant_id,
        oaGreetingMap.get(target.oa_config_id) ?? null,
      );
    } catch (err) {
      console.error(
        `message-sender: buildInitialMessages failed for participant_id=${target.participant_id}: ${(err as Error).message}`,
      );
      failed++;
      targetResults.push({ eventId: target.event_id, oaConfigId: target.oa_config_id, success: false });
      continue;
    }

    // claim-then-send（同時実行での二重送信を構造的に防ぐ）
    //
    // 以前は「push してから confirm_status='sent' に更新」する順序だった。
    // これは**逐次実行なら**重複を防げるが、**同時実行では防げない**:
    // 配信を起動する cron が2本同じ分に発火すると、両方が同じ participant を
    // pending として読み、両方が push してから両方が 'sent' に更新する
    // （読み取りと更新の間に LINE トークン発行などの await が複数挟まる）。
    //
    // そこで push の**前**に「pending の行に限って sent へ更新」し、
    // **1行更新できたときだけ** push する。UPDATE は行ロックを取るので、
    // 同じ participant を2つの実行が同時に確保することはない。
    //
    // 個別送信モード（participant_id 指定 = 主催者が「送り直し」を押した場合）は
    // confirm_status を意図的に無視する仕様なので、claim を掛けない（従来の順序のまま）。
    const useClaim = !manualParticipantId;

    if (useClaim) {
      const { data: claimed, error: claimError } = await supabase
        .from("participants")
        .update({ confirm_status: "sent", current_question_index: 0 })
        .eq("id", target.participant_id)
        .eq("confirm_status", "pending")
        .select("id");

      if (claimError) {
        console.error(
          `message-sender: claim failed for participant_id=${target.participant_id}: ${claimError.message}`,
        );
        failed++;
        targetResults.push({ eventId: target.event_id, oaConfigId: target.oa_config_id, success: false });
        continue;
      }
      if (!claimed || claimed.length === 0) {
        // 他の実行が先に確保した（= その実行が送る）。二重送信を避けてスキップする。
        // 失敗でも成功でもないので targetResults には積まない。
        skippedConcurrent++;
        continue;
      }
    }

    // push送信（D-02: 1人=1通カウント）
    try {
      await pushMessage(token, target.line_user_id, messages);
    } catch (err) {
      console.error(
        `message-sender: pushMessage failed for participant_id=${target.participant_id}: ${(err as Error).message}`,
      );
      if (useClaim) {
        // 確保を取り消して pending に戻す（次回の実行で再試行される）。
        // 戻さないと「送れていないのに sent」になり、その人は永久に取りこぼされる。
        // 戻す側に倒すと、push は成功していたのに例外になった場合に重複しうるが、
        // このプロダクトでは「届かない」方が「2通届く」より損害が大きいと判断した。
        const { error: revertError } = await supabase
          .from("participants")
          .update({ confirm_status: "pending" })
          .eq("id", target.participant_id)
          .eq("confirm_status", "sent");
        if (revertError) {
          console.error(
            `message-sender: CRITICAL: claim revert failed for participant_id=${target.participant_id}: ${revertError.message}. この参加者は送信されないまま sent になっている。`,
          );
        }
      }
      failed++;
      targetResults.push({ eventId: target.event_id, oaConfigId: target.oa_config_id, success: false });
      continue;
    }

    if (!useClaim) {
      // 個別送信モードのみ: push 成功直後に confirm_status='sent' を更新
      const { error: updateError } = await supabase
        .from("participants")
        .update({ confirm_status: "sent", current_question_index: 0 })
        .eq("id", target.participant_id);

      if (updateError) {
        console.error(
          `message-sender: CRITICAL: confirm_status update failed for participant_id=${target.participant_id}: ${updateError.message}. Duplicate push risk on next cron run.`,
        );
      }
    }

    sent++;
    targetResults.push({ eventId: target.event_id, oaConfigId: target.oa_config_id, success: true });
  }

  if (skippedConcurrent > 0) {
    console.warn(
      `message-sender: ${skippedConcurrent} target(s) were already claimed by a concurrent run — ` +
        `配信ジョブが同一分に重なっている可能性がある`,
    );
  }

  // 7. notification_logs に配信結果を記録（イベント単位で1行 — Pattern 4 の検証規約に揃える）
  //    対象0件は本関数の早期returnで既にここへ来ないため、shouldLogConfirmBroadcast は
  //    常にtrueだが、意図を明示し純関数として単体テスト可能にするために呼ぶ。
  if (shouldLogConfirmBroadcast(confirmedTargets.length)) {
    const aggregates = aggregateConfirmBroadcastResults(targetResults);
    const rows = buildConfirmBroadcastLogRows(aggregates, skippedUnlinked);
    const { error: logError } = await supabase.from("notification_logs").insert(rows);
    if (logError) {
      // ログ insert 失敗は配信結果に影響させない（notifier.ts と同じ流儀）
      console.error(`message-sender: notification_logs insert failed: ${logError.message}`);
    }
  }

  // 8. レスポンス（処理は同期完了 — Open Question 3 推奨）
  return new Response(
    JSON.stringify({
      status: "ok",
      // 同時実行に先を越されてスキップした件数。0 でないなら配信ジョブが同一分に
      // 重なっている可能性が高い（scripts/v11/check-cron-no-collision.ts を見ること）
      skippedConcurrent,
      targets: confirmedTargets.length,
      sent,
      failed,
      skippedUnlinked,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
});
