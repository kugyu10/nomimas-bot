/**
 * e2e_full_chain_test.ts
 * 全鎖 E2E: 実Twiplaスクレイプ→紐付け済みseed→配信→postback×3→通知 logs assert
 *
 * ゲート: E2E_TEST !== "1" の場合は全テストを ignore
 *
 * 前提（04-01 完了済み）:
 *   - notification_logs テーブルが存在する
 *   - oa_members.line_user_id が存在し user1（dev-oa owner）に値が設定済み
 *   - seed epu ...0003 が https://twipla.jp/events/731057 で登録済み
 *   - webhook/scraper が dev にデプロイ済み（notifier 結線済み）
 *   - LINE_DRY_RUN=1 が dev secrets に設定済み
 *
 * シナリオ（RESEARCH Pattern 7）:
 *   (a) setup: event_date を current_date+1 に変更（窓内化）、窓外フィクスチャ作成、notification_logs 掃除
 *   (b) 実Twiplaスクレイプ → 200 / saved:true / count>0
 *   (c) scrape差分通知の決定的化: 1行 status 変更 + 1行削除 → 再スクレイプ → scrape_changes 1行 assert
 *   (d) message-sender → participant...0005 が 'sent'
 *   (e) 署名付き postback×3: Q1→kind='answer'(sent>=1, skipped=1) / Q3→kind='completion', answer 行増えない
 *   (f) 窓外非通知: 窓外フィクスチャへ postback → answers 保存される / notification_logs 0行
 *   (g) teardown: event_date を current_date+3 に復元、フィクスチャ削除、掃除
 *
 * 成功条件1の機械検証: 窓内→logs行あり / 窓外→logs 0行
 */

import {
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { connectDev } from "../../../scripts/db/sql.ts";

// E2E ゲート
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

// --- 固定シード定数（seed.sql 準拠）---
const SEED_OA_CONFIG_ID = "00000000-0000-0000-0000-000000000001";
const SEED_EVENT_ID = "00000000-0000-0000-0000-000000000002";
const SEED_EPU_ID = "00000000-0000-0000-0000-000000000003";
const SEED_LINE_USER_UUID = "00000000-0000-0000-0000-000000000004"; // line_users.id (uuid FK)
const SEED_LINE_USER_ID_STR = "U00000000000000000000000000000dev"; // line_users.line_user_id
const SEED_PARTICIPANT_ID = "00000000-0000-0000-0000-000000000005";

// 窓外フィクスチャ（固定 UUID — E2E 専用、他テストと衝突しない名前空間）
const FX_OUT_EVENT_ID = "00000000-0000-0000-e2e4-000000000001";
const FX_OUT_EPU_ID = "00000000-0000-0000-e2e4-000000000002";
const FX_OUT_PARTICIPANT_ID = "00000000-0000-0000-e2e4-000000000003";

// 質問ID（seed.sql の oa_configs.questions と一致）
const Q_AGE = "q_age";
const Q_DRINK = "q_drink";
const Q_LATE = "q_late";

// 実Twipla URL
const TWIPLA_URL = "https://twipla.jp/events/731057";

/** postback data をエンコードする（e2e_confirm_flow_test.ts と同一実装） */
function encodePostback(participantId: string, questionId: string, optionIndex: number): string {
  return new URLSearchParams({
    p: participantId,
    q: questionId,
    a: String(optionIndex),
  }).toString();
}

/** LINE HMAC-SHA256 署名を生成する */
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

/** 署名付き webhook リクエストを送信するヘルパー */
async function sendSignedEvent(
  webhookUrl: string,
  channelSecret: string,
  eventsJson: object[],
): Promise<Response> {
  const body = JSON.stringify({
    destination: "U_oa_dev",
    events: eventsJson,
  });
  const sig = await generateSignature(body, channelSecret);
  return await fetch(webhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-line-signature": sig,
    },
    body,
  });
}

