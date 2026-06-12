/**
 * LINE Webhook受信Edge Function（Phase 2: ステートマシン接続版）
 *
 * 処理順（順序厳守）:
 * 1. raw body取得（JSON parse前に必ずawait req.text()）
 * 2. x-line-signature検証 → 不正なら401
 * 3. JSON.parse(rawBody) → zodで形状検証 → 不正なら400
 * 4. イベントルーティング（postback/follow/message）+ ステートマシン接続
 *    全イベント処理後に必ず200を返す（再配達ストーム防止: reply失敗もログのみで200 — Pitfall 3）
 *
 * verify_jwt=false: config.toml [functions.webhook] + --no-verify-jwt フラグで二重指定
 * LINEプラットフォームはSupabase JWTを送れないため必須
 *
 * セキュリティ:
 *   T-02-11: なりすまし防止 — postback処理でsource.userId ↔ participants→line_users.line_user_idの一致と
 *            oa_config境界を保存・遷移・replyのすべてより前に照合
 *   T-02-12: x-line-signature検証（既存・順序不変）
 *   T-02-13: answers UPSERT + transition()のindex一致ガードで二重遷移防止
 *   T-02-14: ログにuserId/本文/postback生値を出力しない
 *   T-02-15: 1イベント1 reply、DB更新先行
 */

import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { validateLineSignature } from "../_shared/line/signature.ts";
import { createServiceClient } from "../_shared/supabase.ts";
import { issueStatelessToken } from "../_shared/line/token.ts";
import { replyMessage } from "../_shared/line/client.ts";
import { parseWebhookEvent } from "../_shared/line/events.ts";
import { decodePostbackData } from "../_shared/confirm/postback.ts";
import { answerPersistFailureResult, transition } from "../_shared/confirm/state.ts";
import type { ConfirmStatus, Question } from "../_shared/confirm/state.ts";
import {
  buildCompletionMessages,
  buildQuestionMessage,
  buildRepromptMessages,
} from "../_shared/confirm/messages.ts";
import { notifyConfirmUpdate } from "../_shared/notify/notifier.ts";

// Webhookペイロードのzodスキーマ（形状検証のみ）
const WebhookPayloadSchema = z.object({
  destination: z.string(),
  events: z.array(z.unknown()),
});

// oa_configs.questions の各要素スキーマ（message-sender と同形）
const QuestionSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  options: z.array(z.string().min(1)).min(1),
});
const QuestionsSchema = z.array(QuestionSchema);

/** oa_configs 行（webhook用） */
interface OaConfig {
  id: string;
  questions: Question[];
}

/** participants 行（webhook用） */
interface ParticipantRow {
  id: string;
  confirm_status: string;
  current_question_index: number;
  line_user_id: string | null; // line_users.id (uuid FK)
  // WR-05: participant の所属イベント側 OA 境界照合用
  // participants.event_platform_url_id → event_platform_urls.event_id → events.oa_config_id
  event_platform_urls: {
    events: { oa_config_id: string } | null;
  } | null;
}

/** line_users 行（webhook用） */
interface LineUserRow {
  id: string;
  oa_config_id: string;
  line_user_id: string; // "U..." 文字列（LINE的 userId）
}

