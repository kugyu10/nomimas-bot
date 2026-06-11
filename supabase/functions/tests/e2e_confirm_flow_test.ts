/**
 * e2e_confirm_flow_test.ts
 * フルE2E: sender→署名付きpostback×3→DB検証
 *
 * ゲート: E2E_TEST !== "1" の場合は全テストを ignore
 *
 * 前提:
 *   - LINE_DRY_RUN=1 が supabase secrets に設定済み（02-03で設定済み）
 *   - seed participant (…0005) が pending 状態で存在する
 *   - webhook が dev にデプロイ済み
 *
 * シナリオ（PLAN.md Task 3 仕様 + T-02-11/T-02-12/T-02-13検証）:
 *   (a) セットアップ: seed participant を pending/index0 にリセット、answers 該当行削除
 *   (b) curl message-sender → confirm_status='sent' をSQL assert
 *   (c) postback Q1(q_age, a=0) → answers 1行 (question_text スナップショット非null) + in_progress/index1
 *   (d) 再回答上書き: postback Q1(q_age, a=1) 再送 → answers 行数1のまま answer 更新・answered_at 前進、index1 のまま
 *   (e) なりすまし拒否: 攻撃者userId で Q2 postback → 200 だが answers にQ2行なし・状態不変
 *   (f) 想定外テキスト: message イベント送信 → 200・状態/answers不変
 *   (g) postback Q2(q_drink) → index2、postback Q3(q_late) → confirm_status='completed' + answers 3行
 *   (h) 完了後postback → 200・answers/状態不変
 *   (i) 不正署名 postback → 401
 *   teardown: participant を pending に戻し answers を削除（再実行可能性）
 */

import {
  assertEquals,
  assertExists,
  assertNotEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { connectDev } from "../../../scripts/db/sql.ts";

// E2E ゲート（Phase 1 / 02-03 パターン踏襲）
function isE2eEnabled(): boolean {
  try {
    return Deno.env.get("E2E_TEST") === "1";
  } catch {
    return false;
  }
}
const IS_E2E = isE2eEnabled();

function getRequiredEnv(name: string): string {
  const val = Deno.env.get(name) ?? "";
  if (!val) throw new Error(`Missing env: ${name}`);
  return val;
}

// --- 固定シード定数 ---
const SEED_PARTICIPANT_ID = "00000000-0000-0000-0000-000000000005";
const SEED_LINE_USER_ID_STR = "U00000000000000000000000000000dev"; // line_users.line_user_id
const ATTACK_LINE_USER_ID_STR = "U00000000000000000000000000attack";

// 質問ID（seed.sql の oa_configs.questions と一致）
const Q_AGE = "q_age";
const Q_DRINK = "q_drink";
const Q_LATE = "q_late";

/**
 * postback data をエンコードする
 * RESEARCH Pattern 5: URLSearchParams "p=&q=&a=" 形式
 */
function encodePostback(participantId: string, questionId: string, optionIndex: number): string {
  return new URLSearchParams({
    p: participantId,
    q: questionId,
    a: String(optionIndex),
  }).toString();
}

/**
 * LINE HMAC-SHA256 署名を生成する（webhook/index.ts と同一アルゴリズム）
 * Source: _shared/line/signature.ts validateLineSignature
 */
async function generateSignature(body: string, channelSecret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(channelSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return btoa(String.fromCharCode(...new Uint8Array(mac)));
}

/**
 * 署名付き webhook リクエストを送信するヘルパー
 * LINE_DRY_RUN=1 のため reply は実際には送信されない
 */
async function sendSignedEvent(
  webhookUrl: string,
  channelSecret: string,
  eventsJson: object[],
  overrideSignature?: string,
): Promise<Response> {
  const body = JSON.stringify({
    destination: "U_oa_dev",
    events: eventsJson,
  });
  const sig = overrideSignature ?? await generateSignature(body, channelSecret);
  return await fetch(webhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-line-signature": sig,
    },
    body,
  });
}

