// TwiplaパーサーのUnit Test（フィクスチャHTML使用）
// TDD RED: twipla.ts が未実装の状態でfailすることを確認する
// 実行: deno test --config supabase/functions/deno.json --allow-read supabase/functions/tests/twipla_parser_test.ts

import { assertEquals, assertGreater, assertExists } from "jsr:@std/assert";
import type { ScrapedParticipant } from "../_shared/providers/types.ts";
import { parseTwiplaHtml } from "../_shared/providers/twipla.ts";

// フィクスチャHTMLの読み込み
// URLオブジェクトを直接渡す（.pathnameはパスに空白・非ASCIIがあると%エンコードで壊れる — IN-07）
const FIXTURE_PATH = new URL("./fixtures/twipla_event.html", import.meta.url);

Deno.test("parseTwiplaHtml: 参加者のみが attending として抽出され興味あり・不参加が混入しない", () => {
  const html = Deno.readTextFileSync(FIXTURE_PATH);
  const result = parseTwiplaHtml(html, "https://twipla.jp/events/731057");

  // attending のみフィルタ
  const attending = result.participants.filter((p: ScrapedParticipant) => p.status === "attending");

  // フィクスチャの「参加者 (2人／定員15人)」= 2人
  assertEquals(attending.length, 2, "attending は2人であること（フィクスチャのヘッダ人数と一致）");

  // 興味あり・不参加が attending に混入していないこと
  const nonAttending = result.participants.filter((p: ScrapedParticipant) => p.status !== "attending");
  assertEquals(nonAttending.length, 2, "興味ありが2人として別ステータスで取れること");
});

Deno.test("parseTwiplaHtml: attending エントリの displayName・screenName・profileUrl が正しく取れる", () => {
  const html = Deno.readTextFileSync(FIXTURE_PATH);
  const result = parseTwiplaHtml(html, "https://twipla.jp/events/731057");

  const attending = result.participants.filter((p: ScrapedParticipant) => p.status === "attending");
  assertGreater(attending.length, 0, "attending が1件以上存在すること");

  for (const p of attending) {
    // displayName は n属性値（ダミー: テストユーザーN）
    assertExists(p.displayName, "displayName が存在すること");
    assertEquals(p.displayName.startsWith("テストユーザー"), true, `displayName がテストユーザーで始まること: ${p.displayName}`);

    // screenName は s属性値（ダミー: testuserN）
    assertExists(p.screenName, "screenName が存在すること");
    assertEquals(p.screenName!.startsWith("testuser"), true, `screenName が testuser で始まること: ${p.screenName}`);

    // profileUrl は href 属性値（ダミー: /users/testuserN）
    assertExists(p.profileUrl, "profileUrl が存在すること");
    assertEquals(p.profileUrl!.startsWith("/users/testuser"), true, `profileUrl が /users/testuser で始まること: ${p.profileUrl}`);
  }
});

Deno.test("parseTwiplaHtml: capacity がヘッダから数値として取れる", () => {
  const html = Deno.readTextFileSync(FIXTURE_PATH);
  const result = parseTwiplaHtml(html, "https://twipla.jp/events/731057");

  // フィクスチャの「参加者 (2人／定員15人)」から定員15を抽出
  assertEquals(result.capacity, 15, "capacity が 15 として抽出されること");
});

Deno.test("parseTwiplaHtml: 空の member_list セクション（不参加 0人）で例外を出さない", () => {
  const html = Deno.readTextFileSync(FIXTURE_PATH);
  // 例外が出なければPASS
  const result = parseTwiplaHtml(html, "https://twipla.jp/events/731057");

  const declined = result.participants.filter((p: ScrapedParticipant) => p.status === "declined");
  assertEquals(declined.length, 0, "不参加セクションが空（0人）の場合、declined が0件であること");
});

Deno.test("parseTwiplaHtml: 全セクション合計で参加者4件（attending 2 + interested 2 + declined 0）", () => {
  const html = Deno.readTextFileSync(FIXTURE_PATH);
  const result = parseTwiplaHtml(html, "https://twipla.jp/events/731057");

  assertEquals(result.participants.length, 4, "全参加者数が4件（attending 2 + interested 2 + declined 0）");
  assertEquals(result.platform, "twipla", "platform が 'twipla' であること");
});

// canHandle の境界テスト（Task 2でtwipla.tsを実装したときのみGREENになる）
Deno.test("twiplaProvider.canHandle: twipla.jp のイベントURLのみ true", async () => {
  const { twiplaProvider } = await import("../_shared/providers/twipla.ts");

  // 正常系
  assertEquals(twiplaProvider.canHandle("https://twipla.jp/events/731057"), true, "https://twipla.jp/events/731057 は true");
  assertEquals(twiplaProvider.canHandle("http://twipla.jp/events/123"), true, "http URL も true");

  // 異常系（SSRF防止）
  assertEquals(twiplaProvider.canHandle("https://example.com/events/123"), false, "example.com は false");
  assertEquals(twiplaProvider.canHandle("https://twipla.jp/users/someone"), false, "/events/ 以外のパスは false");
  assertEquals(twiplaProvider.canHandle("ftp://twipla.jp/events/123"), false, "ftp スキームは false");
  assertEquals(twiplaProvider.canHandle("https://evil.twipla.jp/events/123"), false, "サブドメインは false");
  assertEquals(twiplaProvider.canHandle("https://twipla.jp:8080/events/123"), false, "ポート明示URLは false（WR-02）");
  assertEquals(twiplaProvider.canHandle("not-a-url"), false, "不正URLは false");
});

// IN-08: クエリ文字列・フラグメント付きURLの拒否テスト
Deno.test("twiplaProvider.canHandle (IN-08): query/hash付きURLは false", async () => {
  const { twiplaProvider } = await import("../_shared/providers/twipla.ts");

  // IN-08: クエリ付きURL（UTMパラメータ等）は false
  assertEquals(
    twiplaProvider.canHandle("https://twipla.jp/events/731057?utm_source=x"),
    false,
    "クエリ付きURL(utm_source=x) は false（IN-08）",
  );
  assertEquals(
    twiplaProvider.canHandle("https://twipla.jp/events/731057?ref=twitter"),
    false,
    "クエリ付きURL(ref=twitter) は false（IN-08）",
  );

  // IN-08: フラグメント付きURL は false
  assertEquals(
    twiplaProvider.canHandle("https://twipla.jp/events/731057#section"),
    false,
    "フラグメント付きURL(#section) は false（IN-08）",
  );

  // 正規URL（クエリなし・フラグメントなし）は引き続き true
  assertEquals(
    twiplaProvider.canHandle("https://twipla.jp/events/731057"),
    true,
    "正規URL（クエリなし・フラグメントなし）は true のまま（回帰なし）",
  );
});
