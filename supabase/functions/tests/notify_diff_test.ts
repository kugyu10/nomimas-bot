// notify/diff.ts — diffParticipants() 純関数 Unit Test
// TDD RED: diff.ts 未実装の状態で fail することを確認する
// 実行: deno test --config supabase/functions/deno.json --allow-read supabase/functions/tests/notify_diff_test.ts

import { assertEquals } from "jsr:@std/assert";
import type { ExistingRow } from "../_shared/notify/diff.ts";
import { diffParticipants } from "../_shared/notify/diff.ts";

// ==================== 差分検出の4系統 ====================

Deno.test("diffParticipants: 不変（変化なし）→ 両リスト空", () => {
  const existing: ExistingRow[] = [
    { natural_key: "nk1", status: "attending", display_name: "田中太郎" },
    { natural_key: "nk2", status: "interested", display_name: "山田花子" },
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
    { natural_key: "nk1", status: "attending", display_name: "田中太郎" },
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
    { natural_key: "nk1", status: "attending", display_name: "田中太郎" },
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
    { natural_key: "nk1", status: "attending", display_name: "田中太郎" },
    { natural_key: "nk2", status: "attending", display_name: "山田花子" },
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
