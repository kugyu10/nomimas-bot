/**
 * e2e_targets_test.ts
 * 抽出ロジック境界E2E + sent遷移検証
 *
 * ゲート: E2E_TEST !== "1" の場合は全テストを ignore（Phase 1 の LIVE_TEST パターン踏襲）
 *
 * テスト要件（02-03 Plan acceptance criteria）:
 *   (a) 窓内・linked・pending・attending = get_confirm_targets() に含まれる
 *   (b) event_date が confirm_days_before 超 = 除外
 *   (c) confirm_status='sent' = 除外
 *   (d) status='interested' = 除外
 *   (e) line_user_id null = 除外 + count_unlinked_confirm_targets で計上
 *   (f) event_date null = 除外
 *
 * sent遷移E2E:
 *   seed participant (…0005) を pending にリセット → curl message-sender →
 *   レスポンス sent>=1 → DB上で confirm_status='sent' を assert →
 *   テスト末尾で pending に復元（02-04 フルE2E再利用のため）
 *
 * 注意:
 *   - フィクスチャUUIDスコープで assert（seed …0005 等の非フィクスチャ行は無視）
 *   - 実行後に自前フィクスチャを全削除（finally）
 *   - LINE_DRY_RUN=1 のためLINE APIは呼ばれない
 */