/**
 * postback イベントオブジェクトを生成する
 * @param isRedelivery 再配達フラグ（WR-03検証用。デフォルト false）
 */
function makePostbackEvent(userId: string, data: string, isRedelivery = false): object {
  return {
    type: "postback",
    replyToken: "dummy-reply-token-" + crypto.randomUUID(),
    source: { type: "user", userId },
    postback: { data },
    deliveryContext: { isRedelivery },
    webhookEventId: crypto.randomUUID(),
  };
}

/**
 * message (text) イベントオブジェクトを生成する
 */
function makeMessageEvent(userId: string, text: string): object {
  return {
    type: "message",
    replyToken: "dummy-reply-token-" + crypto.randomUUID(),
    source: { type: "user", userId },
    message: { type: "text", id: crypto.randomUUID(), text },
    deliveryContext: { isRedelivery: false },
  };
}

/**
 * message (sticker) イベントオブジェクトを生成する（WR-04検証用）
 */
function makeStickerEvent(userId: string): object {
  return {
    type: "message",
    replyToken: "dummy-reply-token-" + crypto.randomUUID(),
    source: { type: "user", userId },
    message: { type: "sticker", id: crypto.randomUUID(), packageId: "446", stickerId: "1988" },
    deliveryContext: { isRedelivery: false },
  };
}

