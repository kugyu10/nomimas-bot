// 主催者 LINE 紐付け計画（scripts/lib/owner_line_link.ts）のテスト
// 実行: deno test --config supabase/functions/deno.json supabase/functions/tests/owner_line_link_test.ts

import { assertEquals } from "jsr:@std/assert";
import { parseCliArgs, parseLinkArgs, planLinks } from "../../../scripts/lib/owner_line_link.ts";

const OA1 = "11111111-1111-1111-1111-111111111111";
const OA2 = "22222222-2222-2222-2222-222222222222";
const U1 = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const U2 = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const L1 = "U" + "1".repeat(32);
const L2 = "U" + "2".repeat(32);

const members = [
  { id: "m1", oa_config_id: OA1, auth_user_id: U1, role: "owner", line_user_id: null },
  { id: "m2", oa_config_id: OA1, auth_user_id: U2, role: "co-owner", line_user_id: L2 },
];
const lineUsers = [
  { oa_config_id: OA1, line_user_id: L1 },
  { oa_config_id: OA1, line_user_id: L2 },
  { oa_config_id: OA2, line_user_id: "U" + "3".repeat(32) },
];

Deno.test("parseLinkArgs: 正しい形式を受理する", () => {
  const r = parseLinkArgs(["--link", `${OA1}:${U1}:${L1}`]);
  assertEquals(r.errors, []);
  assertEquals(r.requests, [{ oaConfigId: OA1, authUserId: U1, lineUserId: L1 }]);
});

Deno.test("parseLinkArgs: 形式不正・LINE userId 不正を弾く", () => {
  assertEquals(parseLinkArgs(["--link", "x:y:z"]).errors.length, 1);
  assertEquals(parseLinkArgs(["--link", `${OA1}:${U1}:Uabc`]).errors.length, 1);
  assertEquals(parseLinkArgs(["--link", `${OA1}:${U1}:${L1}:extra`]).errors.length, 1);
  assertEquals(parseLinkArgs(["--oops"]).errors.length, 1);
});

Deno.test("planLinks: 有効な要求は更新計画になる", () => {
  const p = planLinks([{ oaConfigId: OA1, authUserId: U1, lineUserId: L1 }], members, lineUsers);
  assertEquals(p.errors, []);
  assertEquals(p.updates.map((u) => u.memberId), ["m1"]);
});

Deno.test("planLinks: oa_members に無い組み合わせは弾く", () => {
  const p = planLinks([{ oaConfigId: OA2, authUserId: U1, lineUserId: L1 }], members, lineUsers);
  assertEquals(p.updates.length, 0);
  assertEquals(p.errors.length, 1);
});

Deno.test("planLinks: 別 OA の owner 行を他 OA の LINE で更新させない", () => {
  const p = planLinks(
    [{ oaConfigId: OA2, authUserId: U1, lineUserId: "U" + "3".repeat(32) }],
    members,
    lineUsers,
  );
  assertEquals(p.updates.length, 0);
  assertEquals(p.errors.length, 1);
});

Deno.test("planLinks: 他 OA の line_users にしか無い LINE userId は弾く", () => {
  const other = "U" + "3".repeat(32);
  const p = planLinks([{ oaConfigId: OA1, authUserId: U1, lineUserId: other }], members, lineUsers);
  assertEquals(p.updates.length, 0);
  assertEquals(p.errors.length, 1);
});

Deno.test("planLinks: 別メンバーが使用中の LINE userId は弾く", () => {
  const p = planLinks([{ oaConfigId: OA1, authUserId: U1, lineUserId: L2 }], members, lineUsers);
  assertEquals(p.updates.length, 0);
  assertEquals(p.errors.length, 1);
});

Deno.test("planLinks: 同一要求内で同じ LINE userId を2人に割り当てると後者を弾く", () => {
  const ms = [members[0], { ...members[1], line_user_id: null }];
  const p = planLinks(
    [
      { oaConfigId: OA1, authUserId: U1, lineUserId: L1 },
      { oaConfigId: OA1, authUserId: U2, lineUserId: L1 },
    ],
    ms,
    lineUsers,
  );
  assertEquals(p.updates.length, 1);
  assertEquals(p.errors.length, 1);
});

Deno.test("planLinks: 指定した member(m2) の行だけを更新対象にする", () => {
  const ms = [members[0], { ...members[1], line_user_id: null }];
  const p = planLinks([{ oaConfigId: OA1, authUserId: U2, lineUserId: L2 }], ms, lineUsers);
  assertEquals(p.errors, []);
  assertEquals(p.updates.map((u) => u.memberId), ["m2"]);
});

Deno.test("planLinks: 紐付け済みの本人への同じ --link は冪等に通る", () => {
  const p = planLinks([{ oaConfigId: OA1, authUserId: U2, lineUserId: L2 }], members, lineUsers);
  assertEquals(p.errors, []);
  assertEquals(p.updates.map((u) => u.memberId), ["m2"]);
});

Deno.test("planLinks: 更新計画に現在値が入る（上書きの検知用）", () => {
  const p = planLinks([{ oaConfigId: OA1, authUserId: U2, lineUserId: L1 }], members, lineUsers);
  assertEquals(p.errors, []);
  assertEquals(p.updates[0].current, L2);
  const q = planLinks([{ oaConfigId: OA1, authUserId: U1, lineUserId: L1 }], members, lineUsers);
  assertEquals(q.updates[0].current, null);
});

Deno.test("planLinks: 同じ member への --link 重複を弾く", () => {
  const ms = [members[0], { ...members[1], line_user_id: null }];
  const p = planLinks(
    [
      { oaConfigId: OA1, authUserId: U1, lineUserId: L1 },
      { oaConfigId: OA1, authUserId: U1, lineUserId: L2 },
    ],
    ms,
    lineUsers,
  );
  assertEquals(p.updates.length, 1);
  assertEquals(p.errors.length, 1);
});

Deno.test("parseLinkArgs: UUID だけが壊れた入力を弾く", () => {
  assertEquals(parseLinkArgs(["--link", `not-a-uuid:${U1}:${L1}`]).errors.length, 1);
  assertEquals(parseLinkArgs(["--link", `${OA1}:not-a-uuid:${L1}`]).errors.length, 1);
});

Deno.test("parseLinkArgs: 不明な引数はエラーにし、正しい --link は残す", () => {
  const r = parseLinkArgs(["--oops", "--link", `${OA1}:${U1}:${L1}`]);
  assertEquals(r.errors.length, 1);
  assertEquals(r.errors[0].includes("不明な引数"), true);
  assertEquals(r.requests.length, 1);
});

Deno.test("parseCliArgs: --apply なしは dry-run（apply=false）", () => {
  const r = parseCliArgs(["--link", `${OA1}:${U1}:${L1}`]);
  assertEquals(r.errors, []);
  assertEquals(r.apply, false);
  assertEquals(r.requests.length, 1);
});

Deno.test("parseCliArgs: --apply と --link が揃えば apply=true", () => {
  const r = parseCliArgs(["--link", `${OA1}:${U1}:${L1}`, "--apply"]);
  assertEquals(r.errors, []);
  assertEquals(r.apply, true);
});

Deno.test("parseCliArgs: --apply だけ（--link なし）はエラー", () => {
  assertEquals(parseCliArgs(["--apply"]).errors.length, 1);
});

Deno.test("parseCliArgs: 引数なしは一覧モード（apply=false, エラーなし）", () => {
  const r = parseCliArgs([]);
  assertEquals(r.errors, []);
  assertEquals(r.apply, false);
  assertEquals(r.requests, []);
});
