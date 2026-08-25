// _shared/notify/broadcast_log.ts — message-sender 配信結果の集計・行組み立て純関数 Unit Test
// 実行: deno test --config supabase/functions/deno.json --allow-all supabase/functions/tests/broadcast_log_test.ts

import { assertEquals } from "jsr:@std/assert";
import {
  aggregateConfirmBroadcastResults,
  buildConfirmBroadcastLogRows,
  shouldLogConfirmBroadcast,
  type ConfirmBroadcastTargetResult,
} from "../_shared/notify/broadcast_log.ts";

const EVENT_A = "11111111-1111-1111-1111-111111111111";
const EVENT_B = "22222222-2222-2222-2222-222222222222";
const OA_1 = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const OA_2 = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

// ==================== shouldLogConfirmBroadcast ====================

Deno.test("shouldLogConfirmBroadcast: 対象0件 → false（行を書かない）", () => {
  assertEquals(shouldLogConfirmBroadcast(0), false);
});

Deno.test("shouldLogConfirmBroadcast: 対象1件以上 → true", () => {
  assertEquals(shouldLogConfirmBroadcast(1), true);
  assertEquals(shouldLogConfirmBroadcast(5), true);
});

// ==================== aggregateConfirmBroadcastResults ====================

Deno.test("aggregateConfirmBroadcastResults: 全員成功 → sent = 対象数, failed = 0", () => {
  const results: ConfirmBroadcastTargetResult[] = [
    { eventId: EVENT_A, oaConfigId: OA_1, success: true },
    { eventId: EVENT_A, oaConfigId: OA_1, success: true },
    { eventId: EVENT_A, oaConfigId: OA_1, success: true },
  ];
  const aggregates = aggregateConfirmBroadcastResults(results);
  assertEquals(aggregates.length, 1);
  assertEquals(aggregates[0].recipients, 3);
  assertEquals(aggregates[0].sent, 3);
  assertEquals(aggregates[0].failed, 0);
});

Deno.test("aggregateConfirmBroadcastResults: 一部失敗 → sent + failed = 対象数", () => {
  const results: ConfirmBroadcastTargetResult[] = [
    { eventId: EVENT_A, oaConfigId: OA_1, success: true },
    { eventId: EVENT_A, oaConfigId: OA_1, success: false },
    { eventId: EVENT_A, oaConfigId: OA_1, success: true },
    { eventId: EVENT_A, oaConfigId: OA_1, success: false },
  ];
  const aggregates = aggregateConfirmBroadcastResults(results);
  assertEquals(aggregates.length, 1);
  assertEquals(aggregates[0].recipients, 4);
  assertEquals(aggregates[0].sent, 2);
  assertEquals(aggregates[0].failed, 2);
  assertEquals(aggregates[0].sent + aggregates[0].failed, aggregates[0].recipients);
});

Deno.test("aggregateConfirmBroadcastResults: 対象0件 → 空配列（すべて0）", () => {
  const aggregates = aggregateConfirmBroadcastResults([]);
  assertEquals(aggregates, []);
});

Deno.test("aggregateConfirmBroadcastResults: 複数イベント混在 → イベントごとに分かれて集計される", () => {
  const results: ConfirmBroadcastTargetResult[] = [
    { eventId: EVENT_A, oaConfigId: OA_1, success: true },
    { eventId: EVENT_B, oaConfigId: OA_2, success: false },
    { eventId: EVENT_A, oaConfigId: OA_1, success: false },
    { eventId: EVENT_B, oaConfigId: OA_2, success: true },
    { eventId: EVENT_B, oaConfigId: OA_2, success: true },
  ];
  const aggregates = aggregateConfirmBroadcastResults(results);
  assertEquals(aggregates.length, 2);

  const a = aggregates.find((x) => x.eventId === EVENT_A);
  const b = aggregates.find((x) => x.eventId === EVENT_B);
  assertEquals(a, { eventId: EVENT_A, oaConfigId: OA_1, recipients: 2, sent: 1, failed: 1, skippedConcurrent: 0 });
  assertEquals(b, { eventId: EVENT_B, oaConfigId: OA_2, recipients: 3, sent: 2, failed: 1, skippedConcurrent: 0 });
});

// ==================== buildConfirmBroadcastLogRows ====================