import {
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { connectDev } from "../../../scripts/db/sql.ts";

// E2E ゲート（--allow-env なしで実行された場合も例外にせず ignore 扱い — Phase 1の LIVE_TEST パターン踏襲）
function isE2eEnabled(): boolean {
  try {
    return Deno.env.get("E2E_TEST") === "1";
  } catch {
    return false;
  }
}
const IS_E2E = isE2eEnabled();

// --- フィクスチャ UUID（実 seed UUIDとの衝突を避ける固定値） ---
const FX = {
  oaConfigId: "00000000-0000-0000-0000-000000000001", // 既存 dev-oa を再利用

  // (a) 対象: 窓内・linked・pending・attending
  lineUserA: "00000000-0000-0000-e2e0-000000000001",
  eventA: "00000000-0000-0000-e2e0-000000000002",
  epuA: "00000000-0000-0000-e2e0-000000000003",
  participantA: "00000000-0000-0000-e2e0-000000000004",

  // (b) 除外: event_date が confirm_days_before 超
  lineUserB: "00000000-0000-0000-e2e0-000000000011",
  eventB: "00000000-0000-0000-e2e0-000000000012",
  epuB: "00000000-0000-0000-e2e0-000000000013",
  participantB: "00000000-0000-0000-e2e0-000000000014",

  // (c) 除外: confirm_status='sent' — イベントは (a) の eventA を共用（IN-03: 専用イベントは作らない）
  epuC: "00000000-0000-0000-e2e0-000000000023",
  participantC: "00000000-0000-0000-e2e0-000000000024",

  // (d) 除外: status='interested'
  participantD: "00000000-0000-0000-e2e0-000000000034",

  // (e) 除外: line_user_id null（count_unlinked で計上）
  participantE: "00000000-0000-0000-e2e0-000000000044",

  // (f) 除外: event_date null
  lineUserF: "00000000-0000-0000-e2e0-000000000051",
  eventF: "00000000-0000-0000-e2e0-000000000052",
  epuF: "00000000-0000-0000-e2e0-000000000053",
  participantF: "00000000-0000-0000-e2e0-000000000054",

  // 共有 LINE user (reusable for c/d/e cases that can use event A's EPU)
  lineUserCDE: "00000000-0000-0000-e2e0-000000000060",
};

// --- .env.local（ルート） から SUPABASE_ANON_KEY と DEV_PROJECT_REF を取得 ---
function getRequiredEnv(name: string): string {
  const val = Deno.env.get(name) ?? "";
  if (!val) throw new Error(`Missing env: ${name}`);
  return val;
}

Deno.test({
  name: "e2e: get_confirm_targets 抽出境界 6ケース (a:対象, b-f:除外)",
  ignore: !IS_E2E,
  async fn() {
    const sql = connectDev();

    try {
      // --- フィクスチャ投入 ---
      // LINE user (a)
      await sql`
        INSERT INTO public.line_users (id, oa_config_id, line_user_id, display_name)
        VALUES (${FX.lineUserA}, ${FX.oaConfigId}, 'Ue2e0000000000001', 'fx-user-a')
        ON CONFLICT (id) DO NOTHING
      `;

      // EVENT (a): 窓内
      await sql`
        INSERT INTO public.events (id, oa_config_id, title, event_date, confirm_days_before)
        VALUES (${FX.eventA}, ${FX.oaConfigId}, 'fx-event-a', current_date + 3, 7)
        ON CONFLICT (id) DO NOTHING
      `;
      await sql`
        INSERT INTO public.event_platform_urls (id, event_id, platform, url)
        VALUES (${FX.epuA}, ${FX.eventA}, 'twipla', 'https://twipla.jp/fx-a')
        ON CONFLICT (id) DO NOTHING
      `;
      // (a) 対象: attending + pending + linked
      await sql`
        INSERT INTO public.participants (id, event_platform_url_id, display_name, natural_key, status, line_user_id, confirm_status, current_question_index)
        VALUES (${FX.participantA}, ${FX.epuA}, 'fx-p-a', 'dn:fx-p-a', 'attending', ${FX.lineUserA}, 'pending', 0)
        ON CONFLICT (id) DO NOTHING
      `;

      // (b) 除外: event_date が confirm_days_before(7) 超（100日後 — TZ差分を超えた安全マージン）
      await sql`
        INSERT INTO public.line_users (id, oa_config_id, line_user_id, display_name)
        VALUES (${FX.lineUserB}, ${FX.oaConfigId}, 'Ue2e0000000000002', 'fx-user-b')
        ON CONFLICT (id) DO NOTHING
      `;
      await sql`
        INSERT INTO public.events (id, oa_config_id, title, event_date, confirm_days_before)
        VALUES (${FX.eventB}, ${FX.oaConfigId}, 'fx-event-b', current_date + 100, 7)
        ON CONFLICT (id) DO NOTHING
      `;
      await sql`
        INSERT INTO public.event_platform_urls (id, event_id, platform, url)
        VALUES (${FX.epuB}, ${FX.eventB}, 'twipla', 'https://twipla.jp/fx-b')
        ON CONFLICT (id) DO NOTHING
      `;
      await sql`
        INSERT INTO public.participants (id, event_platform_url_id, display_name, natural_key, status, line_user_id, confirm_status, current_question_index)
        VALUES (${FX.participantB}, ${FX.epuB}, 'fx-p-b', 'dn:fx-p-b', 'attending', ${FX.lineUserB}, 'pending', 0)
        ON CONFLICT (id) DO NOTHING
      `;

      // LINE user for c/d/e (shared)
      await sql`
        INSERT INTO public.line_users (id, oa_config_id, line_user_id, display_name)
        VALUES (${FX.lineUserCDE}, ${FX.oaConfigId}, 'Ue2e0000000000060', 'fx-user-cde')
        ON CONFLICT (id) DO NOTHING
      `;

      // (c) 除外: confirm_status='sent' (同じ窓内イベントを使う)
      await sql`
        INSERT INTO public.event_platform_urls (id, event_id, platform, url)
        VALUES (${FX.epuC}, ${FX.eventA}, 'twipla', 'https://twipla.jp/fx-c')
        ON CONFLICT (id) DO NOTHING
      `;
      await sql`
        INSERT INTO public.participants (id, event_platform_url_id, display_name, natural_key, status, line_user_id, confirm_status, current_question_index)
        VALUES (${FX.participantC}, ${FX.epuC}, 'fx-p-c', 'dn:fx-p-c', 'attending', ${FX.lineUserCDE}, 'sent', 0)
        ON CONFLICT (id) DO NOTHING
      `;

      // (d) 除外: status='interested'（同じ窓内イベント・line userは別途用意済み）
      await sql`
        INSERT INTO public.participants (id, event_platform_url_id, display_name, natural_key, status, line_user_id, confirm_status, current_question_index)
        VALUES (${FX.participantD}, ${FX.epuA}, 'fx-p-d', 'dn:fx-p-d', 'interested', ${FX.lineUserCDE}, 'pending', 0)
        ON CONFLICT (id) DO NOTHING
      `;

      // (e) 除外: line_user_id null
      await sql`
        INSERT INTO public.participants (id, event_platform_url_id, display_name, natural_key, status, line_user_id, confirm_status, current_question_index)
        VALUES (${FX.participantE}, ${FX.epuA}, 'fx-p-e', 'dn:fx-p-e', 'attending', NULL, 'pending', 0)
        ON CONFLICT (id) DO NOTHING
      `;

      // (f) 除外: event_date null
      await sql`
        INSERT INTO public.line_users (id, oa_config_id, line_user_id, display_name)
        VALUES (${FX.lineUserF}, ${FX.oaConfigId}, 'Ue2e0000000000051', 'fx-user-f')
        ON CONFLICT (id) DO NOTHING
      `;
      await sql`
        INSERT INTO public.events (id, oa_config_id, title, event_date, confirm_days_before)
        VALUES (${FX.eventF}, ${FX.oaConfigId}, 'fx-event-f', NULL, 7)
        ON CONFLICT (id) DO NOTHING
      `;
      await sql`
        INSERT INTO public.event_platform_urls (id, event_id, platform, url)
        VALUES (${FX.epuF}, ${FX.eventF}, 'twipla', 'https://twipla.jp/fx-f')
        ON CONFLICT (id) DO NOTHING
      `;
      await sql`
        INSERT INTO public.participants (id, event_platform_url_id, display_name, natural_key, status, line_user_id, confirm_status, current_question_index)
        VALUES (${FX.participantF}, ${FX.epuF}, 'fx-p-f', 'dn:fx-p-f', 'attending', ${FX.lineUserF}, 'pending', 0)
        ON CONFLICT (id) DO NOTHING
      `;

      // --- get_confirm_targets() をスコープしてassert ---
      const rows = await sql<{ participant_id: string }[]>`
        SELECT participant_id FROM public.get_confirm_targets()
      `;
      const participantIds = rows.map((r) => r.participant_id);

      // フィクスチャUUIDのみフィルタ（非フィクスチャ行を無視）
      const fxIds = new Set(Object.values(FX).filter((v) =>
        typeof v === "string" && v.includes("-e2e0-")
      ));

      const fxInResult = participantIds.filter((id) => fxIds.has(id));

      // (a) 含まれること
      assertEquals(
        fxInResult.includes(FX.participantA),
        true,
        `(a) participantA (窓内・linked・pending・attending) が対象に含まれること`,
      );

      // (b) 含まれないこと（confirm_days_before 超）
      assertEquals(
        fxInResult.includes(FX.participantB),
        false,
        `(b) participantB (event_date超過) が除外されること`,
      );

      // (c) 含まれないこと（confirm_status='sent'）
      assertEquals(
        fxInResult.includes(FX.participantC),
        false,
        `(c) participantC (confirm_status=sent) が除外されること`,
      );

      // (d) 含まれないこと（status='interested'）
      assertEquals(
        fxInResult.includes(FX.participantD),
        false,
        `(d) participantD (status=interested) が除外されること`,
      );

      // (e) 含まれないこと（line_user_id null）
      assertEquals(
        fxInResult.includes(FX.participantE),
        false,
        `(e) participantE (line_user_id=null) が除外されること`,
      );

      // (f) 含まれないこと（event_date null）
      assertEquals(
        fxInResult.includes(FX.participantF),
        false,
        `(f) participantF (event_date=null) が除外されること`,
      );

      // (e) count_unlinked_confirm_targets が 1件以上を返すことを確認
      // (フィクスチャの未紐付け参加者Eが計上されるはず)
      const unlinkedRows = await sql<{ count_unlinked_confirm_targets: number }[]>`
        SELECT public.count_unlinked_confirm_targets() AS count_unlinked_confirm_targets
      `;
      const unlinkedCount = unlinkedRows[0]?.count_unlinked_confirm_targets ?? 0;
      assertEquals(
        unlinkedCount >= 1,
        true,
        `(e) count_unlinked_confirm_targets が 1件以上 (フィクスチャ E が計上されること)`,
      );
    } finally {
      // フィクスチャ削除（participant → epu → event → line_user の順でFK制約を考慮）
      await sql`DELETE FROM public.participants WHERE id IN (${FX.participantA}, ${FX.participantB}, ${FX.participantC}, ${FX.participantD}, ${FX.participantE}, ${FX.participantF})`;
      await sql`DELETE FROM public.event_platform_urls WHERE id IN (${FX.epuA}, ${FX.epuB}, ${FX.epuC}, ${FX.epuF})`;
      await sql`DELETE FROM public.events WHERE id IN (${FX.eventA}, ${FX.eventB}, ${FX.eventF})`;
      await sql`DELETE FROM public.line_users WHERE id IN (${FX.lineUserA}, ${FX.lineUserB}, ${FX.lineUserCDE}, ${FX.lineUserF})`;
      await sql.end();
    }
  },
});

Deno.test({
  name: "e2e: message-sender curl → sent遷移 → pending復元",
  ignore: !IS_E2E,
  async fn() {
    const sql = connectDev();
    const projectRef = getRequiredEnv("DEV_PROJECT_REF");
    const anonKey = getRequiredEnv("SUPABASE_ANON_KEY");
    const SEED_PARTICIPANT_ID = "00000000-0000-0000-0000-000000000005";

    try {
      // seed participant を pending にリセット
      await sql`
        UPDATE public.participants
        SET confirm_status = 'pending', current_question_index = 0
        WHERE id = ${SEED_PARTICIPANT_ID}
      `;

      // 確認: pending になっているか
      const beforeRows = await sql<{ confirm_status: string }[]>`
        SELECT confirm_status FROM public.participants WHERE id = ${SEED_PARTICIPANT_ID}
      `;
      assertEquals(
        beforeRows[0]?.confirm_status,
        "pending",
        "事前リセット: confirm_status が pending であること",
      );

      // message-sender curl
      // WR-01: anonキー（ゲートウェイJWT）に加え x-cron-key 専用シークレットが必要
      const resp = await fetch(
        `https://${projectRef}.supabase.co/functions/v1/message-sender`,
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${anonKey}`,
            "x-cron-key": getRequiredEnv("CRON_FUNCTION_KEY"),
            "Content-Type": "application/json",
          },
          body: JSON.stringify({}),
        },
      );

      assertEquals(resp.status, 200, `message-sender が 200 を返すこと`);

      const body = await resp.json() as {
        status: string;
        targets: number;
        sent: number;
        failed: number;
        skippedUnlinked: number;
      };

      assertEquals(body.status, "ok", `レスポンス status が "ok" であること`);
      assertExists(body.targets, "targets フィールドが存在すること");
      assertEquals(
        body.sent >= 1,
        true,
        `sent >= 1 (seed participant が送信されること)`,
      );

      // sent遷移: DB上で confirm_status='sent' を確認
      const afterRows = await sql<
        { confirm_status: string; current_question_index: number }[]
      >`
        SELECT confirm_status, current_question_index
        FROM public.participants
        WHERE id = ${SEED_PARTICIPANT_ID}
      `;

      assertEquals(
        afterRows[0]?.confirm_status,
        "sent",
        `seed participant が confirm_status='sent' に遷移すること`,
      );
      assertEquals(
        afterRows[0]?.current_question_index,
        0,
        `current_question_index が 0 であること`,
      );
    } finally {
      // seed participant を pending に復元（02-04 フルE2E再利用のため）
      await sql`
        UPDATE public.participants
        SET confirm_status = 'pending', current_question_index = 0
        WHERE id = ${SEED_PARTICIPANT_ID}
      `;

      // 復元確認
      const restoredRows = await sql<{ confirm_status: string }[]>`
        SELECT confirm_status FROM public.participants WHERE id = ${SEED_PARTICIPANT_ID}
      `;
      assertEquals(
        restoredRows[0]?.confirm_status,
        "pending",
        "テスト終了時: seed participant が pending に復元されていること",
      );

      await sql.end();
    }
  },
});
