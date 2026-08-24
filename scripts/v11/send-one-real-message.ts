/**
 * ############################################################################
 * # 警告: このスクリプトは実際に LINE メッセージを送る。1回だけ実行すること。 #
 * # 送信先は dev OA (`飲みmasDev`) の oa_members に紐付いた本人のみ。         #
 * # このファイルを書いたエージェント自身はこれを実行しない（オーケストレー   #
 * # ターが適切なタイミングで1回だけ走らせる）。                             #
 * ############################################################################
 *
 * scripts/v11/send-one-real-message.ts
 * 本人宛てに実 LINE メッセージを1通だけ発生させるための一度きりのスクリプト。
 *
 * やること:
 *   1. 多重送信防止: notification_logs に今日(JST)の sent>=1 の行が既にあれば、
 *      何もせず「既に送信済み」と出力して exit 0
 *   2. 安全弁: 対象 OA の oa_members のうち line_user_id が非null（=紐付け済み）
 *      な行数を数える。1件以外（0件 or 2件以上）なら、何も変更せず
 *      exit 1（本人以外に送らないためのガード）
 *   3. 対象 event（seed-dev-event.ts が作った行）の participants から
 *      status='attending' の1行を選び、status を 'declined' に UPDATE する
 *      （dev のみ。「実サイトでは attending なのに DB では declined」を作る）
 *   4. scraper を1回呼ぶ。実 Twipla は attending を返すため
 *      declined→attending の statusChange が検出され、notifyScrapeChanges が
 *      紐付け済み1名（本人）に push する
 *   5. レスポンスの notified が 1 であることを確認する
 *   6. notification_logs を SELECT し、kind='scrape_changes' で sent=1 の行が
 *      増えたことを確認して出力する
 *   7. 想定と違ったら（notified が 0 や 2以上など）理由を出して exit 1
 *
 * 使い方（実行する担当者向け）:
 *   set -a; source /Users/kugyu10/work/nomimas-bot/.env.local; set +a
 *   deno run --allow-net --allow-read --allow-env scripts/v11/send-one-real-message.ts
 */

import { connectDev } from "../db/sql.ts";
import { TARGET_URL } from "./lib.ts";

interface ScraperResponse {
  platform?: string;
  count?: number;
  saved?: boolean;
  changes?: { new: number; statusChanged: number };
  notified?: number;
  error?: string;
}

const failures: string[] = [];

function fail(msg: string) {
  failures.push(msg);
  console.error(`[send-one-real-message] [FAIL] ${msg}`);
}

function ok(msg: string) {
  console.log(`[send-one-real-message] [OK] ${msg}`);
}

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

if (!supabaseUrl) {
  console.error(
    "[send-one-real-message] ABORT: SUPABASE_URL が設定されていません",
  );
  Deno.exit(1);
}
if (!serviceRoleKey) {
  console.error(
    "[send-one-real-message] ABORT: SUPABASE_SERVICE_ROLE_KEY が設定されていません",
  );
  Deno.exit(1);
}

async function callScraper(): Promise<
  { status: number; body: ScraperResponse }
