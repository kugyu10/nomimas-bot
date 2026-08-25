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
 *   3.5【強化】2回目のポーリング直前の DB スナップショットを記録する
 *      （notification_logs の今日の行数、対象 event_platform_url_id の
 *        participants の「natural_key と status の組」の集合・行数）
 *   4. 35秒待ってから（Twiplaへの配慮。最短30秒間隔）scraper をもう1回呼ぶ
 *      （Twiplaを叩く回数は増やさない。ここでも1回のみ）
 *   5. 2回目のレスポンスが changes:{new:0,statusChanged:0} かつ notified:0 であることを確認する
 *      → 変化がないときに誤検知で通知を撃たない証明（このスクリプトはLINE送信を発生させない）
 *   5.5【強化】2回目のポーリング直後、同じものを DB から SELECT して裏づける
 *      （レスポンスの自己申告だけを信じない — 独立した検証役の指摘反映）:
 *        - notification_logs の今日の行数が増えていないこと
 *          （変化ゼロなら通知は発生しないはず。増えていたら誤検知が起きている）
 *        - participants の「natural_key と status の組」の集合が3.5の記録と完全に一致すること
 *        - scraped_at が2回目のポーリング開始時刻以降に更新されていること
 *          （= 取得自体はちゃんと走っている。更新されていないなら upsert が働いていない）
 *
 * 使い方:
 *   set -a; source /Users/kugyu10/work/nomimas-bot/.env.local; set +a
 *   deno run --allow-net --allow-read --allow-env --config deno.json scripts/v11/check-live-poll.ts
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

/** participants の「natural_key と status の組」の集合を "natural_key::status" の Set にする */
function toNaturalKeyStatusSet(
  rows: { natural_key: string; status: string }[],
): Set<string> {
  return new Set(rows.map((r) => `${r.natural_key}::${r.status}`));
}

const sql = connectDev();

// 最終行のサマリ出力に使う（2回目を呼ばずに終わる場合は firstOnly のまま）
let firstResult: { status: number; body: ScraperResponse } | undefined;
let secondResult: { status: number; body: ScraperResponse } | undefined;
let attendingCount = 0;

