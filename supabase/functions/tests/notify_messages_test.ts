// notify/messages.ts — 通知文面組み立て純関数 Unit Test
// TDD RED: messages.ts 未実装の状態で fail することを確認する
// 実行: deno test --config supabase/functions/deno.json --allow-read supabase/functions/tests/notify_messages_test.ts

import { assertEquals, assertMatch, assertNotMatch } from "jsr:@std/assert";
import {
  buildAnswerNotification,
  buildCompletionNotification,
  buildScrapeChangesNotification,
} from "../_shared/notify/messages.ts";

// LINE userId パターン: "U" + 32文字の英数字
const LINE_USER_ID_PATTERN = /U[0-9a-zA-Z]{32}/;

// ==================== answer 通知 ====================

Deno.test("buildAnswerNotification: イベント名・参加者名・更新種別の3要素を含む", () => {
  const msg = buildAnswerNotification("夏の飲み会", "田中太郎");
  assertMatch(msg, /夏の飲み会/, "イベント名を含む");
  assertMatch(msg, /田中太郎/, "参加者名を含む");
  assertMatch(msg, /回答/, "更新種別（回答）を含む");
});

Deno.test("buildAnswerNotification: 出力に LINE userId パターンが含まれない（T-04-03）", () => {
  const msg = buildAnswerNotification("夏の飲み会", "田中太郎");
  assertNotMatch(msg, LINE_USER_ID_PATTERN, "LINE userId を含まない");
});

// ==================== completion 通知 ====================

Deno.test("buildCompletionNotification: イベント名・参加者名・更新種別の3要素を含む", () => {
  const msg = buildCompletionNotification("夏の飲み会", "山田花子");
  assertMatch(msg, /夏の飲み会/, "イベント名を含む");
  assertMatch(msg, /山田花子/, "参加者名を含む");
  assertMatch(msg, /完了/, "更新種別（完了）を含む");
});

Deno.test("buildCompletionNotification: 出力に LINE userId パターンが含まれない（T-04-03）", () => {
  const msg = buildCompletionNotification("夏の飲み会", "山田花子");
  assertNotMatch(msg, LINE_USER_ID_PATTERN, "LINE userId を含まない");
});

// ==================== scrape_changes 通知 ====================

Deno.test("buildScrapeChangesNotification: イベント名・件数・更新種別の3要素を含む", () => {
  const msg = buildScrapeChangesNotification("夏の飲み会", { newCount: 2, statusChangedCount: 1 });
  assertMatch(msg, /夏の飲み会/, "イベント名を含む");
  assertMatch(msg, /2/, "新規件数を含む");
  assertMatch(msg, /1/, "出欠変更件数を含む");
  assertMatch(msg, /更新|変更|参加者/, "更新種別（変化）を含む");
});

Deno.test("buildScrapeChangesNotification: 出力に LINE userId パターンが含まれない（T-04-03）", () => {
  const msg = buildScrapeChangesNotification("dev-event", { newCount: 1, statusChangedCount: 1 });
  assertNotMatch(msg, LINE_USER_ID_PATTERN, "LINE userId を含まない");
});

Deno.test("buildScrapeChangesNotification: newCount=0 / statusChangedCount=1 の場合も動作する", () => {
  const msg = buildScrapeChangesNotification("dev-event", { newCount: 0, statusChangedCount: 1 });
  assertMatch(msg, /dev-event/, "イベント名を含む");
  assertNotMatch(msg, LINE_USER_ID_PATTERN, "LINE userId を含まない");
});

// ==================== シグネチャ確認（LINE userId を引数に取らない） ====================

Deno.test("buildAnswerNotification: 引数は eventTitle と participantName の2つのみ", () => {
  // シグネチャが (eventTitle: string, participantName: string) であることを型で担保
  // コンパイル時に型検査されるが、引数2個で呼べることを確認
  const msg = buildAnswerNotification("テストイベント", "テスト参加者");
  assertEquals(typeof msg, "string");
});

Deno.test("buildCompletionNotification: 引数は eventTitle と participantName の2つのみ", () => {
  const msg = buildCompletionNotification("テストイベント", "テスト参加者");
  assertEquals(typeof msg, "string");
});

Deno.test("buildScrapeChangesNotification: 引数は eventTitle と counts オブジェクトの2つのみ", () => {
  const msg = buildScrapeChangesNotification("テストイベント", { newCount: 3, statusChangedCount: 0 });
  assertEquals(typeof msg, "string");
});