> {
  const res = await fetch(`${supabaseUrl}/functions/v1/scraper`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${serviceRoleKey}`,
    },
    body: JSON.stringify({ url: TARGET_URL }),
    signal: AbortSignal.timeout(45_000),
  });
  const body = (await res.json().catch(() => ({}))) as ScraperResponse;
  return { status: res.status, body };
}

const sql = connectDev();

try {
  // -------------------------------------------------------------------------
  // (1) 多重送信防止: 今日(JST)に sent>=1 の notification_logs 行が既にあるか
  // -------------------------------------------------------------------------
  console.log(
    "[send-one-real-message] (1) 多重送信防止チェック（今日(JST)の sent>=1）...",
  );
  const alreadySent = await sql<{ id: string }[]>`
    select id
    from public.notification_logs
    where sent >= 1
      and (created_at at time zone 'Asia/Tokyo')::date = (now() at time zone 'Asia/Tokyo')::date
  `;
  if (alreadySent.length > 0) {
    console.log(
      `[send-one-real-message] 既に送信済み（今日(JST)の sent>=1 が ${alreadySent.length} 件あります）。` +
        "何もせず終了します。",
    );
    Deno.exit(0);
  }
  ok("今日(JST)の sent>=1 行はまだ無い（多重送信の心配なし）");

  // -------------------------------------------------------------------------
  // (2) 対象 event / event_platform_url を解決
  // -------------------------------------------------------------------------
  console.log("[send-one-real-message] (2) 対象 event_platform_url を解決...");
  const epuRows = await sql<
    { id: string; event_id: string; oa_config_id: string }[]
  >`
    select epu.id, epu.event_id, e.oa_config_id
    from public.event_platform_urls epu
    join public.events e on e.id = epu.event_id
    where epu.url = ${TARGET_URL}
  `;
  if (epuRows.length === 0) {
    console.error(
      "[send-one-real-message] ABORT: event_platform_urls に url が見つかりません。" +
        "先に scripts/v11/seed-dev-event.ts を実行してください。",
    );
    Deno.exit(1);
  }
  const epuId = epuRows[0].id;
  const oaConfigId = epuRows[0].oa_config_id;
  console.log(
    `[send-one-real-message]   event_platform_url_id=${epuId} oa_config_id=${oaConfigId}`,
  );

  // -------------------------------------------------------------------------
  // (3) 安全弁: 紐付け済み受信者(line_user_id 非null)がちょうど1名であること
  //     （2名以上なら本人以外に送ってしまう危険があるため送信せず exit 1）
  // -------------------------------------------------------------------------
  console.log("[send-one-real-message] (3) 受信者数の安全弁チェック...");
  const recipientRows = await sql<{ count: string }[]>`
    select count(*) as count
    from public.oa_members
    where oa_config_id = ${oaConfigId} and line_user_id is not null
  `;
  const recipientCount = Number(recipientRows[0]?.count ?? "0");
  console.log(`[send-one-real-message]   紐付け済み受信者数=${recipientCount}`);

  if (recipientCount !== 1) {
    fail(
      `紐付け済み受信者数が1名ではありません（${recipientCount}名）。` +
        "本人以外に送信する危険があるため、送信せずに終了します。",
    );
    printResultAndExit();
  }
  ok("紐付け済み受信者数=1（本人のみ）");

  // -------------------------------------------------------------------------
  // (4) participants から status='attending' の1行を選び 'declined' に UPDATE
  // -------------------------------------------------------------------------
  console.log(
    "[send-one-real-message] (4) attending行を1件選び declined に UPDATE...",
  );
  const target = await sql<{ id: string; natural_key: string }[]>`
    select id, natural_key
    from public.participants
    where event_platform_url_id = ${epuId} and status = 'attending'
    limit 1
  `;
  if (target.length === 0) {
    fail(
      "participants に status='attending' の行がありません。" +
        "先に scripts/v11/check-live-poll.ts を実行して初回スクレイプを済ませてください。",
    );
    printResultAndExit();
  }
  const participantId = target[0].id;

  await sql`
    update public.participants
    set status = 'declined'
    where id = ${participantId}
  `;
  ok(
    `participant id=${participantId} の status を declined に更新（実サイトはattendingのまま）`,
  );

  // -------------------------------------------------------------------------
  // (5) scraper を1回呼ぶ → declined→attending の statusChange 検出を期待
  // -------------------------------------------------------------------------
  console.log("[send-one-real-message] (5) scraper 呼び出し...");
  const result = await callScraper();
  console.log(
    `[send-one-real-message]   status=${result.status} body=${
      JSON.stringify(result.body)
    }`,
  );

  if (result.status !== 200) {
    fail(`HTTPステータスが200ではありません: ${result.status}`);
  }
  if (result.body.notified !== 1) {
    fail(
      `notified が 1 ではありません: ${
        JSON.stringify(result.body.notified)
      }（0=通知未発火、2以上=想定外の複数送信）`,
    );
  } else {
    ok("notified === 1（本人1名に通知）");
  }

  // -------------------------------------------------------------------------
  // (6) notification_logs を再確認
  // -------------------------------------------------------------------------
  console.log("[send-one-real-message] (6) notification_logs を再確認...");
  const logRows = await sql<
    {
      id: string;
      kind: string;
      recipients: number;
      sent: number;
      failed: number;
      created_at: Date;
    }[]
  >`
    select id, kind, recipients, sent, failed, created_at
    from public.notification_logs
    where kind = 'scrape_changes' and sent = 1
    order by created_at desc
    limit 1
  `;
  if (logRows.length === 0) {
    fail(
      "notification_logs に kind='scrape_changes' かつ sent=1 の行が見つかりません",
    );
  } else {
    const log = logRows[0];
    ok(
      `notification_logs 確認: id=${log.id} kind=${log.kind} recipients=${log.recipients} ` +
        `sent=${log.sent} failed=${log.failed} created_at=${
          log.created_at?.toISOString?.() ?? log.created_at
        }`,
    );
  }

  printResultAndExit();

  function printResultAndExit(): never {
    console.log("\n" + "=".repeat(60));
    if (failures.length === 0) {
      console.log(
        "send-one-real-message OK: 本人へ実LINE通知を1件発生させ、notification_logsで確認済み",
      );
      Deno.exit(0);
    } else {
      console.error(
        `send-one-real-message NG: 以下の理由で不合格 — ${
          failures.join(" / ")
        }`,
      );
      Deno.exit(1);
    }
  }
} catch (err) {
  console.error("[send-one-real-message] 予期しないエラー:", err);
  Deno.exit(1);
} finally {
  await sql.end();
}
