/**
 * admin/tests/integration/rls.test.ts
 * RLS マトリクステスト（成功条件6）
 *
 * ゲート: RLS_TEST=1 のときのみ実行（vitest.config.mts の include パターン）
 *
 * テスト対象:
 * - 可視性: user1(owner of dev-oa) が dev-oa-2 のデータを SELECT できない（0行）
 * - INSERT 拒否: user1 が dev-oa-2 のイベントを INSERT できない（エラー）
 * - UPDATE 0行: user1 が dev-oa-2 のイベントを UPDATE できない（0行 — silent）
 * - oa_configs UPDATE: user1 が dev-oa-2 を更新できない（0行）
 * - 紐付け整合性: with check 違反（cross-OA line_user への紐付け）がエラーになる
 * - oa_members INSERT: 直接 INSERT は全員に拒否（エラー）
 * - RPC 冪等0行: register_owner_by_identity が email identity のみユーザーに 0 行
 * - co-owner スコープ: user2 は dev-oa に co-owner として所属 → dev-oa の events SELECT 可
 *
 * 固定UUID (seed.sql より):
 *   dev-oa config:       00000000-0000-0000-0000-000000000001
 *   dev-event (oa-1):    00000000-0000-0000-0000-000000000002
 *   dev-epu (oa-1):      00000000-0000-0000-0000-000000000003
 *   dev-line-user (oa-1):00000000-0000-0000-0000-000000000004
 *   dev-participant:     00000000-0000-0000-0000-000000000005
 *   dev-oa-2 config:     00000000-0000-0000-0000-000000000011
 *   dev-event-2 (oa-2):  00000000-0000-0000-0000-000000000012
 *   dev-epu-2 (oa-2):    00000000-0000-0000-0000-000000000013
 *   dev-line-user-2 (oa-2): 00000000-0000-0000-0000-000000000014
 *   dev-participant-2:   00000000-0000-0000-0000-000000000015
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { connectDev, asUser } from "./rls.helpers";
import type postgres from "postgres";

const OA1_ID = "00000000-0000-0000-0000-000000000001";
const OA2_ID = "00000000-0000-0000-0000-000000000011";
const OA1_EVENT_ID = "00000000-0000-0000-0000-000000000002";
const OA2_EVENT_ID = "00000000-0000-0000-0000-000000000012";
const OA1_EPU_ID = "00000000-0000-0000-0000-000000000003";
const OA2_EPU_ID = "00000000-0000-0000-0000-000000000013";
const OA1_LINE_USER_ID = "00000000-0000-0000-0000-000000000004";
const OA2_LINE_USER_ID = "00000000-0000-0000-0000-000000000014";
const OA1_PARTICIPANT_ID = "00000000-0000-0000-0000-000000000005";

let sql: ReturnType<typeof connectDev>;
let user1Id: string;
let user2Id: string;

beforeAll(async () => {
  sql = connectDev();

  // oa_members から user1 (owner of dev-oa) と user2 (owner of dev-oa-2 / co-owner of dev-oa) を動的取得
  const members = await sql`
    select auth_user_id, oa_config_id, role
    from public.oa_members
    where oa_config_id in (${OA1_ID}, ${OA2_ID})
    order by created_at
  `;

  // user1: dev-oa の owner
  const user1Row = members.find(
    (m) => m.oa_config_id === OA1_ID && m.role === "owner",
  );
  if (!user1Row) {
    throw new Error(
      "dev-oa の owner が oa_members に見つかりません。setup-dev.ts を実行してください。",
    );
  }
  user1Id = user1Row.auth_user_id;

  // user2: dev-oa-2 の owner
  const user2Row = members.find(
    (m) => m.oa_config_id === OA2_ID && m.role === "owner",
  );
  if (!user2Row) {
    throw new Error(
      "dev-oa-2 の owner が oa_members に見つかりません。setup-dev.ts を実行してください。",
    );
  }
  user2Id = user2Row.auth_user_id;
});

afterAll(async () => {
  await sql.end();
});

// ===========================================================
// 可視性テスト: user1 が dev-oa-2 のデータを SELECT できない
// ===========================================================
describe("可視性: user1 は dev-oa-2 データを SELECT できない", () => {
  it("oa_configs: dev-oa-2 → 0行（自OA dev-oa → 1行以上）", async () => {
    // OA-2 は 0行
    const oa2Rows = await asUser(sql, user1Id, (tx) =>
      tx`select id from public.oa_configs where id = ${OA2_ID}`,
    );
    expect(oa2Rows.length).toBe(0);

    // 自 OA は 1行以上（0行罠の裏面を確認）
    const oa1Rows = await asUser(sql, user1Id, (tx) =>
      tx`select id from public.oa_configs where id = ${OA1_ID}`,
    );
    expect(oa1Rows.length).toBeGreaterThanOrEqual(1);
  });

  it("events: dev-oa-2 → 0行（自OA dev-oa → 1行以上）", async () => {
    const oa2Rows = await asUser(sql, user1Id, (tx) =>
      tx`select id from public.events where oa_config_id = ${OA2_ID}`,
    );
    expect(oa2Rows.length).toBe(0);

    const oa1Rows = await asUser(sql, user1Id, (tx) =>
      tx`select id from public.events where oa_config_id = ${OA1_ID}`,
    );
    expect(oa1Rows.length).toBeGreaterThanOrEqual(1);
  });

  it("event_platform_urls: dev-oa-2 イベント → 0行", async () => {
    const rows = await asUser(sql, user1Id, (tx) =>
      tx`select id from public.event_platform_urls where id = ${OA2_EPU_ID}`,
    );
    expect(rows.length).toBe(0);
  });

  it("participants: dev-oa-2 イベントの参加者 → 0行", async () => {
    const rows = await asUser(sql, user1Id, (tx) =>
      tx`select id from public.participants where event_platform_url_id = ${OA2_EPU_ID}`,
    );
    expect(rows.length).toBe(0);
  });

  it("line_users: dev-oa-2 の LINE ユーザー → 0行", async () => {
    const rows = await asUser(sql, user1Id, (tx) =>
      tx`select id from public.line_users where oa_config_id = ${OA2_ID}`,
    );
    expect(rows.length).toBe(0);
  });

  it("answers: dev-oa-2 の参加者の回答 → 0行", async () => {
    // OA2 の participant の answer を SELECT（RLS は answer → participant → epu → event → oa_members チェーン）
    const rows = await asUser(sql, user1Id, (tx) =>
      tx`
        select a.id from public.answers a
        join public.participants p on p.id = a.participant_id
        join public.event_platform_urls epu on epu.id = p.event_platform_url_id
        where epu.id = ${OA2_EPU_ID}
      `,
    );
    expect(rows.length).toBe(0);
  });
});

// ===========================================================
// INSERT 拒否: with check 違反は エラー
// ===========================================================
describe("INSERT 拒否: user1 は dev-oa-2 にイベントを INSERT できない", () => {
  it("dev-oa-2 への events INSERT → エラー（with check 違反）", async () => {
    await expect(
      asUser(sql, user1Id, (tx) =>
        tx`
          insert into public.events (oa_config_id, title, event_date, confirm_days_before)
          values (${OA2_ID}, 'hacked-event', current_date + 10, 7)
        `,
      ),
    ).rejects.toThrow();
  });

  it("自 OA (dev-oa) への events INSERT → 成功（テスト後ロールバック）", async () => {
    // begin は commit するので、INSERT した行を afterAll で削除する必要がある
    // SAVEPOINT でロールバック相当を実装（postgres.js では手動 SAVEPOINT/ROLLBACK TO）
    let insertedId: string | null = null;
    try {
      const result = await asUser(sql, user1Id, (tx) =>
        tx`
          insert into public.events (oa_config_id, title, event_date, confirm_days_before)
          values (${OA1_ID}, 'test-insert-event', current_date + 99, 7)
          returning id
        `,
      );
      expect(result.length).toBe(1);
      insertedId = result[0].id;
    } finally {
      // cleanup: 挿入した行を postgres ロールで削除（RLS なしで確実に削除）
      if (insertedId) {
        await sql`delete from public.events where id = ${insertedId}`;
      }
    }
  });
});

// ===========================================================
// UPDATE 0行: silent-0-row trap — エラーではなく 0行
// ===========================================================
describe("UPDATE 0行: user1 は dev-oa-2 のイベントを UPDATE できない（0行 — silent）", () => {
  it("events: dev-oa-2 のイベント title UPDATE → 0行（元データ不変）", async () => {
    // 事前: 元の title を取得
    const original = await sql`select title from public.events where id = ${OA2_EVENT_ID}`;
    expect(original.length).toBeGreaterThanOrEqual(1);
    const originalTitle = original[0].title;

    // UPDATE 試行（返却行数チェック）
    const updated = await asUser(sql, user1Id, (tx) =>
      tx`
        update public.events set title = 'hacked-title'
        where id = ${OA2_EVENT_ID}
        returning id
      `,
    );
    expect(updated.length).toBe(0); // silent 0行

    // 元データ不変を確認
    const after = await sql`select title from public.events where id = ${OA2_EVENT_ID}`;
    expect(after[0].title).toBe(originalTitle);
  });

  it("events: 自OA (dev-oa) のイベント title UPDATE → 1行（元値復元）", async () => {
    const original = await sql`select title from public.events where id = ${OA1_EVENT_ID}`;
    const originalTitle = original[0].title;

    try {
      const updated = await asUser(sql, user1Id, (tx) =>
        tx`
          update public.events set title = 'temp-updated-title'
          where id = ${OA1_EVENT_ID}
          returning id
        `,
      );
      expect(updated.length).toBe(1);
    } finally {
      // 元値復元（冪等性のため）
      await sql`update public.events set title = ${originalTitle} where id = ${OA1_EVENT_ID}`;
    }
  });

  it("oa_configs: dev-oa-2 の name UPDATE → 0行（元データ不変）", async () => {
    const original = await sql`select name from public.oa_configs where id = ${OA2_ID}`;
    const originalName = original[0].name;

    const updated = await asUser(sql, user1Id, (tx) =>
      tx`
        update public.oa_configs set name = 'hacked-oa'
        where id = ${OA2_ID}
        returning id
      `,
    );
    expect(updated.length).toBe(0);

    const after = await sql`select name from public.oa_configs where id = ${OA2_ID}`;
    expect(after[0].name).toBe(originalName);
  });

  it("oa_configs: 自OA (dev-oa) name UPDATE → 1行（元値復元）", async () => {
    const original = await sql`select name from public.oa_configs where id = ${OA1_ID}`;
    const originalName = original[0].name;

    try {
      const updated = await asUser(sql, user1Id, (tx) =>
        tx`
          update public.oa_configs set name = 'temp-oa-name'
          where id = ${OA1_ID}
          returning id
        `,
      );
      expect(updated.length).toBe(1);
    } finally {
      await sql`update public.oa_configs set name = ${originalName} where id = ${OA1_ID}`;
    }
  });
});

// ===========================================================
// 紐付け整合性: cross-OA line_user への紐付けは with check でエラー
// ===========================================================
describe("紐付け整合性（ADMIN-02 / T-03-02）", () => {
  it("自OA参加者 ...0005 の line_user_id を OA-2 の line_user ...0014 に UPDATE → エラー", async () => {
    // participants UPDATE with check: 行自体が自OA + 紐付け先 line_user も同一OA
    // OA2 の line_user を OA1 の participant に紐付けようとする → with check 違反 → エラー
    await expect(
      asUser(sql, user1Id, (tx) =>
        tx`
          update public.participants
          set line_user_id = ${OA2_LINE_USER_ID}
          where id = ${OA1_PARTICIPANT_ID}
          returning id
        `,
      ),
    ).rejects.toThrow();
  });

  it("自OA参加者 ...0005 の line_user_id を 自OA の line_user ...0004 に UPDATE → 1行（元値復元）", async () => {
    const original =
      await sql`select line_user_id from public.participants where id = ${OA1_PARTICIPANT_ID}`;
    const originalLineUserId = original[0].line_user_id;

    try {
      const updated = await asUser(sql, user1Id, (tx) =>
        tx`
          update public.participants
          set line_user_id = ${OA1_LINE_USER_ID}
          where id = ${OA1_PARTICIPANT_ID}
          returning id
        `,
      );
      expect(updated.length).toBe(1);
    } finally {
      await sql`
        update public.participants
        set line_user_id = ${originalLineUserId}
        where id = ${OA1_PARTICIPANT_ID}
      `;
    }
  });
});

// ===========================================================
// oa_members INSERT 拒否: authenticated に INSERT 権限なし
// ===========================================================
describe("oa_members INSERT 拒否", () => {
  it("user1 が自分を OA-2 に INSERT しようとする → エラー（ポリシーなし）", async () => {
    await expect(
      asUser(sql, user1Id, (tx) =>
        tx`
          insert into public.oa_members (oa_config_id, auth_user_id, role)
          values (${OA2_ID}, ${user1Id}, 'co-owner')
        `,
      ),
    ).rejects.toThrow();
  });
});

// ===========================================================
// RPC 冪等テスト: register_owner_by_identity
// ===========================================================
describe("RPC: register_owner_by_identity", () => {
  it("email identity のみの user1 → 0行（X identity なし）", async () => {
    const rows = await asUser(sql, user1Id, (tx) =>
      tx`select * from public.register_owner_by_identity()`,
    );
    expect(rows.length).toBe(0);
  });

  it("2回連続呼び出しで oa_members 行数不変（冪等）", async () => {
    const countBefore = await sql`select count(*) from public.oa_members`;
    const before = parseInt(countBefore[0].count, 10);

    // 2回呼ぶ
    await asUser(sql, user1Id, (tx) =>
      tx`select * from public.register_owner_by_identity()`,
    );
    await asUser(sql, user1Id, (tx) =>
      tx`select * from public.register_owner_by_identity()`,
    );

    const countAfter = await sql`select count(*) from public.oa_members`;
    const after = parseInt(countAfter[0].count, 10);
    expect(after).toBe(before);
  });
});

// ===========================================================
// co-owner スコープ（成功条件6）
// ===========================================================
describe("co-owner スコープ: user2 は dev-oa の co-owner", () => {
  it("user2 で dev-oa の events SELECT → 1行以上（owner と同一の可視性）", async () => {
    const rows = await asUser(sql, user2Id, (tx) =>
      tx`select id from public.events where oa_config_id = ${OA1_ID}`,
    );
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });

  it("user2 の oa_configs SELECT → dev-oa-2 (owner) と dev-oa (co-owner) の両方が現れる", async () => {
    const rows = await asUser(sql, user2Id, (tx) =>
      tx`select id from public.oa_configs order by created_at`,
    );
    const ids = rows.map((r) => r.id);
    // dev-oa と dev-oa-2 の両方が含まれること
    expect(ids).toContain(OA1_ID);
    expect(ids).toContain(OA2_ID);
  });
});
