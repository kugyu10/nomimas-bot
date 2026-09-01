// v1.1 自動ポーリング向けガード: 「セクションが1つも見つからない」（=取得失敗）と
// 「セクションはあるが参加者0人」を区別できることを検証する。
//
// 背景: 自動ポーリングを入れると、parseTwiplaHtml が div.member_list を1つも
// 見つけられなかった場合（Twipla側のマークアップ変更・エラーページ・ログイン要求・
// レート制限ページ等）でも例外を投げず participants: [] を返す。これを
// 「参加者が0人になった」と区別できないと、実際には取得に失敗しているだけなのに
// 静かに無視されたり、既存の参加者データと矛盾した状態になりかねない。
// sectionCount フィールドでこの2つを区別する（scraper/index.ts が sectionCount===0 を
// 取得失敗として扱い、upsert/差分/通知に進まない）。
//
// 実行: deno test --config supabase/functions/deno.json --allow-read supabase/functions/tests/twipla_section_guard_test.ts

import { assertEquals } from "jsr:@std/assert";
import type { ExistingRow } from "../_shared/notify/diff.ts";
import { diffParticipants, shouldApplyDepartures } from "../_shared/notify/diff.ts";
import { parseTwiplaHtml } from "../_shared/providers/twipla.ts";

const FIXTURE_BROKEN = new URL("./fixtures/twipla_broken_no_sections.html", import.meta.url);
const FIXTURE_EMPTY_SECTIONS = new URL("./fixtures/twipla_empty_sections.html", import.meta.url);
const FIXTURE_EVENT = new URL("./fixtures/twipla_event.html", import.meta.url);
const FIXTURE_POLL_T0 = new URL("./fixtures/twipla_poll_t0.html", import.meta.url);

Deno.test("parseTwiplaHtml: div.member_list が1つも無いHTML → sectionCount 0 かつ participants 0件", () => {
  const html = Deno.readTextFileSync(FIXTURE_BROKEN);
  const result = parseTwiplaHtml(html, "https://twipla.jp/events/999999");

  assertEquals(result.sectionCount, 0, "セクションが1つも見つからないこと");
  assertEquals(result.participants.length, 0, "participants も0件であること");
});

Deno.test("parseTwiplaHtml: セクション3つとも0人のHTML → sectionCount 3 かつ participants 0件", () => {
  const html = Deno.readTextFileSync(FIXTURE_EMPTY_SECTIONS);
  const result = parseTwiplaHtml(html, "https://twipla.jp/events/999999");

  assertEquals(result.sectionCount, 3, "3セクションとも見つかること（参加者・興味あり・不参加）");
  assertEquals(result.participants.length, 0, "participants は0件であること（セクションはあるが空）");
});

Deno.test("parseTwiplaHtml: sectionCount 0 と 3 は区別できる（本テストの要点）", () => {
  const brokenHtml = Deno.readTextFileSync(FIXTURE_BROKEN);
  const emptyHtml = Deno.readTextFileSync(FIXTURE_EMPTY_SECTIONS);

  const broken = parseTwiplaHtml(brokenHtml, "https://twipla.jp/events/999999");
  const empty = parseTwiplaHtml(emptyHtml, "https://twipla.jp/events/999999");

  // participants.length は両方とも0件で同一だが、sectionCount で「取得失敗」と
  // 「本当に参加者0人」を区別できることを確認する
  assertEquals(broken.participants.length, empty.participants.length, "participants.length はどちらも0件で同じ");
  assertEquals(broken.sectionCount === empty.sectionCount, false, "sectionCount は異なる（0 vs 3）");
  assertEquals(broken.sectionCount, 0);
  assertEquals(empty.sectionCount, 3);
});

Deno.test("parseTwiplaHtml: 既存の正常フィクスチャ（twipla_event.html）で sectionCount が3であること", () => {
  const html = Deno.readTextFileSync(FIXTURE_EVENT);
  const result = parseTwiplaHtml(html, "https://twipla.jp/events/731057");

  assertEquals(result.sectionCount, 3, "参加者・興味あり・不参加の3セクション");
});

Deno.test("parseTwiplaHtml: 既存の正常フィクスチャ（twipla_poll_t0.html）で sectionCount が3であること", () => {
  const html = Deno.readTextFileSync(FIXTURE_POLL_T0);
  const result = parseTwiplaHtml(html, "https://twipla.jp/events/test");

  assertEquals(result.sectionCount, 3, "参加者・興味あり・不参加の3セクション");
});

// 【2026-08-31 更新】以前ここは「diffParticipants は消えた人を検出しない」という
// 当時の仕様を明文化していた。issue #2 でその穴を塞いだので、テストの意味も変わっている。
//
// いまは:
//   - 消えた人は departedParticipants として**検出される**
//   - ただし「既存が居るのに取得0件」は取得異常の疑いとして
//     shouldApplyDepartures が false を返し、**記録には適用されない**
// 検出と適用を分けているのがこの設計の要点なので、両方をここで固定する。
Deno.test("diffParticipants: 既存2件・incoming 0件 → 離脱は検出されるが適用はされない", () => {
  const existing: ExistingRow[] = [
    { natural_key: "alice", status: "attending", scraped_at: "2026-08-31T00:00:00Z" },
    { natural_key: "bob", status: "interested", scraped_at: "2026-08-31T00:00:00Z" },
  ];
  const incoming: { naturalKey: string; displayName: string; status: string }[] = [];

  const result = diffParticipants(existing, incoming);

  assertEquals(result.newParticipants, [], "新規参加者は検出されない（0件）");
  assertEquals(result.statusChanges, [], "離脱を statusChanges に混ぜない");
  assertEquals(
    result.departedParticipants.length,
    2,
    "消えた2名は departedParticipants として検出される",
  );
  assertEquals(
    shouldApplyDepartures(incoming.length, existing.length),
    false,
    "しかし取得0件は異常の疑いなので、この検出結果を DB に適用してはいけない" +
      "（全員を確認配信の対象から外す事故になる）",
  );
});
