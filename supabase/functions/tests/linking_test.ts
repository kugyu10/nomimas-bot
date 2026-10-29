import { assertEquals } from "jsr:@std/assert";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  decodeLinkConfirmData,
  encodeLinkConfirmData,
  handleLinkConfirm,
  handleLinkMessage,
  LINK_ALREADY_MESSAGE,
  LINK_LIMIT_MESSAGE,
  type LinkDeps,
  processLinkMessageEvent,
  processLinkPostbackEvent,
  LINK_CANCEL_MESSAGE,
  LINK_DONE_MESSAGE,
  LINK_NOT_FOUND_MESSAGE,
  normalizeScreenName,
} from "../_shared/confirm/linking.ts";

interface RpcCall { fn: string; args: Record<string, unknown> }
type RpcResult = { data: unknown; error: { message: string } | null };
const LU = { id: "lu-uuid", display_name: "太郎LINE" };

function fakeSupabase(rpcResult: RpcResult, lineUser: typeof LU | null = LU) {
  const calls: RpcCall[] = [];
  const filters: [string, unknown][] = [];
  const chain = {
    select: () => chain,
    eq: (col: string, v: unknown) => {
      filters.push([col, v]);
      return chain;
    },
    single: () => Promise.resolve({ data: lineUser, error: null }),
  };
  const client = {
    rpc(fn: string, args: Record<string, unknown>) {
      calls.push({ fn, args });
      return Promise.resolve(rpcResult);
    },
    from: (table: string) => {
      if (table !== "line_users") throw new Error(`unexpected table ${table}`);
      return chain;
    },
  } as unknown as SupabaseClient;
  return { client, calls, filters };
}

function fakeDeps(rpcResult: RpcResult, lineUser: typeof LU | null = LU) {
  const f = fakeSupabase(rpcResult, lineUser);
  const replies: { replyToken: string; messages: object[] }[] = [];
  const notices: string[] = [];
  const deps: LinkDeps = {
    supabase: f.client,
    oaConfigId: "oa-1",
    getToken: () => Promise.resolve("tok"),
    reply: (_t, replyToken, messages) => {
      replies.push({ replyToken, messages });
      return Promise.resolve();
    },
    notifyOwners: (oaConfigId, text) => {
      notices.push(`${oaConfigId}|${text}`);
      return Promise.resolve();
    },
  };
  return { ...f, deps, replies, notices };
}

const SENDER = { id: "lu-uuid", displayName: "太郎LINE" };
const row = (outcome: string, display_name: string | null = null, notify = false) => ({
  data: [{ outcome, display_name, notify }],
  error: null,
});
const yes = encodeLinkConfirmData({ screenName: "taro_1", accepted: true });

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

Deno.test("handleLinkMessage: candidate → 表示名入りの確認、正規化した名前と line_users.id でRPC", async () => {
  const { client, calls } = fakeSupabase(row("candidate", "太郎"));
  const r = await handleLinkMessage(client, "oa-1", SENDER, "@Taro_1");
  assertEquals(calls, [{
    fn: "find_link_candidate",
    args: { p_oa_config_id: "oa-1", p_screen_name: "Taro_1", p_line_user_id: "lu-uuid" },
  }]);
  const m = r!.messages[0] as { text: string; quickReply: { items: { action: { data: string } }[] } };
  assertEquals(m.text.includes("太郎"), true);
  assertEquals(decodeLinkConfirmData(m.quickReply.items[0].action.data)?.accepted, true);
  assertEquals(decodeLinkConfirmData(m.quickReply.items[1].action.data)?.accepted, false);
  assertEquals(r!.ownerNotice, undefined);
});

Deno.test("handleLinkMessage: already / limit / not_found / 空 → 各案内、普通の会話は null でRPCも呼ばない", async () => {
  const t = async (res: RpcResult) =>
    (await handleLinkMessage(fakeSupabase(res).client, "oa-1", SENDER, "@x"))!;
  assertEquals((await t(row("already"))).messages, [LINK_ALREADY_MESSAGE]);
  assertEquals((await t(row("limit"))).messages, [LINK_LIMIT_MESSAGE]);
  assertEquals((await t(row("not_found"))).messages, [LINK_NOT_FOUND_MESSAGE]);
  assertEquals((await t({ data: [], error: null })).messages, [LINK_NOT_FOUND_MESSAGE]);
  const chat = fakeSupabase(row("candidate", "x"));
  assertEquals(await handleLinkMessage(chat.client, "oa-1", SENDER, "hello"), null);
  assertEquals(chat.calls.length, 0);
});

Deno.test("handleLinkMessage: taken → 本人には見つからない案内、主催者へ拒否通知", async () => {
  const r = await handleLinkMessage(fakeSupabase(row("taken", null, true)).client, "oa-1", SENDER, "@taro_1");
  assertEquals(r!.messages, [LINK_NOT_FOUND_MESSAGE]);
  assertEquals(r!.ownerNotice?.includes("@taro_1") && r!.ownerNotice.includes("太郎LINE"), true);
});

