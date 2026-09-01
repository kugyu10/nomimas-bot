// 擬似ポーリングテスト: 3つの状態遷移を検証
// フィクスチャ4本（t0, t1, t2, t3）を用いて
// 1. 新規参加者追加（t0→t1）
// 2. attending→declined（t1→t2）
// 3. declined→attending（t2→t3）
// 4. 同一スナップショット同士→差分ゼロ（t0→t0）
// を検証する
// 実行: deno test --config supabase/functions/deno.json --allow-read supabase/functions/tests/twipla_polling_test.ts
//
// フィクスチャの出自（独立検証で「手書きではないか」と問われた点の記録）:
//   実イベント https://twipla.jp/events/741123 を1回だけ取得した生HTMLから、
//   パーサが依存する構造をそのまま写し、値だけをダミーに差し替えたもの。
//   実在の氏名・screen_name・画像URLはリポジトリに入れない方針のため値は置換してある。
//   構造の一致点（parseTwiplaHtml が実際に見る部分）:
//     - セクション: <div class='float_left member_list round_border'>  （実HTMLと同一）
//     - 見出しテキスト: 「参加者 (N人／定員M人)」「興味あり (N人)」「不参加 (N人)」
//     - 参加者: <a href=... class="card namelist" n=... s=... title=... target="_self">
//   実イベントは現在「参加者1人・定員表記なし」なので、定員抽出（定員15人）は
//   フィクスチャ側で担保している。

import { assertEquals } from "jsr:@std/assert";
import type { ScrapedParticipant } from "../_shared/providers/types.ts";
import type { ExistingRow } from "../_shared/notify/diff.ts";
import { parseTwiplaHtml } from "../_shared/providers/twipla.ts";
import { diffParticipants, shouldApplyDepartures } from "../_shared/notify/diff.ts";

// フィクスチャHTMLの読み込み
const FIXTURE_T0 = new URL("./fixtures/twipla_poll_t0.html", import.meta.url);
const FIXTURE_T1 = new URL("./fixtures/twipla_poll_t1.html", import.meta.url);
const FIXTURE_T2 = new URL("./fixtures/twipla_poll_t2.html", import.meta.url);
const FIXTURE_T3 = new URL("./fixtures/twipla_poll_t3.html", import.meta.url);
const FIXTURE_T5 = new URL("./fixtures/twipla_poll_t5_departed.html", import.meta.url);

/**
 * parseTwiplaHtml の出力を diffParticipants の入力形式に変換するヘルパー
 * naturalKey の作り方は scraper 本体と同一: screenName ?? 'dn:' + displayName
 */
function toIncomingFormat(
  participants: ScrapedParticipant[],
): { naturalKey: string; displayName: string; status: string }[] {
  return participants.map((p) => ({
    naturalKey: p.screenName ?? `dn:${p.displayName}`,
    displayName: p.displayName,
    status: p.status,
  }));
}

/**
 * スナップショットを ExistingRow[] に変換（diffParticipants の入力形式）
 */
function toExistingRows(
  participants: ScrapedParticipant[],
): ExistingRow[] {
  return participants.map((p) => ({
    natural_key: p.screenName ?? `dn:${p.displayName}`,
    status: p.status,
    // scraper の upsert は必ず scraped_at を入れる。この写像は「前回のスクレイプで
    // 観測した行」を模すので、観測済みであることを表す値を入れる。
    // （scraped_at が無い行は離脱扱いされない — seed 相当の行を守るため）
    scraped_at: "2026-08-31T00:00:00Z",
  }));
}

Deno.test("twipla_polling: t0→t0（同一スナップショット） → 差分ゼロ", () => {
  const htmlT0 = Deno.readTextFileSync(FIXTURE_T0);
  const resultT0 = parseTwiplaHtml(htmlT0, "https://twipla.jp/events/test");

  const existing = toExistingRows(resultT0.participants);
  const incoming = toIncomingFormat(resultT0.participants);
  const diff = diffParticipants(existing, incoming);

  assertEquals(diff.newParticipants.length, 0, "新規参加者がないこと");
  assertEquals(diff.statusChanges.length, 0, "ステータス変化がないこと");
});

Deno.test("twipla_polling: t0→t1（新規参加者追加） → bob が newParticipants に分類", () => {
  const htmlT0 = Deno.readTextFileSync(FIXTURE_T0);
  const htmlT1 = Deno.readTextFileSync(FIXTURE_T1);

  const resultT0 = parseTwiplaHtml(htmlT0, "https://twipla.jp/events/test");
  const resultT1 = parseTwiplaHtml(htmlT1, "https://twipla.jp/events/test");

  const existing = toExistingRows(resultT0.participants);
  const incoming = toIncomingFormat(resultT1.participants);
  const diff = diffParticipants(existing, incoming);

  assertEquals(diff.newParticipants.length, 1, "新規参加者が1名");
  assertEquals(diff.newParticipants[0].displayName, "bob", "新規参加者は bob");
  assertEquals(diff.newParticipants[0].status, "attending", "bob のステータスは attending");
  assertEquals(diff.statusChanges.length, 0, "ステータス変化がないこと（alice は不変）");
});