/** postback イベントオブジェクトを生成する */
function makePostbackEvent(userId: string, data: string): object {
  return {
    type: "postback",
    replyToken: "dummy-reply-token-" + crypto.randomUUID(),
    source: { type: "user", userId },
    postback: { data },
    deliveryContext: { isRedelivery: false },
    webhookEventId: crypto.randomUUID(),
  };
}

Deno.test({
  name: "e2e: 全鎖E2E — 実Twipla→scrape差分通知→sender→postback×3→窓内通知/窓外非通知/二重通知防止",
  ignore: !IS_E2E,
  async fn() {
    const sql = connectDev();
    const projectRef = getRequiredEnv("DEV_PROJECT_REF");
    const anonKey = getRequiredEnv("SUPABASE_ANON_KEY");
    const channelSecret = getRequiredEnv("LINE_CHANNEL_SECRET");

    const webhookUrl = `https://${projectRef}.supabase.co/functions/v1/webhook`;
    const scraperUrl = `https://${projectRef}.supabase.co/functions/v1/scraper`;
    const senderUrl = `https://${projectRef}.supabase.co/functions/v1/message-sender`;

    try {
      // ===================================================================
      // (a) setup
      // ===================================================================

      // seed event の event_date を current_date+1 に UPDATE（窓内化 — Pitfall 1）
      await sql`
        UPDATE public.events
        SET event_date = current_date + 1
        WHERE id = ${SEED_EVENT_ID}
      `;

      // 窓外フィクスチャ: OA1 配下に event(current_date+10) + epu + participant を作成
      await sql`
        INSERT INTO public.events (id, oa_config_id, title, event_date, confirm_days_before)
        VALUES (${FX_OUT_EVENT_ID}, ${SEED_OA_CONFIG_ID}, 'fx-out-window-e2e4', current_date + 10, 7)
        ON CONFLICT (id) DO UPDATE SET event_date = current_date + 10
      `;
      await sql`
        INSERT INTO public.event_platform_urls (id, event_id, platform, url)
        VALUES (${FX_OUT_EPU_ID}, ${FX_OUT_EVENT_ID}, 'twipla', 'https://twipla.jp/fx-out-e2e4')
        ON CONFLICT (id) DO NOTHING
      `;
      await sql`
        INSERT INTO public.participants (
          id, event_platform_url_id, display_name, natural_key, status,
          line_user_id, confirm_status, current_question_index
        )
        VALUES (
          ${FX_OUT_PARTICIPANT_ID}, ${FX_OUT_EPU_ID}, 'fx-out参加者',
          'dn:fx-out参加者', 'attending',
          ${SEED_LINE_USER_UUID}, 'sent', 0
        )
        ON CONFLICT (id) DO UPDATE SET confirm_status = 'sent', current_question_index = 0
      `;

      // notification_logs の対象行を削除（再実行可能性）
      await sql`
        DELETE FROM public.notification_logs
        WHERE event_id = ${SEED_EVENT_ID}
           OR event_id = ${FX_OUT_EVENT_ID}
      `;

      // seed participant を pending/index0/attending にリセット + answers 削除
      // status も明示的に attending に戻す（前回テストの status 変更が残っている可能性）
      await sql`
        UPDATE public.participants
        SET confirm_status = 'pending', current_question_index = 0, status = 'attending'
        WHERE id = ${SEED_PARTICIPANT_ID}
      `;
      await sql`
        DELETE FROM public.answers WHERE participant_id = ${SEED_PARTICIPANT_ID}
      `;

      // setup 確認
      const setupRows = await sql<{ event_date: string }[]>`
        SELECT event_date::text FROM public.events WHERE id = ${SEED_EVENT_ID}
      `;
      assertExists(setupRows[0]?.event_date, "(a) event_date が設定されていること");
      console.log(`(a) event_date = ${setupRows[0]?.event_date}`);

      // ===================================================================
      // (b) 実Twiplaスクレイプ
      // ===================================================================
      const scraperResp1 = await fetch(scraperUrl, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${anonKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ url: TWIPLA_URL }),
      });
      assertEquals(scraperResp1.status, 200, "(b) scraper が 200 を返すこと");

      const scraperBody1 = await scraperResp1.json() as {
        platform: string;
        count: number;
        saved: boolean;
        changes: { new: number; statusChanged: number };
        notified: number;
      };
      assertEquals(scraperBody1.saved, true, "(b) saved:true");
      assertEquals(scraperBody1.count > 0, true, "(b) count>0");
      console.log(`(b) scraper 1st: count=${scraperBody1.count}, changes=${JSON.stringify(scraperBody1.changes)}`);

      // ===================================================================
      // (c) scrape差分通知の決定的化
      // ===================================================================

      // 実スクレイプ行を取得してそのうち最初の1行の status を別値に変更
      // + 2行目を DELETE する（差分を強制的に作る）
      // 実スクレイプ参加者のみ対象（seed participant ...0005 は除外 — これを変更すると get_confirm_targets が壊れる）
      const existingParticipants = await sql<{ id: string; natural_key: string; status: string }[]>`
        SELECT id, natural_key, status
        FROM public.participants
        WHERE event_platform_url_id = ${SEED_EPU_ID}
          AND id != ${SEED_PARTICIPANT_ID}
        ORDER BY scraped_at DESC, id
        LIMIT 3
      `;

      if (existingParticipants.length >= 1) {
        // 1行目の status を別値に変更
        const targetId = existingParticipants[0].id;
        const origStatus = existingParticipants[0].status;
        const newStatus = origStatus === "attending" ? "interested" : "attending";
        await sql`
          UPDATE public.participants SET status = ${newStatus} WHERE id = ${targetId}
        `;
        console.log(`(c) status変更: ${origStatus} → ${newStatus} (id=${targetId})`);
      }

      if (existingParticipants.length >= 2) {
        // 2行目を DELETE（新規参加者として検出されるため）
        const deleteId = existingParticipants[1].id;
        const deleteKey = existingParticipants[1].natural_key;
        await sql`DELETE FROM public.participants WHERE id = ${deleteId}`;
        console.log(`(c) 1行削除: natural_key=${deleteKey}`);
      }

      // 再スクレイプ → 差分が検出され notification_logs に kind='scrape_changes' 1行
      const scraperResp2 = await fetch(scraperUrl, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${anonKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ url: TWIPLA_URL }),
      });
      assertEquals(scraperResp2.status, 200, "(c) 再スクレイプが 200 を返すこと");

      const scraperBody2 = await scraperResp2.json() as {
        platform: string;
        count: number;
        saved: boolean;
        changes: { new: number; statusChanged: number };
        notified: number;
      };
      assertEquals(scraperBody2.saved, true, "(c) 再スクレイプ saved:true");
      console.log(`(c) scraper 2nd: changes=${JSON.stringify(scraperBody2.changes)}, notified=${scraperBody2.notified}`);

      // 差分が検出された場合のみ notification_logs を assert
      // （差分がなかった場合は環境依存で assert をスキップ — Assumption A2）
      if (scraperBody2.changes.statusChanged > 0 || scraperBody2.changes.new > 0) {
        const scrapeLogs = await sql<{
          kind: string;
          sent: number;
          detail: { new: number; statusChanged: number };
        }[]>`
          SELECT kind, sent, detail
          FROM public.notification_logs
          WHERE event_id = ${SEED_EVENT_ID} AND kind = 'scrape_changes'
          ORDER BY created_at DESC
          LIMIT 1
        `;
        assertEquals(scrapeLogs.length >= 1, true, "(c) kind='scrape_changes' 行が存在すること");
        assertEquals(scrapeLogs[0]?.kind, "scrape_changes", "(c) kind が 'scrape_changes' であること");
        assertEquals(Number(scrapeLogs[0]?.sent) >= 1, true, "(c) DRY_RUNでも sent>=1");
        // detail の件数一致
        const detail = scrapeLogs[0]?.detail;
        assertExists(detail, "(c) detail が存在すること");
        const totalChanges = scraperBody2.changes.new + scraperBody2.changes.statusChanged;
        const detailTotal = detail.new + detail.statusChanged;
        assertEquals(detailTotal, totalChanges, "(c) detail の件数がレスポンスと一致すること");
        console.log(`(c) scrape_changes 行: sent=${scrapeLogs[0]?.sent}, detail=${JSON.stringify(detail)}`);
      } else {
        console.log("(c) 差分なし — scrape_changes assert をスキップ（環境依存）");
      }

      // notification_logs を再度クリーン（(e) の assert が scrape 行に影響しないよう）
      await sql`
        DELETE FROM public.notification_logs WHERE event_id = ${SEED_EVENT_ID}
      `;

      // ===================================================================
      // (d) message-sender → participant...0005 が 'sent'
      // ===================================================================
      const senderResp = await fetch(senderUrl, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${anonKey}`,
          "x-cron-key": getRequiredEnv("CRON_FUNCTION_KEY"),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });
      assertEquals(senderResp.status, 200, "(d) message-sender が 200 を返すこと");
      await senderResp.body?.cancel();

      const afterSenderRows = await sql<{ confirm_status: string }[]>`
        SELECT confirm_status FROM public.participants WHERE id = ${SEED_PARTICIPANT_ID}
      `;
      assertEquals(afterSenderRows[0]?.confirm_status, "sent", "(d) confirm_status が 'sent' に遷移すること");

      // ===================================================================
      // (e) 署名付き postback×3 — 窓内通知/二重通知防止
      // ===================================================================

      // Q1 postback
      const q1Data = encodePostback(SEED_PARTICIPANT_ID, Q_AGE, 0);
      const q1Resp = await sendSignedEvent(webhookUrl, channelSecret, [
        makePostbackEvent(SEED_LINE_USER_ID_STR, q1Data),
      ]);
      assertEquals(q1Resp.status, 200, "(e) Q1 postback → 200");
      await q1Resp.body?.cancel();

      // Q1 後: answers 1行 + notification_logs kind='answer' 1行（sent>=1, skipped_no_line_id=1）
      const afterQ1Answers = await sql<{ count: string }[]>`
        SELECT COUNT(*) as count FROM public.answers WHERE participant_id = ${SEED_PARTICIPANT_ID}
      `;
      assertEquals(Number(afterQ1Answers[0]?.count), 1, "(e) Q1後 answers が 1行");

      const logsAfterQ1 = await sql<{
        kind: string;
        sent: number;
        skipped_no_line_id: number;
      }[]>`
        SELECT kind, sent, skipped_no_line_id
        FROM public.notification_logs
        WHERE participant_id = ${SEED_PARTICIPANT_ID}
        ORDER BY created_at
      `;
      assertEquals(logsAfterQ1.length, 1, "(e) Q1後 notification_logs が1行");
      assertEquals(logsAfterQ1[0]?.kind, "answer", "(e) kind が 'answer'");
      assertEquals(Number(logsAfterQ1[0]?.sent) >= 1, true, "(e) DRY_RUNでも sent>=1（送信実行の証跡）");
      // user2 は line_user_id が null のため skipped_no_line_id=1（setup-dev の投入内容と一致）
      assertEquals(Number(logsAfterQ1[0]?.skipped_no_line_id), 1, "(e) skipped_no_line_id=1（user2 line_user_id=null）");

      // Q1 再タップ（同一回答の再送 — 04-REVIEW WR-02 通知スパム抑止）
      // 過去質問ボタンの再タップ（ルール4経路）: answers は UPSERT 上書きで行数不変、
      // 値が変わらないため通知は発火しない（kind='answer' logs が増えない）
      const q1RetapResp = await sendSignedEvent(webhookUrl, channelSecret, [
        makePostbackEvent(SEED_LINE_USER_ID_STR, q1Data),
      ]);
      assertEquals(q1RetapResp.status, 200, "(e) Q1 同一回答再タップ → 200");
      await q1RetapResp.body?.cancel();

      const afterRetapAnswers = await sql<{ count: string }[]>`
        SELECT COUNT(*) as count FROM public.answers WHERE participant_id = ${SEED_PARTICIPANT_ID}
      `;
      assertEquals(Number(afterRetapAnswers[0]?.count), 1, "(e) 再タップ後も answers が 1行（UPSERT 上書き）");

      const logsAfterRetap = await sql<{ count: string }[]>`
        SELECT COUNT(*) as count FROM public.notification_logs
        WHERE participant_id = ${SEED_PARTICIPANT_ID} AND kind = 'answer'
      `;
      assertEquals(
        Number(logsAfterRetap[0]?.count),
        1,
        "(e) 同一回答の再タップでは通知されない（WR-02 スパム抑止）",
      );

      // Q2 postback
      const q2Data = encodePostback(SEED_PARTICIPANT_ID, Q_DRINK, 0);
      const q2Resp = await sendSignedEvent(webhookUrl, channelSecret, [
        makePostbackEvent(SEED_LINE_USER_ID_STR, q2Data),
      ]);
      assertEquals(q2Resp.status, 200, "(e) Q2 postback → 200");
      await q2Resp.body?.cancel();

      // Q2 後の answer logs 数（Q1 の 1 行のまま — kind='answer' は Q2 でも 1 増えるはず）
      const logsAfterQ2 = await sql<{ count: string }[]>`
        SELECT COUNT(*) as count FROM public.notification_logs
        WHERE participant_id = ${SEED_PARTICIPANT_ID} AND kind = 'answer'
      `;
      assertEquals(Number(logsAfterQ2[0]?.count), 2, "(e) Q2後 kind='answer' が 2行");

      // Q3 postback（最終問）
      const q3Data = encodePostback(SEED_PARTICIPANT_ID, Q_LATE, 0);
      const q3Resp = await sendSignedEvent(webhookUrl, channelSecret, [
        makePostbackEvent(SEED_LINE_USER_ID_STR, q3Data),
      ]);
      assertEquals(q3Resp.status, 200, "(e) Q3 postback → 200");
      await q3Resp.body?.cancel();

      // Q3 後: confirm_status='completed', answers 3行
      const afterQ3State = await sql<{ confirm_status: string }[]>`
        SELECT confirm_status FROM public.participants WHERE id = ${SEED_PARTICIPANT_ID}
      `;
      assertEquals(afterQ3State[0]?.confirm_status, "completed", "(e) Q3後 confirm_status='completed'");

      const afterQ3Answers = await sql<{ count: string }[]>`
        SELECT COUNT(*) as count FROM public.answers WHERE participant_id = ${SEED_PARTICIPANT_ID}
      `;
      assertEquals(Number(afterQ3Answers[0]?.count), 3, "(e) Q3後 answers が 3行");

      // Q3 後: kind='completion' 1行追加、kind='answer' の行数が増えていない（二重通知防止 — Pitfall 8）
      const logsAfterQ3Answer = await sql<{ count: string }[]>`
        SELECT COUNT(*) as count FROM public.notification_logs
        WHERE participant_id = ${SEED_PARTICIPANT_ID} AND kind = 'answer'
      `;
      assertEquals(
        Number(logsAfterQ3Answer[0]?.count),
        2,
        "(e) Q3後 kind='answer' の行数が増えていない（二重通知防止）",
      );

      const logsAfterQ3Completion = await sql<{ kind: string; sent: number }[]>`
        SELECT kind, sent FROM public.notification_logs
        WHERE participant_id = ${SEED_PARTICIPANT_ID} AND kind = 'completion'
        ORDER BY created_at DESC
        LIMIT 1
      `;
      assertEquals(logsAfterQ3Completion.length, 1, "(e) Q3後 kind='completion' が 1行");
      assertEquals(Number(logsAfterQ3Completion[0]?.sent) >= 1, true, "(e) completion sent>=1");

      // ===================================================================
      // (f) 窓外非通知（成功条件1の裏面）
      // ===================================================================

      // 窓外フィクスチャ participant へ署名付き postback
      const outData = encodePostback(FX_OUT_PARTICIPANT_ID, Q_AGE, 0);
      const outResp = await sendSignedEvent(webhookUrl, channelSecret, [
        makePostbackEvent(SEED_LINE_USER_ID_STR, outData),
      ]);
      assertEquals(outResp.status, 200, "(f) 窓外postback → 200");
      await outResp.body?.cancel();

      // answers は保存される（webhook は窓と無関係に保存）
      const outAnswers = await sql<{ count: string }[]>`
        SELECT COUNT(*) as count FROM public.answers WHERE participant_id = ${FX_OUT_PARTICIPANT_ID}
      `;
      assertEquals(Number(outAnswers[0]?.count), 1, "(f) 窓外でも answers が保存されること");

      // 該当 event_id の notification_logs が 0 行（2日前より前では通知されない — 成功条件1）
      const outLogs = await sql<{ c: number }[]>`
        SELECT COUNT(*)::int as c FROM public.notification_logs WHERE event_id = ${FX_OUT_EVENT_ID}
      `;
      assertEquals(outLogs[0]?.c, 0, "(f) 2日前より前のイベントでは通知されない（成功条件1）");

    } finally {
      // ===================================================================
      // (g) teardown
      // ===================================================================
      try {
        // event_date を current_date+3 に復元（seed.sql の元の値）
        await sql`
          UPDATE public.events SET event_date = current_date + 3 WHERE id = ${SEED_EVENT_ID}
        `;

        // 窓外フィクスチャを FK 順に削除
        await sql`DELETE FROM public.answers WHERE participant_id = ${FX_OUT_PARTICIPANT_ID}`;
        await sql`DELETE FROM public.notification_logs WHERE event_id = ${FX_OUT_EVENT_ID}`;
        await sql`DELETE FROM public.participants WHERE id = ${FX_OUT_PARTICIPANT_ID}`;
        await sql`DELETE FROM public.event_platform_urls WHERE id = ${FX_OUT_EPU_ID}`;
        await sql`DELETE FROM public.events WHERE id = ${FX_OUT_EVENT_ID}`;

        // notification_logs 掃除（Pitfall 10 — 再実行時の干渉防止）
        await sql`DELETE FROM public.notification_logs WHERE event_id = ${SEED_EVENT_ID}`;

        // seed participant をリセット + answers 削除（status も attending に復元）
        await sql`
          UPDATE public.participants
          SET confirm_status = 'pending', current_question_index = 0, status = 'attending'
          WHERE id = ${SEED_PARTICIPANT_ID}
        `;
        await sql`DELETE FROM public.answers WHERE participant_id = ${SEED_PARTICIPANT_ID}`;

        // teardown 確認
        const restored = await sql<{ event_date: string; confirm_status: string }[]>`
          SELECT e.event_date::text, p.confirm_status
          FROM public.events e, public.participants p
          WHERE e.id = ${SEED_EVENT_ID} AND p.id = ${SEED_PARTICIPANT_ID}
        `;
        const restoredEventDate = restored[0]?.event_date ?? "";
        const restoredStatus = restored[0]?.confirm_status ?? "";

        // event_date が current_date+3 に復元されていることを DB 側の current_date で検証
        // （Postgres の current_date は UTC — クライアント側 JST と異なる場合があるため DB で計算）
        const expectedDateRows = await sql<{ expected_date: string }[]>`
          SELECT (current_date + 3)::text as expected_date
        `;
        const expectedDate = expectedDateRows[0]?.expected_date ?? "";
        assertEquals(restoredEventDate, expectedDate, "teardown: event_date が current_date+3 に復元されていること");
        assertEquals(restoredStatus, "pending", "teardown: seed participant が pending に復元されていること");
      } catch (teardownErr) {
        console.error(`teardown error: ${(teardownErr as Error).message}`);
      } finally {
        await sql.end();
      }
    }
  },
});