Deno.test("handleLinkMessage: taken でも notify=false（通知済み）なら主催者通知を付けない", async () => {
  const r = await handleLinkMessage(fakeSupabase(row("taken", null, false)).client, "oa-1", SENDER, "@taro_1");
  assertEquals(r!.messages, [LINK_NOT_FOUND_MESSAGE]);
  assertEquals(r!.ownerNotice, undefined);
});

Deno.test("handleLinkMessage: RPCエラー → null（何も返信しない）", async () => {
  const r = await handleLinkMessage(fakeSupabase({ data: null, error: { message: "boom" } }).client, "oa-1", SENDER, "@taro_1");
  assertEquals(r, null);
});

Deno.test("handleLinkConfirm: はい → link_by_screen_name を line_users.id つきで呼び、主催者通知つき", async () => {
  const { client, calls } = fakeSupabase({ data: 2, error: null });
  const r = await handleLinkConfirm(client, "oa-1", SENDER, yes);
  assertEquals(r!.messages, [LINK_DONE_MESSAGE]);
  assertEquals(r!.ownerNotice?.includes("@taro_1"), true);
  assertEquals(calls, [{
    fn: "link_by_screen_name",
    args: { p_oa_config_id: "oa-1", p_line_user_id: "lu-uuid", p_screen_name: "taro_1" },
  }]);
});

Deno.test("handleLinkConfirm: 更新0件 → 見つからない案内（通知なし） / いいえ → RPCを呼ばず案内", async () => {
  const zero = await handleLinkConfirm(fakeSupabase({ data: 0, error: null }).client, "oa-1", SENDER, yes);
  assertEquals(zero, { messages: [LINK_NOT_FOUND_MESSAGE] });
  const no = fakeSupabase({ data: 1, error: null });
  const nod = encodeLinkConfirmData({ screenName: "taro_1", accepted: false });
  assertEquals(await handleLinkConfirm(no.client, "oa-1", SENDER, nod), { messages: [LINK_CANCEL_MESSAGE] });
  assertEquals(no.calls.length, 0);
});

Deno.test("handleLinkConfirm: RPCエラー → null（完了と言わない）", async () => {
  const r = await handleLinkConfirm(fakeSupabase({ data: null, error: { message: "boom" } }).client, "oa-1", SENDER, yes);
  assertEquals(r, null);
});

Deno.test("processLinkPostbackEvent: LINEのuserId から line_users.id を引いて RPC に渡し、返信と主催者通知を出す", async () => {
  const f = fakeDeps({ data: 1, error: null });
  await processLinkPostbackEvent(f.deps, { userId: "Uline", replyToken: "rt", data: yes });
  assertEquals(f.filters, [["oa_config_id", "oa-1"], ["line_user_id", "Uline"]]);
  assertEquals(f.calls[0].args.p_line_user_id, "lu-uuid");
  assertEquals(f.replies, [{ replyToken: "rt", messages: [LINK_DONE_MESSAGE] }]);
  assertEquals(f.notices.length, 1);
});

Deno.test("processLinkPostbackEvent: line_users が無ければ何もしない / RPCエラーなら返信しない", async () => {
  const none = fakeDeps({ data: 1, error: null }, null);
  await processLinkPostbackEvent(none.deps, { userId: "Uline", replyToken: "rt", data: yes });
  assertEquals([none.calls.length, none.replies.length], [0, 0]);
  const err = fakeDeps({ data: null, error: { message: "boom" } });
  await processLinkPostbackEvent(err.deps, { userId: "Uline", replyToken: "rt", data: yes });
  assertEquals([err.replies.length, err.notices.length], [0, 0]);
});

Deno.test("processLinkMessageEvent: @形式なら find_link_candidate → 確認を返信、taken なら主催者通知、普通の会話は無視", async () => {
  const f = fakeDeps(row("candidate", "太郎"));
  await processLinkMessageEvent(f.deps, { userId: "Uline", replyToken: "rt", text: "@taro_1" });
  assertEquals(f.calls[0].args.p_line_user_id, "lu-uuid");
  assertEquals(f.replies.length, 1);
  const taken = fakeDeps(row("taken", null, true));
  await processLinkMessageEvent(taken.deps, { userId: "Uline", replyToken: "rt", text: "@taro_1" });
  assertEquals(taken.notices.length, 1);
  assertEquals(taken.notices[0].startsWith("oa-1|"), true);
  const dup = fakeDeps(row("taken", null, false));
  await processLinkMessageEvent(dup.deps, { userId: "Uline", replyToken: "rt", text: "@taro_1" });
  assertEquals([dup.replies.length, dup.notices.length], [1, 0]);
  const chat = fakeDeps(row("candidate", "太郎"));
  await processLinkMessageEvent(chat.deps, { userId: "Uline", replyToken: "rt", text: "こんにちは" });
  assertEquals([chat.calls.length, chat.replies.length], [0, 0]);
});

Deno.test("process*: 返信が失敗しても主催者通知は試みる", async () => {
  const f = fakeDeps({ data: 1, error: null });
  f.deps.reply = () => Promise.reject(new Error("reply down"));
  await processLinkPostbackEvent(f.deps, { userId: "Uline", replyToken: "rt", data: yes });
  assertEquals(f.notices.length, 1);
});
