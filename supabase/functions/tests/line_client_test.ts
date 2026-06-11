/**
 * line_client_test.ts
 * LINE送信クライアント（pushMessage / replyMessage）のユニットテスト
 *
 * 検証対象:
 *   - メッセージ数 1..5 の境界 assert（空・6件は throw）
 *   - LINE_DRY_RUN 判定が env 権限なし実行時に安全側（false）に倒れる
 *
 * 実 fetch 経路は E2E（DRY_RUN=1）と HUMAN-UAT が担う。
 * このテストは --allow-read のみで実行できること。
 */

import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { pushMessage, replyMessage } from "../_shared/line/client.ts";

// ダミートークン（実送信しない）
const DUMMY_TOKEN = "test-token";
const DUMMY_USER = "U0123456789abcdef0123456789abcdef0";
const DUMMY_REPLY_TOKEN = "nHuyWiB7yP5Zw52FIkcQobQuGDXCTA";

// 有効メッセージ（1件）
const ONE_MSG = [{ type: "text", text: "hello" }];

// 5件（上限）
const FIVE_MSGS = [
  { type: "text", text: "1" },
  { type: "text", text: "2" },
  { type: "text", text: "3" },
  { type: "text", text: "4" },
  { type: "text", text: "5" },
];

// 6件（上限超過）
const SIX_MSGS = [
  { type: "text", text: "1" },
  { type: "text", text: "2" },
  { type: "text", text: "3" },
  { type: "text", text: "4" },
  { type: "text", text: "5" },
  { type: "text", text: "6" },
];

// --- pushMessage のメッセージ数 assert テスト ---

Deno.test("pushMessage: 空配列を渡すと throw", async () => {
  await assertRejects(
    () => pushMessage(DUMMY_TOKEN, DUMMY_USER, []),
    Error,
    "messages",
  );
});

Deno.test("pushMessage: 6件を渡すと throw", async () => {
  await assertRejects(
    () => pushMessage(DUMMY_TOKEN, DUMMY_USER, SIX_MSGS),
    Error,
    "messages",
  );
});

Deno.test("pushMessage: DRY_RUN 環境変数が参照できない場合は安全側（false）に倒れてもクラッシュしない", async () => {
  // --allow-env なし環境で Deno.env.get を呼ぶと例外が発生する場合がある。
  // isDryRun() ヘルパーが try/catch で包んでいれば、env 権限なしでもクラッシュしない。
  // このテストは --allow-read のみで実行するため、実 fetch 経路には到達しない
  // （LINE_DRY_RUN が false に倒れても、fetch 呼び出し自体は --allow-net がないとエラーになるが、
  //   その前に isDryRun() チェックが正常終了することだけを確認する — 実際には fetch エラーになる前の
  //   バリデーション層のみをテストする）。
  // NOTE: このテストは DRY_RUN 判定が throw しないことを確認する。
  //       実 fetch は --allow-net なしで失敗するが、それは expect されない。
  //       そのためメッセージ数チェック後かつ fetch 呼び出し前に DRY_RUN チェックがあることを前提とする。
  // テストは 1件の有効メッセージで pushMessage を呼び、DRY_RUN 判定で例外が出ないことを確認する。
  // fetch が呼ばれると --allow-net なしで失敗するが、DRY_RUN=false の場合は fetch を試みる前の
  // dry-run 分岐が正常に通過することで「クラッシュしない判定」の確認は完了している。
  //
  // 実際の確認: pushMessage が messages 数チェック通過後に isDryRun() を呼んでもクラッシュしないこと。
  // ここでは 1件メッセージを渡し、エラー種別が "Deno env permission error" でないことを確認する。
  let err: unknown = null;
  try {
    await pushMessage(DUMMY_TOKEN, DUMMY_USER, ONE_MSG);
  } catch (e) {
    err = e;
  }
  // エラーがあるとすれば fetch 失敗（net 権限なし）であって isDryRun() のクラッシュではない。
  // env 取得失敗（PermissionDenied）がここで出ないことを確認。
  if (err !== null) {
    const msg = (err as Error).message ?? "";
    assertEquals(
      msg.includes("PermissionDenied") || msg.includes("Requires env access"),
      false,
      `isDryRun() が env 権限エラーをスローすべきでない。実際のエラー: ${msg}`,
    );
  }
});

// --- replyMessage のメッセージ数 assert テスト ---

Deno.test("replyMessage: 空配列を渡すと throw", async () => {
  await assertRejects(
    () => replyMessage(DUMMY_TOKEN, DUMMY_REPLY_TOKEN, []),
    Error,
    "messages",
  );
});

Deno.test("replyMessage: 6件を渡すと throw", async () => {
  await assertRejects(
    () => replyMessage(DUMMY_TOKEN, DUMMY_REPLY_TOKEN, SIX_MSGS),
    Error,
    "messages",
  );
});
