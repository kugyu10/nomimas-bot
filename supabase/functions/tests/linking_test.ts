import { assertEquals } from "jsr:@std/assert";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  decodeLinkConfirmData,
  encodeLinkConfirmData,
  handleLinkConfirm,
  handleLinkMessage,
  LINK_CANCEL_MESSAGE,
  LINK_DONE_MESSAGE,
  LINK_NOT_FOUND_MESSAGE,
  normalizeScreenName,
} from "../_shared/confirm/linking.ts";

interface RpcCall { fn: string; args: Record<string, unknown> }
function fakeSupabase(result: { data: unknown; error: { message: string } | null }) {
  const calls: RpcCall[] = [];
  const client = {
    rpc(fn: string, args: Record<string, unknown>) {
      calls.push({ fn, args });
      return Promise.resolve(result);
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

Deno.test("normalizeScreenName: @付き・全角@・URL を受け付ける", () => {
  assertEquals(normalizeScreenName("@taro_1"), "taro_1");
  assertEquals(normalizeScreenName("  ＠taro_1 "), "taro_1");
  assertEquals(normalizeScreenName("https://x.com/taro_1?s=20"), "taro_1");
  assertEquals(normalizeScreenName("https://twitter.com/@taro_1"), "taro_1");
});

Deno.test("normalizeScreenName: 普通の会話・不正な名前・非テキストは null", () => {
  assertEquals(normalizeScreenName("hello"), null);
  assertEquals(normalizeScreenName("こんにちは"), null);
  assertEquals(normalizeScreenName("@"), null);
  assertEquals(normalizeScreenName("@abc def"), null);
  assertEquals(normalizeScreenName("@" + "a".repeat(16)), null);
  assertEquals(normalizeScreenName(null), null);
});

Deno.test("link confirm data: encode→decode 往復と不正値の拒否", () => {
  const d = encodeLinkConfirmData({ screenName: "taro_1", accepted: true });
  assertEquals(decodeLinkConfirmData(d), { screenName: "taro_1", accepted: true });
  assertEquals(decodeLinkConfirmData("k=link&s=a%27b&y=1"), null);
  assertEquals(decodeLinkConfirmData("k=link&s=taro&y=2"), null);
  assertEquals(decodeLinkConfirmData("p=x&q=y&a=0"), null);
});

Deno.test("handleLinkMessage: 候補あり → 表示名入りの確認クイックリプライ、正規化した名前でRPC", async () => {
  const { client, calls } = fakeSupabase({ data: [{ display_name: "太郎" }], error: null });
  const msgs = await handleLinkMessage(client, "oa-1", "@Taro_1");
  assertEquals(calls, [{ fn: "find_link_candidate", args: { p_oa_config_id: "oa-1", p_screen_name: "Taro_1" } }]);
  const m = msgs![0] as { text: string; quickReply: { items: { action: { data: string } }[] } };
  assertEquals(m.text.includes("太郎"), true);
  assertEquals(decodeLinkConfirmData(m.quickReply.items[0].action.data)?.accepted, true);
  assertEquals(decodeLinkConfirmData(m.quickReply.items[1].action.data)?.accepted, false);
});

Deno.test("handleLinkMessage: 候補なし → 案内、普通の会話 → null でRPCも呼ばない", async () => {
  const none = fakeSupabase({ data: [], error: null });
  assertEquals(await handleLinkMessage(none.client, "oa-1", "@nobody"), [LINK_NOT_FOUND_MESSAGE]);
  const chat = fakeSupabase({ data: [], error: null });
  assertEquals(await handleLinkMessage(chat.client, "oa-1", "hello"), null);
  assertEquals(chat.calls.length, 0);
});

Deno.test("handleLinkConfirm: はい → link_by_screen_name を line_users.id つきで呼ぶ", async () => {
  const { client, calls } = fakeSupabase({ data: 2, error: null });
  const data = encodeLinkConfirmData({ screenName: "taro_1", accepted: true });
  assertEquals(await handleLinkConfirm(client, "oa-1", "lu-1", data), [LINK_DONE_MESSAGE]);
  assertEquals(calls, [{
    fn: "link_by_screen_name",
    args: { p_oa_config_id: "oa-1", p_line_user_id: "lu-1", p_screen_name: "taro_1" },
  }]);
});

Deno.test("handleLinkConfirm: 更新0件 → 見つからない案内 / いいえ → RPCを呼ばず案内", async () => {
  const zero = fakeSupabase({ data: 0, error: null });
  const yes = encodeLinkConfirmData({ screenName: "taro_1", accepted: true });
  assertEquals(await handleLinkConfirm(zero.client, "oa-1", "lu-1", yes), [LINK_NOT_FOUND_MESSAGE]);
  const no = fakeSupabase({ data: 1, error: null });
  const nod = encodeLinkConfirmData({ screenName: "taro_1", accepted: false });
  assertEquals(await handleLinkConfirm(no.client, "oa-1", "lu-1", nod), [LINK_CANCEL_MESSAGE]);
  assertEquals(no.calls.length, 0);
});
