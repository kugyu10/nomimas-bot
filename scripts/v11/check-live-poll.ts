/**
 * scripts/v11/check-live-poll.ts
 * 合格条件1の機械判定: 「実 Twipla イベントを2回連続でポーリングして
 * 1回目で保存でき、2回目は差分ゼロ（誤検知しない）」ことを検証する。
 *
 * 手順:
 *   1. seed-dev-event.ts と同じ方法で対象 event / url (event_platform_urls) を解決する
 *      （無ければ非ゼロ終了。先に seed-dev-event.ts を実行するよう案内する）
 *   2. scraper Edge Function を1回呼ぶ（実 Twipla を fetch）
 *      → saved===true, count>=1 を確認
 *   3. DB を SELECT して participants に実際に行が入っていることを確認する
 *      （event_platform_url_id で絞り、status='attending' が1件以上、
 *        screen_name が非null、scraped_at が現在時刻に近いこと）
 *      → レスポンスの自己申告だけを信じない
 *   4. 35秒待ってから（Twiplaへの配慮。最短30秒間隔）scraper をもう1回呼ぶ
 *   5. 2回目のレスポンスが changes:{new:0,statusChanged:0} かつ notified:0 であることを確認する
 *      → 変化がないときに誤検知で通知を撃たない証明（このスクリプトはLINE送信を発生させない）
 *
 * 使い方:
 *   set -a; source /Users/kugyu10/work/nomimas-bot/.env.local; set +a
 *   deno run --allow-net --allow-read --allow-env scripts/v11/check-live-poll.ts
 *
 * すべて満たせば exit 0。1つでも欠ければ理由を出力して exit 1。
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
  console.error(`[check-live-poll] [FAIL] ${msg}`);
}

function ok(msg: string) {
  console.log(`[check-live-poll] [OK] ${msg}`);
}

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

if (!supabaseUrl) {
  console.error("[check-live-poll] ABORT: SUPABASE_URL が設定されていません");
  Deno.exit(1);
}
if (!serviceRoleKey) {
  console.error(
    "[check-live-poll] ABORT: SUPABASE_SERVICE_ROLE_KEY が設定されていません",
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

// 最終行のサマリ出力に使う（2回目を呼ばずに終わる場合は firstOnly のまま）
let firstResult: { status: number; body: ScraperResponse } | undefined;
let secondResult: { status: number; body: ScraperResponse } | undefined;
let attendingCount = 0;

try {
  // -------------------------------------------------------------------------
  // (1) 対象 event_platform_url を解決
  // -------------------------------------------------------------------------
  console.log("[check-live-poll] (1) 対象 event_platform_url を解決...");
  const epuRows = await sql<{ id: string; event_id: string }[]>`
    select id, event_id from public.event_platform_urls where url = ${TARGET_URL}
  `;
  if (epuRows.length === 0) {
    console.error(
      "[check-live-poll] ABORT: event_platform_urls に url が見つかりません。" +
        "先に scripts/v11/seed-dev-event.ts を実行してください。",
    );
    Deno.exit(1);
  }
  const epuId = epuRows[0].id;
  const eventId = epuRows[0].event_id;
  console.log(
    `[check-live-poll]   event_id=${eventId} event_platform_url_id=${epuId}`,
  );

  // -------------------------------------------------------------------------
  // (2) 1回目の scraper 呼び出し
  // -------------------------------------------------------------------------
  console.log("[check-live-poll] (2) 1回目の scraper 呼び出し...");
  firstResult = await callScraper();
  console.log(
    `[check-live-poll]   status=${firstResult.status} body=${
      JSON.stringify(firstResult.body)
    }`,
  );

  if (firstResult.status !== 200) {
    fail(`1回目のHTTPステータスが200ではありません: ${firstResult.status}`);
  }
  if (firstResult.body.saved !== true) {
    fail(
      `1回目の saved が true ではありません: ${
        JSON.stringify(firstResult.body.saved)
      }`,
    );
  } else {
    ok("1回目 saved === true");
  }
  if (
    !(typeof firstResult.body.count === "number" && firstResult.body.count >= 1)
  ) {
    fail(
      `1回目の count が1以上ではありません: ${
        JSON.stringify(firstResult.body.count)
      }`,
    );
  } else {
    ok(`1回目 count=${firstResult.body.count}`);
  }

  // -------------------------------------------------------------------------
  // (3) DB を SELECT して participants に実際に行が入っていることを確認
  //     （レスポンスの自己申告だけを信じない）
  // -------------------------------------------------------------------------
  console.log(
    "[check-live-poll] (3) participants を SELECT して実データを確認...",
  );
  const attendingRows = await sql<
    { screen_name: string | null; scraped_at: Date | null }[]
  >`
    select screen_name, scraped_at
    from public.participants
    where event_platform_url_id = ${epuId} and status = 'attending'
  `;
  attendingCount = attendingRows.length;
  console.log(`[check-live-poll]   attending行数=${attendingCount}`);

  if (attendingCount === 0) {
    fail("participants に status='attending' の行が1件もありません");
  } else {
    ok(`participants attending行数=${attendingCount}`);

    const now = Date.now();
    const RECENT_THRESHOLD_MS = 5 * 60 * 1000; // 5分以内なら「現在時刻近く」とみなす
    for (const row of attendingRows) {
      if (!row.screen_name) {
        fail(
          "attending行の screen_name が null です（natural_key照合に問題がある可能性）",
        );
      }
      if (!row.scraped_at) {
        fail("attending行の scraped_at が null です");
      } else {
        const ageMs = now - row.scraped_at.getTime();
        if (ageMs < 0 || ageMs > RECENT_THRESHOLD_MS) {
          fail(
            `attending行の scraped_at が現在時刻から離れすぎています（${
              Math.round(ageMs / 1000)
            }秒前）`,
          );
        } else {
          ok(`scraped_at が現在時刻に近い（${Math.round(ageMs / 1000)}秒前）`);
        }
      }
    }
  }

  if (failures.length > 0) {
    console.error(
      "\n[check-live-poll] 1回目の検証で失敗があったため、2回目の呼び出しをスキップします。",
    );
  } else {
    // -----------------------------------------------------------------------
    // (4) 35秒待つ（Twiplaへの配慮。最短30秒間隔）
    // -----------------------------------------------------------------------
    console.log("[check-live-poll] (4) 35秒待機...");
    await new Promise((r) => setTimeout(r, 35_000));

    // -----------------------------------------------------------------------
    // (5) 2回目の scraper 呼び出し → 差分ゼロ・notified 0 を確認
    // -----------------------------------------------------------------------
    console.log("[check-live-poll] (5) 2回目の scraper 呼び出し...");
    secondResult = await callScraper();
    console.log(
      `[check-live-poll]   status=${secondResult.status} body=${
        JSON.stringify(secondResult.body)
      }`,
    );

    if (secondResult.status !== 200) {
      fail(`2回目のHTTPステータスが200ではありません: ${secondResult.status}`);
    }
    if (secondResult.body.saved !== true) {
      fail(
        `2回目の saved が true ではありません: ${
          JSON.stringify(secondResult.body.saved)
        }`,
      );
    } else {
      ok("2回目 saved === true");
    }
    const changes = secondResult.body.changes;
    if (!changes || changes.new !== 0 || changes.statusChanged !== 0) {
      fail(
        `2回目の changes が {new:0, statusChanged:0} ではありません: ${
          JSON.stringify(changes)
        }`,
      );
    } else {
      ok("2回目 changes={new:0, statusChanged:0}（誤検知なし）");
    }
    if (secondResult.body.notified !== 0) {
      fail(
        `2回目の notified が 0 ではありません（意図せぬ通知の疑い）: ${
          JSON.stringify(secondResult.body.notified)
        }`,
      );
    } else {
      ok("2回目 notified=0（LINE送信は発生していない）");
    }
  }

  // ---------------------------------------------------------------------------
  // 結果出力
  // ---------------------------------------------------------------------------
  console.log("\n" + "=".repeat(60));
  if (failures.length === 0) {
    console.log(
      `条件1 OK: 1回目 saved=${firstResult.body.saved} count=${firstResult.body.count} / ` +
        `2回目 changes=${
          JSON.stringify(secondResult?.body?.changes ?? {})
        } notified=${secondResult?.body?.notified ?? "?"} / ` +
        `participants ${attendingCount}件`,
    );
    Deno.exit(0);
  } else {
    console.error(`条件1 NG: 以下の理由で不合格 — ${failures.join(" / ")}`);
    Deno.exit(1);
  }
} catch (err) {
  console.error("[check-live-poll] 予期しないエラー:", err);
  Deno.exit(1);
} finally {
  await sql.end();
}
