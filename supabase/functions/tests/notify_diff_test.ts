// notify/diff.ts — diffParticipants() 純関数 Unit Test
// TDD RED: diff.ts 未実装の状態で fail することを確認する
// 実行: deno test --config supabase/functions/deno.json --allow-read supabase/functions/tests/notify_diff_test.ts

import { assertEquals } from "jsr:@std/assert";
import type { ExistingRow } from "../_shared/notify/diff.ts";
import { diffParticipants, shouldApplyDepartures } from "../_shared/notify/diff.ts";

// ==================== 差分検出の4系統 ====================

Deno.test("diffParticipants: 不変（変化なし）→ 両リスト空", () => {
  const existing: ExistingRow[] = [
    { natural_key: "nk1", status: "attending" },
    { natural_key: "nk2", status: "interested" },
  ];
  const incoming = [
    { naturalKey: "nk1", displayName: "田中太郎", status: "attending" },
    { naturalKey: "nk2", displayName: "山田花子", status: "interested" },
  ];
  const result = diffParticipants(existing, incoming);
  assertEquals(result.newParticipants, []);
  assertEquals(result.statusChanges, []);
});

Deno.test("diffParticipants: 新規参加者の分類", () => {
  const existing: ExistingRow[] = [
    { natural_key: "nk1", status: "attending" },
  ];
  const incoming = [
    { naturalKey: "nk1", displayName: "田中太郎", status: "attending" },
    { naturalKey: "nk2", displayName: "山田花子", status: "interested" },
  ];
  const result = diffParticipants(existing, incoming);
  assertEquals(result.newParticipants.length, 1);
  assertEquals(result.newParticipants[0].displayName, "山田花子");
  assertEquals(result.newParticipants[0].status, "interested");
  assertEquals(result.statusChanges, []);
});

Deno.test("diffParticipants: status 変化の分類（from/to 保持）", () => {
  const existing: ExistingRow[] = [
    { natural_key: "nk1", status: "attending" },
  ];
  const incoming = [
    { naturalKey: "nk1", displayName: "田中太郎", status: "declined" },
  ];
  const result = diffParticipants(existing, incoming);
  assertEquals(result.newParticipants, []);
  assertEquals(result.statusChanges.length, 1);
  assertEquals(result.statusChanges[0].displayName, "田中太郎");
  assertEquals(result.statusChanges[0].from, "attending");
  assertEquals(result.statusChanges[0].to, "declined");
});

Deno.test("diffParticipants: 初回スクレイプ（existing 空）→ 全員 newParticipants", () => {
  const existing: ExistingRow[] = [];
  const incoming = [
    { naturalKey: "nk1", displayName: "田中太郎", status: "attending" },
    { naturalKey: "nk2", displayName: "山田花子", status: "interested" },
  ];
  const result = diffParticipants(existing, incoming);
  assertEquals(result.newParticipants.length, 2);
  assertEquals(result.statusChanges, []);
});

Deno.test("diffParticipants: 既存キーと新キーの混在（バッチ内混在）", () => {
  const existing: ExistingRow[] = [
    { natural_key: "nk1", status: "attending" },
    { natural_key: "nk2", status: "attending" },
  ];
  const incoming = [
    { naturalKey: "nk1", displayName: "田中太郎", status: "declined" },  // status変化
    { naturalKey: "nk2", displayName: "山田花子", status: "attending" }, // 不変
    { naturalKey: "nk3", displayName: "佐藤一郎", status: "interested" }, // 新規
  ];
  const result = diffParticipants(existing, incoming);
  assertEquals(result.newParticipants.length, 1, "新規1名");
  assertEquals(result.newParticipants[0].displayName, "佐藤一郎");
  assertEquals(result.statusChanges.length, 1, "status変化1名");
  assertEquals(result.statusChanges[0].from, "attending");
  assertEquals(result.statusChanges[0].to, "declined");
});

// --- 離脱者の検出（issue #2） ---

Deno.test("diffParticipants: 既存にあって今回現れない参加者を departedParticipants に入れる", () => {
  const diff = diffParticipants(
    [
      { natural_key: "alice", status: "attending" },
      { natural_key: "bob", status: "attending" },
    ],
    [{ naturalKey: "bob", displayName: "bob", status: "attending" }],
  );
  assertEquals(diff.departedParticipants.length, 1);
  assertEquals(diff.departedParticipants[0].naturalKey, "alice");
  assertEquals(diff.departedParticipants[0].status, "attending", "離脱前の status を保持する");
  assertEquals(diff.newParticipants.length, 0);
  assertEquals(diff.statusChanges.length, 0, "離脱を statusChanges に混ぜてはいけない");
});

Deno.test("diffParticipants: 既に left の行は離脱として再検出しない（毎回通知し続けないため）", () => {
  const diff = diffParticipants(
    [
      { natural_key: "alice", status: "left" },
      { natural_key: "bob", status: "attending" },
    ],
    [{ naturalKey: "bob", displayName: "bob", status: "attending" }],
  );
  assertEquals(diff.departedParticipants.length, 0);
});

Deno.test("diffParticipants: 離脱者が戻ってきたら statusChange(left→attending) になる", () => {
  const diff = diffParticipants(
    [{ natural_key: "alice", status: "left" }],
    [{ naturalKey: "alice", displayName: "alice", status: "attending" }],
  );
  assertEquals(diff.departedParticipants.length, 0);
  assertEquals(diff.statusChanges.length, 1);
  assertEquals(diff.statusChanges[0].from, "left");
  assertEquals(diff.statusChanges[0].to, "attending");
  assertEquals(diff.newParticipants.length, 0, "再登場は新規ではない");
});

Deno.test("diffParticipants: 取得0件でも departedParticipants は計算される（適用の判断は別関数）", () => {
  const diff = diffParticipants(
    [{ natural_key: "alice", status: "attending" }],
    [],
  );
  assertEquals(diff.departedParticipants.length, 1, "検出自体はする");
});

// --- 誤検知への防御 ---

Deno.test("shouldApplyDepartures: 既存が居るのに取得0件なら適用しない（全員を配信対象から外す事故を防ぐ）", () => {
  assertEquals(shouldApplyDepartures(0, 5), false);
});

Deno.test("shouldApplyDepartures: 初回スクレイプ（既存0件）は適用しない", () => {
  assertEquals(shouldApplyDepartures(3, 0), false);
});

Deno.test("shouldApplyDepartures: 取得が1件以上あれば適用する（割合しきい値は設けない）", () => {
  assertEquals(shouldApplyDepartures(1, 10), true, "9名減っても正当な離脱の可能性があるので適用する");
  assertEquals(shouldApplyDepartures(5, 5), true);
});