Deno.test({
  name: "e2e: フルE2E confirm flow — sender→postback×3→answers 3行+completed+なりすまし拒否",
  ignore: !IS_E2E,
  async fn() {
    const sql = connectDev();
    const projectRef = getRequiredEnv("DEV_PROJECT_REF");
    const anonKey = getRequiredEnv("SUPABASE_ANON_KEY");
    const channelSecret = getRequiredEnv("LINE_CHANNEL_SECRET");

    const webhookUrl = `https://${projectRef}.supabase.co/functions/v1/webhook`;
    const senderUrl = `https://${projectRef}.supabase.co/functions/v1/message-sender`;

    try {
      // === (a) セットアップ ===
      // seed participant を pending/index0 にリセット
      await sql`
        UPDATE public.participants
        SET confirm_status = 'pending', current_question_index = 0
        WHERE id = ${SEED_PARTICIPANT_ID}
      `;
      // answers の該当行を削除（再実行可能性）
      await sql`
        DELETE FROM public.answers
        WHERE participant_id = ${SEED_PARTICIPANT_ID}
      `;

      // セットアップ確認
      const setupRows = await sql<{ confirm_status: string; current_question_index: number }[]>`
        SELECT confirm_status, current_question_index
        FROM public.participants
        WHERE id = ${SEED_PARTICIPANT_ID}
      `;
      assertEquals(setupRows[0]?.confirm_status, "pending", "(a) セットアップ: pending であること");
      assertEquals(setupRows[0]?.current_question_index, 0, "(a) セットアップ: index=0 であること");

      const answersSetup = await sql<{ count: string }[]>`
        SELECT COUNT(*) as count FROM public.answers WHERE participant_id = ${SEED_PARTICIPANT_ID}
      `;
      assertEquals(Number(answersSetup[0]?.count), 0, "(a) セットアップ: answers が 0行 であること");

      // === (b) message-sender → confirm_status='sent' ===
      // WR-01: anonキー（ゲートウェイJWT）に加え x-cron-key 専用シークレットが必要
      const senderResp = await fetch(senderUrl, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${anonKey}`,
          "x-cron-key": getRequiredEnv("CRON_FUNCTION_KEY"),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });
      assertEquals(senderResp.status, 200, "(b) message-sender が 200 を返すこと");

      const senderBody = await senderResp.json() as { status: string; sent: number };
      assertEquals(senderBody.status, "ok", "(b) message-sender レスポンス status='ok'");
      assertEquals(senderBody.sent >= 1, true, "(b) message-sender sent >= 1");

      const afterSenderRows = await sql<{ confirm_status: string }[]>`
        SELECT confirm_status FROM public.participants WHERE id = ${SEED_PARTICIPANT_ID}
      `;
      assertEquals(afterSenderRows[0]?.confirm_status, "sent", "(b) confirm_status が 'sent' に遷移すること");

      // === (c) postback Q1(q_age, a=0) ===
      const q1Data = encodePostback(SEED_PARTICIPANT_ID, Q_AGE, 0);
      const q1Resp = await sendSignedEvent(webhookUrl, channelSecret, [
        makePostbackEvent(SEED_LINE_USER_ID_STR, q1Data),
      ]);
      assertEquals(q1Resp.status, 200, "(c) Q1 postback → 200");
      await q1Resp.body?.cancel(); // drain

      // DB 確認: answers 1行、question_text スナップショット非null、in_progress/index1
      const afterQ1Answers = await sql<{
        question_key: string;
        question_text: string;
        answer: string;
        answered_at: string;
        participant_id: string;
      }[]>`
        SELECT question_key, question_text, answer, answered_at, participant_id
        FROM public.answers
        WHERE participant_id = ${SEED_PARTICIPANT_ID}
      `;
      assertEquals(afterQ1Answers.length, 1, "(c) answers が 1行 であること");
      assertEquals(afterQ1Answers[0]?.question_key, Q_AGE, "(c) question_key が q_age であること");
      assertExists(afterQ1Answers[0]?.question_text, "(c) question_text スナップショットが非null であること");
      assertNotEquals(afterQ1Answers[0]?.question_text, "", "(c) question_text が空でないこと");
      assertEquals(afterQ1Answers[0]?.participant_id, SEED_PARTICIPANT_ID, "(c) participant_id が一致すること");

      const afterQ1State = await sql<{ confirm_status: string; current_question_index: number }[]>`
        SELECT confirm_status, current_question_index
        FROM public.participants
        WHERE id = ${SEED_PARTICIPANT_ID}
      `;
      assertEquals(afterQ1State[0]?.confirm_status, "in_progress", "(c) confirm_status が 'in_progress' であること");
      assertEquals(afterQ1State[0]?.current_question_index, 1, "(c) current_question_index が 1 であること");

      // === (d) 再回答上書き: postback Q1(q_age, a=1) 再送 ===
      const firstAnsweredAt = afterQ1Answers[0]?.answered_at;
      // 少し待って answered_at が前進することを確認できるようにする
      await new Promise((r) => setTimeout(r, 1100));

      const q1Again = encodePostback(SEED_PARTICIPANT_ID, Q_AGE, 1);
      const q1AgainResp = await sendSignedEvent(webhookUrl, channelSecret, [
        makePostbackEvent(SEED_LINE_USER_ID_STR, q1Again),
      ]);
      assertEquals(q1AgainResp.status, 200, "(d) Q1再送 → 200");
      await q1AgainResp.body?.cancel();

      const afterReAnswerRows = await sql<{
        question_key: string;
        answer: string;
        answered_at: string;
      }[]>`
        SELECT question_key, answer, answered_at
        FROM public.answers
        WHERE participant_id = ${SEED_PARTICIPANT_ID}
      `;
      assertEquals(afterReAnswerRows.length, 1, "(d) 再回答後も answers 行数が 1 のまま（UPSERT上書き）");
      // 答えが更新されていること
      const q_age_options = ["20歳以上です", "未成年です"];
      assertEquals(afterReAnswerRows[0]?.answer, q_age_options[1], "(d) answer が 2番目の選択肢(a=1)に上書きされていること");
      // answered_at が前進していること
      assertNotEquals(afterReAnswerRows[0]?.answered_at, firstAnsweredAt, "(d) answered_at が前進していること");

      // index1 のまま（過去問再タップなのでindexは変わらない）
      const afterReAnswerState = await sql<{ current_question_index: number }[]>`
        SELECT current_question_index FROM public.participants WHERE id = ${SEED_PARTICIPANT_ID}
      `;
      assertEquals(afterReAnswerState[0]?.current_question_index, 1, "(d) current_question_index が 1 のまま（indexは変わらない）");

      // === (d2) 再配達スキップ: 旧 Q1(a=0) postback の再配達が再回答(a=1)を巻き戻さない（WR-03） ===
      const redeliveredQ1 = encodePostback(SEED_PARTICIPANT_ID, Q_AGE, 0);
      const redeliveryResp = await sendSignedEvent(webhookUrl, channelSecret, [
        makePostbackEvent(SEED_LINE_USER_ID_STR, redeliveredQ1, true),
      ]);
      assertEquals(redeliveryResp.status, 200, "(d2) 再配達postback → 200");
      await redeliveryResp.body?.cancel();

      const afterRedelivery = await sql<{ answer: string }[]>`
        SELECT answer FROM public.answers
        WHERE participant_id = ${SEED_PARTICIPANT_ID} AND question_key = ${Q_AGE}
      `;
      assertEquals(
        afterRedelivery[0]?.answer,
        q_age_options[1],
        "(d2) 再配達postbackで answer が a=0 に巻き戻されないこと（WR-03）",
      );

      const afterRedeliveryState = await sql<{ current_question_index: number }[]>`
        SELECT current_question_index FROM public.participants WHERE id = ${SEED_PARTICIPANT_ID}
      `;
      assertEquals(afterRedeliveryState[0]?.current_question_index, 1, "(d2) 再配達後も index が 1 のまま");

      // === (e) なりすまし拒否: 攻撃者userId で Q2 postback ===
      const q2DataAttack = encodePostback(SEED_PARTICIPANT_ID, Q_DRINK, 0);
      const attackResp = await sendSignedEvent(webhookUrl, channelSecret, [
        makePostbackEvent(ATTACK_LINE_USER_ID_STR, q2DataAttack),
      ]);
      assertEquals(attackResp.status, 200, "(e) なりすまし postback → 200（署名は通るがビジネスロジックで拒否）");
      await attackResp.body?.cancel();

      // answers に Q2 行がないこと
      const afterAttackAnswers = await sql<{ count: string }[]>`
        SELECT COUNT(*) as count
        FROM public.answers
        WHERE participant_id = ${SEED_PARTICIPANT_ID} AND question_key = ${Q_DRINK}
      `;
      assertEquals(Number(afterAttackAnswers[0]?.count), 0, "(e) なりすまし後 answers に Q2(q_drink)行がないこと");

      // 状態が変化していないこと (index1, in_progress)
      const afterAttackState = await sql<{ confirm_status: string; current_question_index: number }[]>`
        SELECT confirm_status, current_question_index
        FROM public.participants
        WHERE id = ${SEED_PARTICIPANT_ID}
      `;
      assertEquals(afterAttackState[0]?.confirm_status, "in_progress", "(e) なりすまし後 confirm_status が変化していないこと");
      assertEquals(afterAttackState[0]?.current_question_index, 1, "(e) なりすまし後 current_question_index が変化していないこと");

      // === (f) 想定外テキスト: message イベント ===
      const msgResp = await sendSignedEvent(webhookUrl, channelSecret, [
        makeMessageEvent(SEED_LINE_USER_ID_STR, "こんにちは"),
      ]);
      assertEquals(msgResp.status, 200, "(f) テキスト message → 200");
      await msgResp.body?.cancel();

      // 状態/answers が変化していないこと
      const afterMsgAnswers = await sql<{ count: string }[]>`
        SELECT COUNT(*) as count FROM public.answers WHERE participant_id = ${SEED_PARTICIPANT_ID}
      `;
      assertEquals(Number(afterMsgAnswers[0]?.count), 1, "(f) テキスト後 answers 行数が変化していないこと (1行のまま)");

      const afterMsgState = await sql<{ current_question_index: number }[]>`
        SELECT current_question_index FROM public.participants WHERE id = ${SEED_PARTICIPANT_ID}
      `;
      assertEquals(afterMsgState[0]?.current_question_index, 1, "(f) テキスト後 current_question_index が変化していないこと");

      // === (f2) スタンプメッセージ: 200 で受理され状態/answers 不変（WR-04: 破棄されず再誘導経路に乗る） ===
      const stickerResp = await sendSignedEvent(webhookUrl, channelSecret, [
        makeStickerEvent(SEED_LINE_USER_ID_STR),
      ]);
      assertEquals(stickerResp.status, 200, "(f2) スタンプ message → 200");
      await stickerResp.body?.cancel();

      const afterStickerAnswers = await sql<{ count: string }[]>`
        SELECT COUNT(*) as count FROM public.answers WHERE participant_id = ${SEED_PARTICIPANT_ID}
      `;
      assertEquals(Number(afterStickerAnswers[0]?.count), 1, "(f2) スタンプ後 answers 行数が変化していないこと");

      const afterStickerState = await sql<{ current_question_index: number }[]>`
        SELECT current_question_index FROM public.participants WHERE id = ${SEED_PARTICIPANT_ID}
      `;
      assertEquals(afterStickerState[0]?.current_question_index, 1, "(f2) スタンプ後 current_question_index が変化していないこと");

      // === (g) postback Q2(q_drink) → index2, postback Q3(q_late) → completed ===
      // Q2
      const q2Data = encodePostback(SEED_PARTICIPANT_ID, Q_DRINK, 0);
      const q2Resp = await sendSignedEvent(webhookUrl, channelSecret, [
        makePostbackEvent(SEED_LINE_USER_ID_STR, q2Data),
      ]);
      assertEquals(q2Resp.status, 200, "(g) Q2 postback → 200");
      await q2Resp.body?.cancel();

      const afterQ2State = await sql<{ current_question_index: number }[]>`
        SELECT current_question_index FROM public.participants WHERE id = ${SEED_PARTICIPANT_ID}
      `;
      assertEquals(afterQ2State[0]?.current_question_index, 2, "(g) Q2後 current_question_index が 2 であること");

      // Q3 (最終問)
      const q3Data = encodePostback(SEED_PARTICIPANT_ID, Q_LATE, 0);
      const q3Resp = await sendSignedEvent(webhookUrl, channelSecret, [
        makePostbackEvent(SEED_LINE_USER_ID_STR, q3Data),
      ]);
      assertEquals(q3Resp.status, 200, "(g) Q3 postback → 200");
      await q3Resp.body?.cancel();

      // DB確認: confirm_status='completed', answers 3行
      const afterQ3State = await sql<{ confirm_status: string; current_question_index: number }[]>`
        SELECT confirm_status, current_question_index
        FROM public.participants
        WHERE id = ${SEED_PARTICIPANT_ID}
      `;
      assertEquals(afterQ3State[0]?.confirm_status, "completed", "(g) Q3後 confirm_status が 'completed' であること");

      const afterQ3Answers = await sql<{
        question_key: string;
        question_text: string;
        participant_id: string;
      }[]>`
        SELECT question_key, question_text, participant_id
        FROM public.answers
        WHERE participant_id = ${SEED_PARTICIPANT_ID}
        ORDER BY question_key
      `;
      assertEquals(afterQ3Answers.length, 3, "(g) answers が 3行 であること");

      // 全行に question_text スナップショットと participant_id が入っていること
      for (const row of afterQ3Answers) {
        assertExists(row.question_text, `(g) ${row.question_key} の question_text スナップショットが存在すること`);
        assertNotEquals(row.question_text, "", `(g) ${row.question_key} の question_text が空でないこと`);
        assertEquals(row.participant_id, SEED_PARTICIPANT_ID, `(g) ${row.question_key} の participant_id が seed と一致すること`);
      }

      // 3問すべての question_key が揃っていること
      const questionKeys = afterQ3Answers.map((r) => r.question_key).sort();
      assertEquals(questionKeys, [Q_AGE, Q_DRINK, Q_LATE].sort(), "(g) 3問すべての question_key が揃っていること");

      // === (h) 完了後postback → 200・answers/状態不変 ===
      const postCompletionData = encodePostback(SEED_PARTICIPANT_ID, Q_AGE, 0);
      const postCompletionResp = await sendSignedEvent(webhookUrl, channelSecret, [
        makePostbackEvent(SEED_LINE_USER_ID_STR, postCompletionData),
      ]);
      assertEquals(postCompletionResp.status, 200, "(h) 完了後postback → 200");
      await postCompletionResp.body?.cancel();

      // 状態不変
      const afterCompletionState = await sql<{ confirm_status: string }[]>`
        SELECT confirm_status FROM public.participants WHERE id = ${SEED_PARTICIPANT_ID}
      `;
      assertEquals(afterCompletionState[0]?.confirm_status, "completed", "(h) 完了後 confirm_status が変化していないこと");

      // answers 3行のまま
      const afterCompletionAnswers = await sql<{ count: string }[]>`
        SELECT COUNT(*) as count FROM public.answers WHERE participant_id = ${SEED_PARTICIPANT_ID}
      `;
      assertEquals(Number(afterCompletionAnswers[0]?.count), 3, "(h) 完了後 answers 行数が変化していないこと (3行のまま)");

      // === (i) 不正署名 → 401 ===
      const badSigData = encodePostback(SEED_PARTICIPANT_ID, Q_AGE, 0);
      const badSigResp = await sendSignedEvent(
        webhookUrl,
        channelSecret,
        [makePostbackEvent(SEED_LINE_USER_ID_STR, badSigData)],
        "INVALID_SIGNATURE_BASE64==",
      );
      assertEquals(badSigResp.status, 401, "(i) 不正署名 → 401");
      await badSigResp.body?.cancel();

    } finally {
      // teardown: participant を pending に戻し answers を削除（再実行可能性）
      await sql`
        UPDATE public.participants
        SET confirm_status = 'pending', current_question_index = 0
        WHERE id = ${SEED_PARTICIPANT_ID}
      `;
      await sql`
        DELETE FROM public.answers
        WHERE participant_id = ${SEED_PARTICIPANT_ID}
      `;

      // 復元確認
      const restoredRows = await sql<{ confirm_status: string }[]>`
        SELECT confirm_status FROM public.participants WHERE id = ${SEED_PARTICIPANT_ID}
      `;
      assertEquals(
        restoredRows[0]?.confirm_status,
        "pending",
        "teardown: seed participant が pending に復元されていること",
      );

      await sql.end();
    }
  },
});

Deno.test({
  name: "e2e: 再フォローで display_name が保持される（CR-02）",
  ignore: !IS_E2E,
  async fn() {
    const sql = connectDev();
    const projectRef = getRequiredEnv("DEV_PROJECT_REF");
    const channelSecret = getRequiredEnv("LINE_CHANNEL_SECRET");
    const webhookUrl = `https://${projectRef}.supabase.co/functions/v1/webhook`;
    const SEED_LINE_USER_UUID = "00000000-0000-0000-0000-000000000004";

    try {
      // 事前: seed line_user に display_name が設定されている状態を保証
      await sql`
        UPDATE public.line_users
        SET display_name = 'dev-tester'
        WHERE id = ${SEED_LINE_USER_UUID}
      `;

      // followイベント（ブロック解除＝再フォロー相当）を署名付き送信
      const followEvent = {
        type: "follow",
        replyToken: "dummy-follow-" + crypto.randomUUID(),
        source: { type: "user", userId: SEED_LINE_USER_ID_STR },
        follow: { isUnblocked: true },
      };
      const resp = await sendSignedEvent(webhookUrl, channelSecret, [followEvent]);
      assertEquals(resp.status, 200, "follow イベント → 200");
      await resp.body?.cancel();

      // CR-02: display_name が null 上書きされていないこと
      const rows = await sql<{ display_name: string | null; followed_at: string | null }[]>`
        SELECT display_name, followed_at
        FROM public.line_users
        WHERE id = ${SEED_LINE_USER_UUID}
      `;
      assertEquals(
        rows[0]?.display_name,
        "dev-tester",
        "再フォロー後も display_name が保持されること（CR-02）",
      );
      assertExists(rows[0]?.followed_at, "followed_at が更新されていること");
    } finally {
      await sql.end();
    }
  },
});
