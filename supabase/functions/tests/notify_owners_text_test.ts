// notifyOwnersText: 送信先の絞り込みと push 先の取り違えを守る（fetch スタブ。実ネットなし）

import { assertEquals } from "jsr:@std/assert";
import type { SupabaseClient } from "@supabase/supabase-js";
import { notifyOwnersText } from "../_shared/notify/notifier.ts";

function fakeSupabase(members: { line_user_id: string | null }[]) {
  const filters: [string, string][] = [];
  const builder = {
    select: () => builder,
    eq: (col: string, val: string) => {
      filters.push([col, val]);
      return Promise.resolve({ data: members, error: null });
    },
  };
  const client = { from: (_t: string) => builder } as unknown as SupabaseClient;
  return { client, filters };
}

Deno.test("notifyOwnersText: oa_members を oa_config_id で絞り、各 line_user_id に push、null はスキップ", async () => {
  const orig = globalThis.fetch;
  const pushed: { to: string; text: string }[] = [];
  globalThis.fetch = (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const body = JSON.parse(init!.body as string);
    pushed.push({ to: body.to, text: body.messages[0].text });
    return Promise.resolve(new Response("{}", { status: 200 }));
  };
  try {
    const f = fakeSupabase([{ line_user_id: "U1" }, { line_user_id: null }, { line_user_id: "U2" }]);
    const r = await notifyOwnersText(f.client, () => Promise.resolve("tok"), "oa-1", "hello");
    assertEquals(f.filters, [["oa_config_id", "oa-1"]]);
    assertEquals(pushed, [{ to: "U1", text: "hello" }, { to: "U2", text: "hello" }]);
    assertEquals(r, { sent: 2, failed: 0 });
  } finally {
    globalThis.fetch = orig;
  }
});