// 3.5 / 5.5 の DB スナップショット比較に使う
let logsCountBefore = 0;
let logsCountAfter = 0;
let participantsBeforeSet: Set<string> = new Set();
let participantsAfterSet: Set<string> = new Set();
let participantsBeforeCount = 0;
let participantsAfterCount = 0;
let secondPollStartedAt: Date | undefined;
let dbBackedChecksRan = false;

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
    // (3.5) 2回目のポーリング直前のDBスナップショットを記録
    //   （2回目レスポンスの自己申告だけでなく、DB側でも「本当に差分ゼロだったか」
    //     「upsertが実際に走ったか」を裏づけるための基準点。独立した検証役の指摘反映）
    // -----------------------------------------------------------------------
    console.log(
      "[check-live-poll] (3.5) 2回目ポーリング直前のDBスナップショットを記録...",
    );
    // 対象を kind='scrape_changes' かつ**このイベント**に絞る。
    // 全 kind を数えると、同じPRで追加した confirm-broadcast-catchup cron
    // （JST日中の :15/:45 に発火）が約40秒のスナップショット窓に割り込んで
    // confirm_broadcast 行を挿入し、条件1が偽陽性で落ちる。
    // ここで測りたいのは「2回目のポーリングが誤検知の通知を撃たなかったこと」なので、
    // scraper が書く kind と当該イベントだけを見れば足りる。
    const [{ count: logsCountBeforeRaw }] = await sql<{ count: number }[]>`
      select count(*)::int as count
      from public.notification_logs
      where kind = 'scrape_changes'
        and event_id = ${eventId}::uuid
        and (created_at at time zone 'Asia/Tokyo')::date = (now() at time zone 'Asia/Tokyo')::date
    `;
    logsCountBefore = logsCountBeforeRaw;

    const beforeRows = await sql<
      { natural_key: string; status: string }[]
    >`
      select natural_key, status
      from public.participants
      where event_platform_url_id = ${epuId}
    `;
    participantsBeforeSet = toNaturalKeyStatusSet(beforeRows);
    participantsBeforeCount = beforeRows.length;
    console.log(
      `[check-live-poll]   直前スナップショット: notification_logs(今日)=${logsCountBefore}件 / ` +
        `participants(natural_key,status)組=${participantsBeforeCount}件`,
    );

    // -----------------------------------------------------------------------
    // (4) 35秒待つ（Twiplaへの配慮。最短30秒間隔）
    // -----------------------------------------------------------------------
    console.log("[check-live-poll] (4) 35秒待機...");
    await new Promise((r) => setTimeout(r, 35_000));

    // -----------------------------------------------------------------------
    // (5) 2回目の scraper 呼び出し → 差分ゼロ・notified 0 を確認
    // -----------------------------------------------------------------------
    console.log("[check-live-poll] (5) 2回目の scraper 呼び出し...");
    secondPollStartedAt = new Date();
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

    // -----------------------------------------------------------------------
    // (5.5) 2回目ポーリング直後、DBを SELECT して差分ゼロ・upsert実行を裏づける
    //   （レスポンスの自己申告だけを信じない）
    // -----------------------------------------------------------------------
    console.log(
      "[check-live-poll] (5.5) 2回目ポーリング直後のDBスナップショットをSELECTして裏づける...",
    );
    dbBackedChecksRan = true;

    const [{ count: logsCountAfterRaw }] = await sql<{ count: number }[]>`
      select count(*)::int as count
      from public.notification_logs
      where kind = 'scrape_changes'
        and event_id = ${eventId}::uuid
        and (created_at at time zone 'Asia/Tokyo')::date = (now() at time zone 'Asia/Tokyo')::date
    `;
    logsCountAfter = logsCountAfterRaw;
    console.log(
      `[check-live-poll]   notification_logs(今日/scrape_changes/当該イベント) 直前=${logsCountBefore}件 → 直後=${logsCountAfter}件`,
    );
    if (logsCountAfter !== logsCountBefore) {
      fail(
        `2回目ポーリング前後で notification_logs(今日/scrape_changes/当該イベント)の行数が変化しました（${logsCountBefore}→${logsCountAfter}）。` +
          "差分ゼロのはずなのに通知が発生した疑いがあります",
      );
    } else {
      ok(
        "notification_logs(今日/scrape_changes/当該イベント)の行数が変化していない（誤検知の通知は発生していない）",
      );
    }

    const afterRows = await sql<
      { natural_key: string; status: string; scraped_at: Date | null }[]
    >`
      select natural_key, status, scraped_at
      from public.participants
      where event_platform_url_id = ${epuId}
    `;
    participantsAfterSet = toNaturalKeyStatusSet(afterRows);
    participantsAfterCount = afterRows.length;
    console.log(
      `[check-live-poll]   participants(natural_key,status)組 直前=${participantsBeforeCount}件 → 直後=${participantsAfterCount}件`,
    );

    if (participantsAfterCount !== participantsBeforeCount) {
      fail(
        `2回目ポーリング前後で participants の(natural_key,status)組の件数が変化しました` +
          `（${participantsBeforeCount}→${participantsAfterCount}）`,
      );
    } else {
      const missing = [...participantsBeforeSet].filter(
        (k) => !participantsAfterSet.has(k),
      );
      const added = [...participantsAfterSet].filter(
        (k) => !participantsBeforeSet.has(k),
      );
      if (missing.length > 0 || added.length > 0) {
        fail(
          "2回目ポーリング前後で participants の(natural_key,status)組の内容が一致しません" +
            `（消えた: ${missing.length}件 / 増えた: ${added.length}件）`,
        );
      } else {
        ok(
          "participants の(natural_key,status)組の集合が完全に一致（DB側でも誤検知なしを裏づけ）",
        );
      }
    }

    if (afterRows.length === 0) {
      fail(
        "2回目ポーリング後の participants が0件です（scraped_at更新の比較対象が無い）",
      );
    } else {
      const startedAt = secondPollStartedAt;

      // scraper は**今回のスクレイプに存在した行しか upsert しない**（行の削除もしない）。
      // Twipla ページから参加者が1名抜けると、その行は残ったまま scraped_at が古くなる。
      // 「全行の scraped_at が更新されていること」を要求すると、離脱者が出た時点から
      // 以後すべての実行で恒常的に落ちる（しかも「upsertが働いていない疑い」という
      // 誤誘導のメッセージが出る）。
      // 測りたいのは「今回のスクレイプで取れた分がちゃんと書かれたか」なので、
      // **更新された行数が scraper 応答の count と一致するか**で判定する。
      const freshRows = afterRows.filter(
        (r) => r.scraped_at && r.scraped_at.getTime() >= startedAt.getTime(),
      );
      const staleRows = afterRows.filter(
        (r) => !r.scraped_at || r.scraped_at.getTime() < startedAt.getTime(),
      );
      const expectedFresh = secondResult?.body.count ?? 0;

      if (staleRows.length > 0) {
        console.log(
          `[check-live-poll]   注: scraped_at が古いままの行が ${staleRows.length} 件` +
            `（ページから離脱した参加者の行。scraper は削除しない仕様なので異常ではない）`,
        );
      }

      if (freshRows.length !== expectedFresh) {
        fail(
          `2回目のポーリングで scraped_at が更新された行が ${freshRows.length} 件で、` +
            `scraper 応答の count=${expectedFresh} と一致しません` +
            `（upsertが働いていない疑い。2回目呼び出し開始=${startedAt.toISOString()}）`,
        );
      } else {
        ok(
          `2回目のポーリングで scraped_at が更新された行が ${freshRows.length} 件 = 応答の count と一致` +
            `（取得自体がちゃんと走っている証拠。据え置き ${staleRows.length} 件は離脱者の行）`,
        );
      }
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
        `participants ${attendingCount}件 / ` +
        `DB裏づけ=${
          dbBackedChecksRan
            ? `notification_logs(${logsCountBefore}→${logsCountAfter}) participants組(${participantsBeforeCount}→${participantsAfterCount}) scraped_at更新確認済み`
            : "未実施"
        }`,
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
