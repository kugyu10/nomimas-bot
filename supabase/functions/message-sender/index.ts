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
 *   6. 対象ごとに buildInitialMessages + pushMessage → confirm_status='sent' 更新
 *   7. {status, targets, sent, failed, skippedUnlinked} を JSON 200 で返す
 */

import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { createServiceClient } from "../_shared/supabase.ts";
import { issueStatelessToken } from "../_shared/line/token.ts";
import { pushMessage } from "../_shared/line/client.ts";
import { buildInitialMessages } from "../_shared/confirm/messages.ts";
import type { EventInfo } from "../_shared/confirm/messages.ts";
import { formatEventDate, formatMeetingAt } from "../_shared/confirm/format.ts";

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

  if (req.headers.get("x-cron-key") === cronKey) {
    // (A) cron モード — 追加検証なし
  } else {
    // (B) 手動モード候補: Authorization ユーザーJWT + body.event_id
    const authHeader = req.headers.get("Authorization") ?? "";
    let bodyEventId: string | null = null;
    try {
      const body = await req.json();
      bodyEventId = typeof body?.event_id === "string" ? body.event_id : null;
    } catch {
      bodyEventId = null;
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
  //    手動モードは event_id で絞り N日前の窓を無視、cron モードは全OA・窓内
  const { data: targets, error: targetsError } = await supabase.rpc(
    "get_confirm_targets",
    manualEventId ? { p_event_id: manualEventId } : {},
  );
  if (targetsError) {
    console.error(
      `message-sender: get_confirm_targets failed: ${targetsError.message}`,
    );
    return new Response(JSON.stringify({ status: "error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const confirmedTargets = (targets as ConfirmTarget[]) ?? [];

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

  for (const oaConfigId of oaConfigIds) {
    const { data: oaData, error: oaError } = await supabase
      .from("oa_configs")
      .select("questions")
      .eq("id", oaConfigId)
      .single();

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

  for (const target of confirmedTargets) {
    const questions = oaQuestionsMap.get(target.oa_config_id);
    if (!questions || questions.length === 0) {
      // 質問未設定OAはスキップ
      failed++;
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
      messages = buildInitialMessages(eventInfo, questions[0], target.participant_id);
    } catch (err) {
      console.error(
        `message-sender: buildInitialMessages failed for participant_id=${target.participant_id}: ${(err as Error).message}`,
      );
      failed++;
      continue;
    }

    // push送信（D-02: 1人=1通カウント）
    try {
      await pushMessage(token, target.line_user_id, messages);
    } catch (err) {
      // push 失敗: pending のまま残す（翌日 cron が再試行 — クォータ枯渇時の安全挙動）
      console.error(
        `message-sender: pushMessage failed for participant_id=${target.participant_id}: ${(err as Error).message}`,
      );
      failed++;
      continue;
    }

    // push 成功直後に confirm_status='sent' を更新（D-12: 重複防止）
    const { error: updateError } = await supabase
      .from("participants")
      .update({ confirm_status: "sent", current_question_index: 0 })
      .eq("id", target.participant_id);

    if (updateError) {
      // update 失敗は翌日重複 push のリスク — 声高にログ
      console.error(
        `message-sender: CRITICAL: confirm_status update failed for participant_id=${target.participant_id}: ${updateError.message}. Duplicate push risk on next cron run.`,
      );
    }

    sent++;
  }

  // 7. レスポンス（処理は同期完了 — Open Question 3 推奨）
  return new Response(
    JSON.stringify({
      status: "ok",
      targets: confirmedTargets.length,
      sent,
      failed,
      skippedUnlinked,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
});
