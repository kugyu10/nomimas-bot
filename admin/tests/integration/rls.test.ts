/**
 * admin/tests/integration/rls.test.ts
 * RLS マトリクステスト（成功条件6 + OA-02 root 完成・成功条件3）
 *
 * ゲート: RLS_TEST=1 のときのみ実行（vitest.config.mts の include パターン）
 *
 * テスト対象（既存）:
 * - 可視性: user1(owner of dev-oa) が dev-oa-2 のデータを SELECT できない（0行）
 * - INSERT 拒否: user1 が dev-oa-2 のイベントを INSERT できない（エラー）
 * - UPDATE 0行: user1 が dev-oa-2 のイベントを UPDATE できない（0行 — silent）
 * - oa_configs UPDATE: user1 が dev-oa-2 を更新できない（0行）
 * - 紐付け整合性: with check 違反（cross-OA line_user への紐付け）がエラーになる
 * - oa_members INSERT: 直接 INSERT は全員に拒否（エラー）
 * - RPC 冪等0行: register_owner_by_identity が email identity のみユーザーに 0 行
 * - co-owner スコープ: user2 は dev-oa に co-owner として所属 → dev-oa の events SELECT 可
 *
 * テスト対象（Phase 4 追加 — Task 3）:
 * - root 横断閲覧: root が両OAの全テーブルを SELECT でき、owner(user1) との権限差を同一テスト内で対比
 * - root SELECT-only: root の UPDATE 0行 / INSERT 拒否 / root_users 不可視 / root_users INSERT 不可
 * - question_templates RLS: OA スコープ + root 全件 SELECT
 * - notification_logs RLS: 固定UUID スコープ（波2並列安全）
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
const OA2_PARTICIPANT_ID = "00000000-0000-0000-0000-000000000015";

let sql: ReturnType<typeof connectDev>;
let user1Id: string;
let user2Id: string;
let rootId: string;

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

  // root: root_users から動的取得（setup-dev.ts が投入）
  const rootRows = await sql`select auth_user_id from public.root_users limit 1`;
  if (!rootRows[0]) {
    throw new Error("root_users が空です。setup-dev.ts を実行してください。");
  }
  rootId = rootRows[0].auth_user_id;
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
// RPC: create_event_with_urls（03-REVIEW WR-04 — SECURITY INVOKER で RLS 適用）
// ===========================================================
describe("RPC: create_event_with_urls は invoker 権限で RLS が効く", () => {
  it("user1 が dev-oa-2 のイベントを RPC 経由で作成 → エラー（with check 違反）+ 孤児なし", async () => {
    // 注: postgres.js で jsonb パラメータを渡すときは sql.json() を使う
    // （JSON.stringify した文字列を ::jsonb キャストすると jsonb 文字列スカラーに
    //   二重エンコードされ、->> がすべて null を返す）
    const eventParam = sql.json({
      oa_config_id: OA2_ID,
      title: "hacked-rpc-event",
      event_date: "2026-12-31",
      confirm_days_before: 7,
    });
    const urlsParam = sql.json([
      { platform: "twipla", url: "https://twipla.jp/events/999999901" },
    ]);

    await expect(
      asUser(sql, user1Id, (tx) =>
        tx`select public.create_event_with_urls(${eventParam}::jsonb, ${urlsParam}::jsonb)`,
      ),
    ).rejects.toThrow();

    // RPC 全体が単一トランザクション: 孤児 events 行が残らない（postgres ロールで確認）
    const orphans = await sql`select id from public.events where title = 'hacked-rpc-event'`;
    expect(orphans.length).toBe(0);
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

// ===========================================================
// RPC: register_owner_by_identity — ケース非区別照合（03-REVIEW WR-06）
// X の screen_name は case-insensitive。identity が "CaseTest_Owner" を返し
// 管理者が "casetest_owner" と入力していても owner 登録が成立すること
// ===========================================================
describe("RPC: register_owner_by_identity は screen_name をケース非区別で照合する", () => {
  const PROVIDER_ID = "wr06-case-test";

  it("identity=Mixed-case / admin_twitter_id=lowercase でも owner 登録される", async () => {
    // 事前状態の保存（postgres ロール）
    const original =
      await sql`select admin_twitter_id from public.oa_configs where id = ${OA2_ID}`;
    const originalAdminTwitterId = original[0].admin_twitter_id;

    try {
      // 1. OA-2 の admin_twitter_id を小文字で設定
      await sql`
        update public.oa_configs
        set admin_twitter_id = 'casetest_owner'
        where id = ${OA2_ID}
      `;

      // 2. user1 に X identity（混在ケースの user_name）を一時付与
      // sql.json(): 文字列の ::jsonb キャストは二重エンコードされるため必須
      await sql`
        insert into auth.identities
          (id, provider_id, user_id, identity_data, provider,
           last_sign_in_at, created_at, updated_at)
        values
          (gen_random_uuid(), ${PROVIDER_ID}, ${user1Id},
           ${sql.json({ sub: PROVIDER_ID, user_name: "CaseTest_Owner" })},
           'x', now(), now(), now())
      `;

      // 3. RPC 実行 → OA-2 が返る（lower() 両辺照合）
      const rows = await asUser(sql, user1Id, (tx) =>
        tx`select * from public.register_owner_by_identity()`,
      );
      const returnedIds = rows.map((r) => r.register_owner_by_identity);
      expect(returnedIds).toContain(OA2_ID);

      // 4. oa_members に owner 行が作成されている
      const members = await sql`
        select role from public.oa_members
        where oa_config_id = ${OA2_ID} and auth_user_id = ${user1Id}
      `;
      expect(members.length).toBe(1);
      expect(members[0].role).toBe("owner");
    } finally {
      // クリーンアップ（postgres ロール — 冪等）
      await sql`
        delete from public.oa_members
        where oa_config_id = ${OA2_ID} and auth_user_id = ${user1Id}
      `;
      await sql`
        delete from auth.identities
        where provider_id = ${PROVIDER_ID} and provider = 'x'
      `;
      await sql`
        update public.oa_configs
        set admin_twitter_id = ${originalAdminTwitterId}
        where id = ${OA2_ID}
      `;
    }
  });
});

// ===========================================================
// root 横断閲覧（OA-02 完成・成功条件3）
// ROADMAP 成功条件3: root が全OA・全イベント・全データを横断閲覧でき、
//   owner/co-owner スコープとの権限差がテストで検証できる
// ===========================================================
describe("root 横断閲覧（OA-02完成・成功条件3）", () => {
  it("root は両OAの oa_configs を SELECT できる（2行）— owner(user1) は同クエリで 1行（権限差対比）", async () => {
    // root が両OA を SELECT（横断閲覧）
    const rootOas = await asUser(sql, rootId, (tx) =>
      tx`select id from public.oa_configs where id in (${OA1_ID}, ${OA2_ID})`,
    );
    expect(rootOas.length).toBe(2);

    // owner(user1) は自OA(OA1)のみ
    const ownerOas = await asUser(sql, user1Id, (tx) =>
      tx`select id from public.oa_configs where id in (${OA1_ID}, ${OA2_ID})`,
    );
    expect(ownerOas.length).toBe(1);
    expect(ownerOas[0].id).toBe(OA1_ID);
  });

  it("root は両OAの events を SELECT できる（2行以上）", async () => {
    const rootEvents = await asUser(sql, rootId, (tx) =>
      tx`select id from public.events where oa_config_id in (${OA1_ID}, ${OA2_ID})`,
    );
    expect(rootEvents.length).toBeGreaterThanOrEqual(2);
  });

  it("root は両OAの participants を SELECT できる（OA2 の参加者も可視）", async () => {
    // OA2 participants（user1 には 0行だが root には見える — 上の可視性テストと対比）
    // 04-REVIEW WR-06: seed の dev-participant-2 (...0015) が root に可視であることを
    // 実際に assert する（>= 0 では root SELECT ポリシーの退行を検知できない）
    const rootParticipants = await asUser(sql, rootId, (tx) =>
      tx`select id from public.participants where event_platform_url_id = ${OA2_EPU_ID}`,
    );
    expect(rootParticipants.length).toBeGreaterThanOrEqual(1);
    expect(rootParticipants.map((r) => r.id)).toContain(OA2_PARTICIPANT_ID);

    // OA1 の参加者は取得できる
    const oa1Participants = await asUser(sql, rootId, (tx) =>
      tx`select id from public.participants where event_platform_url_id = ${OA1_EPU_ID}`,
    );
    expect(oa1Participants.length).toBeGreaterThanOrEqual(1);
  });

  it("root の oa_configs UPDATE → 0行（SELECT-only — T-04-12 退行検知）", async () => {
    const original = await sql`select name from public.oa_configs where id = ${OA1_ID}`;
    const originalName = original[0].name;

    const updated = await asUser(sql, rootId, (tx) =>
      tx`update public.oa_configs set name = 'root-hacked' where id = ${OA1_ID} returning id`,
    );
    expect(updated.length).toBe(0); // SELECT-only: 書込ポリシーなし → 0行

    // 元データ不変を確認
    const after = await sql`select name from public.oa_configs where id = ${OA1_ID}`;
    expect(after[0].name).toBe(originalName);
  });

  it("root の events INSERT → エラー（with check 違反 — SELECT-only）", async () => {
    await expect(
      asUser(sql, rootId, (tx) =>
        tx`
          insert into public.events (oa_config_id, title, event_date, confirm_days_before)
          values (${OA1_ID}, 'root-insert', current_date + 10, 7)
        `,
      ),
    ).rejects.toThrow();
  });

  it("root_users 自体は root（authenticated）からも 0行（存在秘匿 — T-04-12）", async () => {
    const rows = await asUser(sql, rootId, (tx) =>
      tx`select * from public.root_users`,
    );
    expect(rows.length).toBe(0);
  });

  it("通常ユーザー(user1) が root_users へ INSERT できない（権限昇格防止 — T-04-12）", async () => {
    await expect(
      asUser(sql, user1Id, (tx) =>
        tx`insert into public.root_users (auth_user_id) values (${user1Id})`,
      ),
    ).rejects.toThrow();
  });
});

// ===========================================================
// question_templates RLS（OA スコープ + root 全件 SELECT）
// ===========================================================
describe("question_templates RLS", () => {
  // service role で fixture テンプレートを OA1/OA2 に各1件投入し afterAll で削除
  let tplOa1Id: string;
  let tplOa2Id: string;

  beforeAll(async () => {
    const r1 = await sql`
      insert into public.question_templates (oa_config_id, name, questions)
      values (
        ${OA1_ID},
        'RLS テスト OA1 テンプレート',
        ${sql.json([{ id: "q1", text: "質問1", options: ["A"] }])}
      )
      returning id
    `;
    tplOa1Id = r1[0].id;

    const r2 = await sql`
      insert into public.question_templates (oa_config_id, name, questions)
      values (
        ${OA2_ID},
        'RLS テスト OA2 テンプレート',
        ${sql.json([{ id: "q1", text: "質問1", options: ["A"] }])}
      )
      returning id
    `;
    tplOa2Id = r2[0].id;
  });

  afterAll(async () => {
    await sql`delete from public.question_templates where id in (${tplOa1Id}, ${tplOa2Id})`;
  });

  it("user1 は OA2 のテンプレートを SELECT できない（0行）", async () => {
    const rows = await asUser(sql, user1Id, (tx) =>
      tx`select id from public.question_templates where id = ${tplOa2Id}`,
    );
    expect(rows.length).toBe(0);
  });

  it("user1 は OA2 へのテンプレート INSERT が拒否される（with check 違反）", async () => {
    await expect(
      asUser(sql, user1Id, (tx) =>
        tx`
          insert into public.question_templates (oa_config_id, name, questions)
          values (${OA2_ID}, 'user1-illegal', ${sql.json([])})
        `,
      ),
    ).rejects.toThrow();
  });

  it("user1 は自OA(OA1) へのテンプレート INSERT 成功（テスト後削除）", async () => {
    let insertedId: string | null = null;
    try {
      const result = await asUser(sql, user1Id, (tx) =>
        tx`
          insert into public.question_templates (oa_config_id, name, questions)
          values (${OA1_ID}, 'user1-oa1-tpl', ${sql.json([])})
          returning id
        `,
      );
      expect(result.length).toBe(1);
      insertedId = result[0].id;
    } finally {
      if (insertedId) {
        await sql`delete from public.question_templates where id = ${insertedId}`;
      }
    }
  });

  it("root は両OAのテンプレートを SELECT できる（全件表示）", async () => {
    const rows = await asUser(sql, rootId, (tx) =>
      tx`select id from public.question_templates where id in (${tplOa1Id}, ${tplOa2Id})`,
    );
    expect(rows.length).toBe(2);
  });
});

// ===========================================================
// notification_logs RLS
// 固定UUID フィクスチャを OA2 配下に投入し、アサートを固定UUID にスコープ
// （Wave 2 並列: 04-02 が OA1 配下に logs 行を生成するため unscoped 件数 assert は禁止）
// ===========================================================
describe("notification_logs RLS", () => {
  // 固定 UUID（衝突防止のため専用 UUID）
  const FIXTURE_LOG_ID = "aaaaaaaa-0403-0403-0403-000000000001";

  beforeAll(async () => {
    // 既存の fixture 行を削除してから INSERT（冪等）
    await sql`delete from public.notification_logs where id = ${FIXTURE_LOG_ID}`;
    await sql`
      insert into public.notification_logs
        (id, oa_config_id, event_id, kind, recipients, sent, failed, skipped_no_line_id)
      values
        (
          ${FIXTURE_LOG_ID},
          ${OA2_ID},
          ${OA2_EVENT_ID},
          'answer',
          1, 1, 0, 0
        )
    `;
  });

  afterAll(async () => {
    await sql`delete from public.notification_logs where id = ${FIXTURE_LOG_ID}`;
  });

  it("user1（OA1 owner）は OA2 配下の notification_logs を SELECT できない（0行）", async () => {
    const rows = await asUser(sql, user1Id, (tx) =>
      tx`select id from public.notification_logs where id = ${FIXTURE_LOG_ID}`,
    );
    expect(rows.length).toBe(0);
  });

  it("root は OA2 配下の notification_logs を SELECT できる（1行）", async () => {
    const rows = await asUser(sql, rootId, (tx) =>
      tx`select id from public.notification_logs where id = ${FIXTURE_LOG_ID}`,
    );
    expect(rows.length).toBe(1);
  });

  it("user1 は notification_logs に INSERT できない（書込ポリシーなし）", async () => {
    await expect(
      asUser(sql, user1Id, (tx) =>
        tx`
          insert into public.notification_logs
            (oa_config_id, event_id, kind, recipients, sent, failed, skipped_no_line_id)
          values (${OA1_ID}, ${OA1_EVENT_ID}, 'answer', 0, 0, 0, 0)
        `,
      ),
    ).rejects.toThrow();
  });
});