Deno.test("buildConfirmBroadcastLogRows: 1イベントに skipped_no_line_id がそのまま乗る", () => {
  const aggregates = aggregateConfirmBroadcastResults([
    { eventId: EVENT_A, oaConfigId: OA_1, success: true },
    { eventId: EVENT_A, oaConfigId: OA_1, success: false },
  ]);
  const rows = buildConfirmBroadcastLogRows(aggregates, 3);
  assertEquals(rows.length, 1);
  assertEquals(rows[0].oa_config_id, OA_1);
  assertEquals(rows[0].event_id, EVENT_A);
  assertEquals(rows[0].kind, "confirm_broadcast");
  assertEquals(rows[0].participant_id, null);
  assertEquals(rows[0].recipients, 2);
  assertEquals(rows[0].sent, 1);
  assertEquals(rows[0].failed, 1);
  assertEquals(rows[0].skipped_no_line_id, 3);
});

Deno.test("buildConfirmBroadcastLogRows: 複数イベントでは skipped_no_line_id を先頭行にだけ乗せる（重複加算を防ぐ）", () => {
  const aggregates = aggregateConfirmBroadcastResults([
    { eventId: EVENT_A, oaConfigId: OA_1, success: true },
    { eventId: EVENT_B, oaConfigId: OA_2, success: true },
  ]);
  const rows = buildConfirmBroadcastLogRows(aggregates, 7);
  assertEquals(rows.length, 2);
  assertEquals(rows[0].skipped_no_line_id, 7);
  assertEquals(rows[1].skipped_no_line_id, 0);
  // 全行を合計しても skippedNoLineId を超えて増幅しない
  const total = rows.reduce((sum, r) => sum + r.skipped_no_line_id, 0);
  assertEquals(total, 7);
});

Deno.test("buildConfirmBroadcastLogRows: detail は件数キーのみ（PIIなし）", () => {
  const aggregates = aggregateConfirmBroadcastResults([
    { eventId: EVENT_A, oaConfigId: OA_1, success: true },
    { eventId: EVENT_A, oaConfigId: OA_1, success: false },
  ]);
  const rows = buildConfirmBroadcastLogRows(aggregates, 0);
  const detail = rows[0].detail as Record<string, unknown>;

  // detail のキーは想定の件数キーのみ
  assertEquals(
    Object.keys(detail).sort(),
    ["failed", "recipients", "sent", "skipped_no_line_id", "skipped_concurrent"].sort(),
  );
  // すべての値が number（名前・LINE userIdなどの文字列PIIが混入していない）
  for (const value of Object.values(detail)) {
    assertEquals(typeof value, "number");
  }
});

Deno.test("buildConfirmBroadcastLogRows: 集計0件（対象なし） → 行も0件", () => {
  const rows = buildConfirmBroadcastLogRows([], 0);
  assertEquals(rows, []);
});

// --- 同時実行に先を越されたケース（レビュー指摘 L6 の回帰テスト） ---

Deno.test("aggregate: skippedConcurrent は failed に数えず、recipients には含める", () => {
  const [agg] = aggregateConfirmBroadcastResults([
    { eventId: EVENT_A, oaConfigId: OA_1, success: true },
    { eventId: EVENT_A, oaConfigId: OA_1, success: false, skippedConcurrent: true },
    { eventId: EVENT_A, oaConfigId: OA_1, success: false },
  ]);
  assertEquals(agg.recipients, 3, "検討した人数は3");
  assertEquals(agg.sent, 1);
  assertEquals(agg.failed, 1, "先を越された分を failed に混ぜてはいけない");
  assertEquals(agg.skippedConcurrent, 1);
  assertEquals(
    agg.sent + agg.failed + agg.skippedConcurrent,
    agg.recipients,
    "recipients = sent + failed + skippedConcurrent が常に成り立つこと",
  );
});

Deno.test("全件が先を越されても監査ログの行が1行残る", () => {
  // これが空配列になると、重複実行を可視化するために足したログが
  // まさに重複実行のときだけ残らない、という状態になる
  const aggs = aggregateConfirmBroadcastResults([
    { eventId: EVENT_A, oaConfigId: OA_1, success: false, skippedConcurrent: true },
    { eventId: EVENT_A, oaConfigId: OA_1, success: false, skippedConcurrent: true },
  ]);
  const rows = buildConfirmBroadcastLogRows(aggs, 5);
  assertEquals(rows.length, 1, "対象が居たなら実行記録は必ず残す");
  assertEquals(rows[0].sent, 0);
  assertEquals(rows[0].failed, 0);
  assertEquals(rows[0].recipients, 2);
  assertEquals(rows[0].skipped_no_line_id, 5, "未紐付け件数も捨てない");
  assertEquals(
    rows[0].detail.skipped_concurrent,
    2,
    "先を越された件数が detail に残ること（同一分の重なりに気づく手がかり）",
  );
});