Deno.serve(async (req) => {
  // GET等の非POSTメソッドは405
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  // (1) raw bodyを最初に取得（必ずJSON.parseより前）
  const rawBody = await req.text();

  // (2) x-line-signature検証（不正なら401 — ビジネスロジックは一切実行しない）
  // env未設定は設定エラーとして500を返し、署名不正(401)と区別する（WR-01）
  const channelSecret = Deno.env.get("LINE_CHANNEL_SECRET") ?? "";
  if (!channelSecret) {
    console.error("webhook: LINE_CHANNEL_SECRET is not set");
    return new Response("server configuration error", { status: 500 });
  }
  const sig = req.headers.get("x-line-signature") ?? "";
  const isValid = await validateLineSignature(rawBody, channelSecret, sig);
  if (!isValid) {
    return new Response("invalid signature", { status: 401 });
  }

  // (2.5) LINE_CHANNEL_ID 未設定も設定エラーとして 500（WR-06）
  // 未設定のまま進むと oa_configs 検索が空振りし「oa_configs not found」の200で
  // 全イベントが黙殺される（設定漏れが表面化しない）。署名検証より後・JSON検証より前に
  // 配置して順序契約（署名不正は常に401が先）は維持する
  const channelId = Deno.env.get("LINE_CHANNEL_ID") ?? "";
  if (!channelId) {
    console.error("webhook: LINE_CHANNEL_ID is not set");
    return new Response("server configuration error", { status: 500 });
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

  // (4) イベントルーティング + ステートマシン接続
  // 署名検証済み後のすべての処理は例外が漏れても200を返す（再配達防止）

  // OA設定を解決（line_channel_id = env LINE_CHANNEL_ID で1行 select）
  // replyが必要になった時点でトークンを遅延発行するため supabase クライアントを先に作る
  const supabase = createServiceClient();

  let oaConfig: OaConfig | null = null;

  try {
    const { data, error } = await supabase
      .from("oa_configs")
      .select("id, questions")
      .eq("line_channel_id", channelId)
      .single();

    if (error || !data) {
      // 設定なし: ログ+200（LINEに再送させない — 署名検証は通っているのでサービス設定の問題）
      console.error(
        `webhook: oa_configs not found for LINE_CHANNEL_ID. events=${payload.events.length}`,
      );
      return new Response("ok", { status: 200 });
    }

    const parsed = QuestionsSchema.safeParse(data.questions);
    if (!parsed.success) {
      console.error(
        `webhook: oa_configs.questions invalid: ${parsed.error.message}`,
      );
      return new Response("ok", { status: 200 });
    }

    oaConfig = { id: data.id, questions: parsed.data };
  } catch (err) {
    console.error(`webhook: oa_configs fetch error: ${(err as Error).message}`);
    return new Response("ok", { status: 200 });
  }

  console.log(`webhook: received ${payload.events.length} event(s)`);

  // replyTokenを使うときに遅延発行するためのトークンキャッシュ
  let cachedToken: string | null = null;
  async function getToken(): Promise<string | null> {
    if (cachedToken) return cachedToken;
    if (!channelId || !channelSecret) return null;
    try {
      cachedToken = await issueStatelessToken(channelId, channelSecret);
      return cachedToken;
    } catch (err) {
      console.error(`webhook: token issue failed: ${(err as Error).message}`);
      return null;
    }
  }

  // イベントごとに独立して処理（1件の失敗が他イベントを巻き込まない）
  for (const rawEvent of payload.events) {
    try {
      await handleEvent(rawEvent, oaConfig, supabase, getToken);
    } catch (err) {
      console.error(`webhook: unhandled error in event: ${(err as Error).message}`);
    }
  }

  // 常に200（再配達ストーム防止）
  return new Response("ok", { status: 200 });
});

/**
 * 各イベントを処理するメイン関数
 * DB更新を先に行い、reply送信を後に行う（Pitfall 3: DB先行でreply失敗時も次メッセージで回復）
 */
async function handleEvent(
  rawEvent: unknown,
  oaConfig: OaConfig,
  supabase: SupabaseClient, // IN-04: any をやめ supabase-js の型を使う
  getToken: () => Promise<string | null>,
): Promise<void> {
  const event = parseWebhookEvent(rawEvent);
  if (!event) {
    // 未知イベント種別: 無視（ログのみ）
    return;
  }

  if (event.kind === "follow") {
    // follow: line_users へ upsert
    // (oa_config_id, line_user_id) の一意制約でupsert（IN-06修正済み）
    // replyしない（挨拶はLINE OA Manager側の領分 — D-07）
    // CR-02: display_name はペイロードに含めない — 含めると再フォロー時に
    // ON CONFLICT DO UPDATE で既存の display_name が null 上書きされデータ消失する
    const { error } = await supabase
      .from("line_users")
      .upsert(
        {
          oa_config_id: oaConfig.id,
          line_user_id: event.userId,
          followed_at: new Date().toISOString(),
        },
        { onConflict: "oa_config_id,line_user_id" },
      );

    if (error) {
      console.error(`webhook: follow upsert failed: ${error.message}`);
    } else {
      console.log(`webhook: follow upserted oa_config_id=${oaConfig.id}`);
    }
    return;
  }

  if (event.kind === "postback") {
    // WR-03: LINEから再配達された postback は処理しない（ログのみ・200）
    // 過去質問の再タップ（ルール4）は冪等でないため、旧postbackの再配達が
    // ユーザーの新しい再回答を巻き戻すのを防ぐ。現在質問の遷移もスキップして
    // 二重処理を避ける（初回配達が処理済みである前提が isRedelivery の意味論）
    if (event.isRedelivery) {
      console.log("webhook: skipping redelivered postback event");
      return;
    }

    // postback: 1問1答ステートマシン処理
    const payload = decodePostbackData(event.data);
    if (!payload) {
      // デコード失敗: 無視（不正なpostback data）
      console.warn(`webhook: postback decode failed — ignoring`);
      return;
    }

    const { participantId, questionId, optionIndex } = payload;

    // participants を select（line_users の uuid FK と所属イベントの oa_config_id を取得）
    // WR-05: event_platform_urls→events をネスト select し OA 境界照合に使う
    const { data: participantRowData, error: participantError } = await supabase
      .from("participants")
      .select(
        "id, confirm_status, current_question_index, line_user_id, event_platform_urls(events(oa_config_id))",
      )
      .eq("id", participantId)
      .single();
    const participantRow = participantRowData as ParticipantRow | null;

    if (participantError || !participantRow) {
      console.warn(
        `webhook: participant not found participant_id=${participantId}`,
      );
      return;
    }

    if (!participantRow.line_user_id) {
      // line_user_id未紐付け: なりすましチェック不可 → 保護的に無視
      console.warn(
        `webhook: participant has no line_user_id participant_id=${participantId}`,
      );
      return;
    }

    // line_users 行を取得（line_user_id = "U..." 文字列と oa_config_id を取得）
    const { data: lineUserRowData, error: lineUserError } = await supabase
      .from("line_users")
      .select("id, oa_config_id, line_user_id")
      .eq("id", participantRow.line_user_id)
      .single();
    const lineUserRow = lineUserRowData as LineUserRow | null;

    if (lineUserError || !lineUserRow) {
      console.warn(
        `webhook: line_users row not found for participant_id=${participantId}`,
      );
      return;
    }

    // T-02-11: なりすまし照合（保存・遷移・replyのすべてより前）
    // (1) source.userId と line_users.line_user_id の一致
    // (2) line_users.oa_config_id 境界の確認
    // (3) WR-05: participant の所属イベント（events.oa_config_id）も同一OAであること
    //     — OA-A の line_user に OA-B のイベント参加者が紐付くデータ不整合があっても
    //       OA-A の questions に基づく回答が OA-B の answers に書き込まれない
    const participantEventOaId =
      participantRow.event_platform_urls?.events?.oa_config_id ?? null;
    if (
      lineUserRow.line_user_id !== event.userId ||
      lineUserRow.oa_config_id !== oaConfig.id ||
      participantEventOaId !== oaConfig.id
    ) {
      // なりすまし検出: participant_id のみログ（userId非ログ — T-02-14）
      console.warn(
        `webhook: spoofing detected participant_id=${participantId}`,
      );
      return;
    }

    // transition() 純関数で遷移を計算
    const current = {
      status: participantRow.confirm_status as ConfirmStatus,
      index: participantRow.current_question_index,
    };

    let result = transition(
      current,
      oaConfig.questions,
      { questionId, optionIndex },
    );

    console.log(
      `webhook: postback participant_id=${participantId} reply=${result.reply}`,
    );

    // (a) answer があれば answers へ upsert（DB更新を先 — Pitfall 3）
    // answerPersistFailed フラグで保存成否を後段（通知判定）で明示化
    // 04-REVIEW WR-02: 同一回答の再送（過去質問ボタンの再タップ等）は通知をスキップする。
    // 保存（upsert）自体は実行するが、値が変わらない場合は owner への push を抑止し、
    // 再タップ連打による通知スパム / LINE メッセージ枠消費を防ぐ。
    // select 失敗時は安全側（変化あり扱い = 通知継続）に倒し 200 契約に影響させない
    let answerPersistFailed = false;
    let answerUnchanged = false;
    if (result.answer) {
      const { data: prevAnswer, error: prevAnswerError } = await supabase
        .from("answers")
        .select("answer")
        .eq("participant_id", participantId)
        .eq("question_key", result.answer.questionId)
        .maybeSingle();

      if (prevAnswerError) {
        console.error(
          `webhook: previous answer select failed participant_id=${participantId}: ${prevAnswerError.message}`,
        );
      } else if (prevAnswer && prevAnswer.answer === result.answer.answer) {
        answerUnchanged = true;
      }

      const { error: upsertError } = await supabase
        .from("answers")
        .upsert(
          {
            participant_id: participantId,
            question_key: result.answer.questionId,
            question_text: result.answer.questionText,
            answer: result.answer.answer,
            answered_at: new Date().toISOString(), // Pitfall 9: 明示更新（トリガーなし）
          },
          { onConflict: "participant_id,question_key" }, // D-13: 再回答はUPSERT上書き
        );

      if (upsertError) {
        console.error(
          `webhook: answers upsert failed participant_id=${participantId}: ${upsertError.message}`,
        );
        // WR-02: 保存失敗時は index/status を前進させず、同一質問を再提示して
        // 次の postback でリトライさせる（前進すると回答が恒久的に失われる）
        result = answerPersistFailureResult(current);
        answerPersistFailed = true;
      }
    }

    // (b) 状態が変わる場合 participants を update（DB更新を先 — Pitfall 3）
    const statusChanged =
      result.nextStatus !== current.status ||
      result.nextIndex !== current.index;

    if (statusChanged) {
      const { error: updateError } = await supabase
        .from("participants")
        .update({
          confirm_status: result.nextStatus,
          current_question_index: result.nextIndex,
        })
        .eq("id", participantId);

      if (updateError) {
        console.error(
          `webhook: participants update failed participant_id=${participantId}: ${updateError.message}`,
        );
      }
    }

    // (c) reply送信（DB更新後 — Pitfall 3）
    // 1イベントにつきreply呼び出しは最大1回（replyTokenは1回限り — Pitfall 3）
    // 早期 return を取り除き、reply の成否に関わらず (d) 通知呼び出しへ到達させる
    if (result.reply !== "none") {
      const token = await getToken();
      if (!token) {
        console.error(
          `webhook: token unavailable for reply participant_id=${participantId}`,
        );
        // token 取得失敗でも通知へ到達するためここでは return しない
      } else {
        let messages: object[] | null = null;
        if (result.reply === "next_question") {
          const nextQ = oaConfig.questions[result.nextIndex];
          if (!nextQ) {
            console.error(
              `webhook: next question not found index=${result.nextIndex}`,
            );
          } else {
            messages = [buildQuestionMessage(nextQ, participantId)];
          }
        } else if (result.reply === "completion") {
          messages = buildCompletionMessages();
        } else {
          // reprompt: 現在の質問を再送
          const currentQ = oaConfig.questions[current.index];
          if (!currentQ) {
            console.error(
              `webhook: reprompt question not found index=${current.index}`,
            );
          } else {
            messages = buildRepromptMessages(currentQ, participantId);
          }
        }

        if (messages) {
          try {
            await replyMessage(token, event.replyToken, messages);
          } catch (err) {
            // reply失敗はログのみ（DB更新済みなので次のユーザーメッセージで再誘導が回復経路 — Pitfall 3）
            console.error(
              `webhook: replyMessage failed participant_id=${participantId}: ${(err as Error).message}`,
            );
          }
        }
      }
    }

    // (d) owner/co-owner 通知（NOTIF-01 — reply 送信の後 — Pitfall 3）
    // 失敗しても 200 契約・reply に影響させない（T-04-07）
    // 保存成功の場合のみ通知（answerPersistFailed=false）— Pitfall 9 対応
    // 04-REVIEW WR-02: 値が変わらない再送（answerUnchanged=true）は通知をスキップ
    if (result.answer && !answerPersistFailed) {
      if (answerUnchanged) {
        console.log(
          `webhook: notify skipped — answer unchanged participant_id=${participantId}`,
        );
      } else {
        try {
          const notifyKind = result.reply === "completion" ? "completion" : "answer";
          const r = await notifyConfirmUpdate(supabase, getToken, {
            participantId,
            kind: notifyKind,
          });
          console.log(
            `webhook: notify kind=${r.kind} inWindow=${r.inWindow} sent=${r.sent} failed=${r.failed} skipped=${r.skippedNoLineId}`,
          );
        } catch (err) {
          console.error(
            `webhook: notify failed participant_id=${participantId}: ${(err as Error).message}`,
          );
        }
      }
    }
    return;
  }

  if (event.kind === "message") {
    // テキスト等の想定外入力（D-07）
    // 進行中の参加者には現在質問を再送、進行中でない参加者には応答しない

    // (oa_config_id, userId) → line_users.id を引く
    const { data: lineUserRowMsgData, error: lineUserError } = await supabase
      .from("line_users")
      .select("id")
      .eq("oa_config_id", oaConfig.id)
      .eq("line_user_id", event.userId)
      .single();
    const lineUserRowMsg = lineUserRowMsgData as { id: string } | null;

    if (lineUserError || !lineUserRowMsg) {
      // 未登録ユーザー: 応答しない
      return;
    }

    // その line_users.id に紐づく参加者で confirm_status in ('sent','in_progress') の行を取得
    // 複数イベント並行時は updated_at desc で最新1件（RESEARCH Open Question 1）
    const { data: participantRowMsgData, error: participantError } = await supabase
      .from("participants")
      .select("id, current_question_index")
      .eq("line_user_id", lineUserRowMsg.id)
      .in("confirm_status", ["sent", "in_progress"])
      .order("updated_at", { ascending: false })
      .limit(1)
      .single();
    const participantRow = participantRowMsgData as { id: string; current_question_index: number } | null;

    if (participantError || !participantRow) {
      // 進行中でないユーザー: 応答しない（自動応答はOA Manager側の領分）
      return;
    }

    const currentQ = oaConfig.questions[participantRow.current_question_index];
    if (!currentQ) {
      // 質問が取得できない: 応答しない
      console.warn(
        `webhook: message reprompt question not found index=${participantRow.current_question_index}`,
      );
      return;
    }

    const token = await getToken();
    if (!token) {
      console.error(`webhook: token unavailable for message reprompt`);
      return;
    }

    const messages = buildRepromptMessages(currentQ, participantRow.id);

    try {
      await replyMessage(token, event.replyToken, messages);
    } catch (err) {
      console.error(
        `webhook: message reprompt reply failed: ${(err as Error).message}`,
      );
    }

    // messageイベントでは answers / participants を書き換えない（仕様）
    return;
  }
}