Deno.test("twipla_polling: t1→t2（attending→declined） → alice が statusChanges に分類", () => {
  const htmlT1 = Deno.readTextFileSync(FIXTURE_T1);
  const htmlT2 = Deno.readTextFileSync(FIXTURE_T2);

  const resultT1 = parseTwiplaHtml(htmlT1, "https://twipla.jp/events/test");
  const resultT2 = parseTwiplaHtml(htmlT2, "https://twipla.jp/events/test");

  const existing = toExistingRows(resultT1.participants);
  const incoming = toIncomingFormat(resultT2.participants);
  const diff = diffParticipants(existing, incoming);

  assertEquals(diff.newParticipants.length, 0, "新規参加者がないこと");
  assertEquals(diff.statusChanges.length, 1, "ステータス変化が1件");
  assertEquals(diff.statusChanges[0].displayName, "alice", "変化者は alice");
  assertEquals(diff.statusChanges[0].from, "attending", "alice の旧ステータスは attending");
  assertEquals(diff.statusChanges[0].to, "declined", "alice の新ステータスは declined");
});

Deno.test("twipla_polling: t2→t3（declined→attending） → alice が statusChanges に分類", () => {
  const htmlT2 = Deno.readTextFileSync(FIXTURE_T2);
  const htmlT3 = Deno.readTextFileSync(FIXTURE_T3);

  const resultT2 = parseTwiplaHtml(htmlT2, "https://twipla.jp/events/test");
  const resultT3 = parseTwiplaHtml(htmlT3, "https://twipla.jp/events/test");

  const existing = toExistingRows(resultT2.participants);
  const incoming = toIncomingFormat(resultT3.participants);
  const diff = diffParticipants(existing, incoming);

  assertEquals(diff.newParticipants.length, 0, "新規参加者がないこと（bob は既存）");
  assertEquals(diff.statusChanges.length, 1, "ステータス変化が1件（alice のみ）");
  assertEquals(diff.statusChanges[0].displayName, "alice", "変化者は alice");
  assertEquals(diff.statusChanges[0].from, "declined", "alice の旧ステータスは declined");
  assertEquals(diff.statusChanges[0].to, "attending", "alice の新ステータスは attending");
});

Deno.test("twipla_polling: t0 の capacity が 15 として取れる", () => {
  const htmlT0 = Deno.readTextFileSync(FIXTURE_T0);
  const resultT0 = parseTwiplaHtml(htmlT0, "https://twipla.jp/events/test");

  assertEquals(resultT0.capacity, 15, "capacity が15として取れること");
});

// --- 離脱（ページから行ごと消える） — issue #2 ---
//
// t1 は参加者 alice, bob。t5 は bob だけ（alice が参加を取り消してページから消えた状態）。
// セクション間の移動（attending→declined）ではなく行そのものが無くなる変化を再現している。

Deno.test("twipla_polling: t1→t5（alice がページから消える） → departedParticipants に分類", () => {
  const resultT1 = parseTwiplaHtml(Deno.readTextFileSync(FIXTURE_T1), "https://twipla.jp/events/test");
  const resultT5 = parseTwiplaHtml(Deno.readTextFileSync(FIXTURE_T5), "https://twipla.jp/events/test");

  const existing = toExistingRows(resultT1.participants);
  const incoming = toIncomingFormat(resultT5.participants);
  const diff = diffParticipants(existing, incoming);

  assertEquals(diff.newParticipants.length, 0, "新規はない");
  assertEquals(diff.statusChanges.length, 0, "離脱を statusChanges に混ぜてはいけない");
  assertEquals(diff.departedParticipants.length, 1, "離脱が1件");
  assertEquals(diff.departedParticipants[0].naturalKey, "alice", "離脱者は alice");
  assertEquals(diff.departedParticipants[0].status, "attending", "離脱前は attending だった");
  assertEquals(
    shouldApplyDepartures(incoming.length, existing.length),
    true,
    "取得が1件以上あるので、この離脱は記録に適用してよい",
  );
});

Deno.test("twipla_polling: t5→t1（alice が戻ってくる） → left からの復帰として扱える", () => {
  const resultT5 = parseTwiplaHtml(Deno.readTextFileSync(FIXTURE_T5), "https://twipla.jp/events/test");
  const resultT1 = parseTwiplaHtml(Deno.readTextFileSync(FIXTURE_T1), "https://twipla.jp/events/test");

  // 離脱を適用した後のDB状態を模す（alice は 'left' として残っている）
  const existing = [
    ...toExistingRows(resultT5.participants),
    { natural_key: "alice", status: "left", scraped_at: "2026-08-31T00:00:00Z" },
  ];
  const incoming = toIncomingFormat(resultT1.participants);
  const diff = diffParticipants(existing, incoming);

  assertEquals(diff.newParticipants.length, 0, "再登場は新規ではない");
  assertEquals(diff.departedParticipants.length, 0, "誰も離脱していない");
  assertEquals(diff.statusChanges.length, 1, "left→attending の変化が1件");
  assertEquals(diff.statusChanges[0].displayName, "alice");
  assertEquals(diff.statusChanges[0].from, "left");
  assertEquals(diff.statusChanges[0].to, "attending");
});
