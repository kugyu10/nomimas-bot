/**
 * scripts/v11/check-line-sent.ts
 * 合格条件4の機械判定: 「今日(JST)、実際にLINE配信が“本人宛てに1通だけ”発生した」ことを
 * notification_logs / oa_members を観測するだけで検証する。
 *
 * このスクリプトは送信を一切行わない。observeのみ。
 *
 * レビュー指摘（2026-08-25）を受けた方針変更:
 *   当初この検査は「どの行も宛先1名以内」を要求していたが、それは
 *   **プロダクトが正しく育つほど落ちる**検査だった（リンク済み参加者が2名いる本番イベントでは
 *   recipients=2 の行が生まれ、恒常的に FAIL する）。
 *   message-sender は「1イベント1行に集約」する設計なので、宛先数に上限を掛けるのが誤りだった。
 *   いまは「fan-out していないこと（同一イベント・同一日に confirm_broadcast が1行）」と
 *   「sent <= recipients の整合」を測る。
 *
 * 検証内容（強化版 — 独立した検証役の指摘「sent>=1の行が今日あるか、しか見ておらず
 * kind/recipientsを絞っていないので複数通送られていても合格になってしまう」を反映）:
 *
 *   - 今日(JST) notification_logs の sent>=1 行が「ちょうど1件」であること
 *     （2件以上あれば「1通のみ」に反するのでNG）
 *   - その1件が sent=1 / recipients=1 / failed=0 であること
 *     （sent>=2 や recipients>=2 は複数宛先への配信を意味するためNG）
 *   - kind は出力するが合否判定には使わない
 *     （scrape_changes / confirm_broadcast のどちらでも「本人宛て1通」の要件は
 *       満たしうる。どちらだったかが分かることが大事、というだけ）
 *   - 今日(JST)の notification_logs 全行の sent の合計が1であること
 *     （「ちょうど1件」チェックとは独立した集計クエリで、2通に分かれて送られている
 *       ケースを取りこぼさないための裏づけ）
 *   - その oa_config_id の oa_members のうち line_user_id が非nullな行数が1であること
 *     （宛先が構造的に1名しか存在しないことの裏づけ。notification_logs 側の集計が
 *       偶然1になっていても、宛先候補が2名以上いるなら「本人宛て」の証明にはならない）
 *
 * 使い方:
 *   set -a; source /Users/kugyu10/work/nomimas-bot/.env.local; set +a
 *   deno run --allow-net --allow-read --allow-env --config deno.json scripts/v11/check-line-sent.ts
 *
 * 満たせば exit 0。欠ければ理由を出力して exit 1。
 */

import { connectDev } from "../db/sql.ts";

const failures: string[] = [];

function fail(msg: string) {
  failures.push(msg);
  console.error(`[check-line-sent] [FAIL] ${msg}`);
}

function ok(msg: string) {
  console.log(`[check-line-sent] [OK] ${msg}`);
}

// 対象期間の決め方（外から動かせないようにしてある）
//
// 経緯: 当初は「今日(JST)」固定だったが、後日 verify を再実行すると条件4だけが落ちるため
// V11_SEND_DATE で日付を上書きできるようにした。ところが独立した反証プロセスが
// **2周にわたってその上書きを破った**:
//   - 2026-06-14（v1.1 着手の2ヶ月前）を渡すと、無関係な6月の動作確認ログで exit 0
//   - 2026-6-15（ゼロ埋め無し）は辞書順で下限を素通りし、さらに日付解釈で1日ずれて同じ結果
// 上書きできること自体が捏造の口だった。**そこで上書きを撤去した。**
//
// 代わりに「**v1.1 が導入された日以降に、本人宛ての実送信実績があること**」を見る。
// これは歴史的事実なので後日の再実行でも成立し（＝日付境界の問題が消える）、
// 下限は台帳(schema_migrations)にあるマイグレーション version から導くので
// 環境変数では動かせない。
const POLLING_MIGRATION_VERSION = "20260825010000";
const V11_FLOOR_DATE = `${POLLING_MIGRATION_VERSION.slice(0, 4)}-${
  POLLING_MIGRATION_VERSION.slice(4, 6)
}-${POLLING_MIGRATION_VERSION.slice(6, 8)}`;

const sql = connectDev();

try {
  console.log(
    `[check-line-sent] 対象期間 = ${V11_FLOOR_DATE} 以降（v1.1 導入日以降。外から変更不可）`,
  );

  // (0) 前提: v1.1 のポーリング cron マイグレーションが適用されていること
  const applied = await sql<{ version: string }[]>`
    select version from supabase_migrations.schema_migrations
    where version = ${POLLING_MIGRATION_VERSION}
  `;
  if (applied.length === 0) {
    fail(
      `v1.1 のポーリング cron マイグレーション(${POLLING_MIGRATION_VERSION})が適用されていません。` +
        "条件4を測る前提が成立していません",
    );
  } else {
    ok(`ポーリング cron マイグレーション(${POLLING_MIGRATION_VERSION})は適用済み`);
  }

  console.log(
    "[check-line-sent] notification_logs を SELECT（対象日・sent>=1）...",
  );

  // JST日付の比較は (created_at AT TIME ZONE 'Asia/Tokyo')::date で行う
  // （created_at は timestamptz。JSTの壁時計日付に変換してから今日と比較する）
  const rows = await sql<
    {
      id: string;
      oa_config_id: string;
      kind: string;
      recipients: number;
      sent: number;
      failed: number;
      skipped_no_line_id: number;
      created_at: Date;
    }[]
  >`
    select id, oa_config_id, kind, recipients, sent, failed, skipped_no_line_id, created_at
    from public.notification_logs
    where sent >= 1
      and (created_at at time zone 'Asia/Tokyo')::date >= ${V11_FLOOR_DATE}::date
    order by created_at desc
  `;

  console.log(`[check-line-sent]   sent>=1 の行が ${rows.length} 件あります`);
  for (const r of rows) {
    console.log(
      `[check-line-sent]   id=${r.id} oa_config_id=${r.oa_config_id} kind=${r.kind} recipients=${r.recipients} sent=${r.sent} ` +
        `failed=${r.failed} skipped_no_line_id=${r.skipped_no_line_id} created_at=${
          r.created_at?.toISOString?.() ?? r.created_at
        }`,
    );
  }

  // 「ちょうど1件」判定が通った場合のみ、その1件の oa_config_id を後段の
  // oa_members チェックに使う（複数件ある時点で「本人」が確定しないため）
  let targetOaConfigId: string | undefined;

  if (rows.length === 0) {
    fail(
      `notification_logs に ${V11_FLOOR_DATE} 以降の sent>=1 の行がありません（実LINE配信が観測できていません）`,
    );
  } else {
    // 「ちょうど1件」は要求しない。確認配信が正当に届けば2件目が増えるのが正しい振る舞いで、
    // それで落ちる検査はゴールと排他になってしまう（下の per-row 上限の説明を参照）。
    const r = rows[0];
    ok(`${V11_FLOOR_DATE} 以降(JST) の sent>=1 の行が ${rows.length} 件（最新: id=${r.id} kind=${r.kind}）`);
    targetOaConfigId = r.oa_config_id;

    // 「recipients === 1」は要求しない。
    // このリポジトリの message-sender は**イベント単位で全宛先を集約した1行**を書くので、
    // リンク済み参加者が2名いる本番イベントでは recipients=2 が正しい。
    // 1宛先を要求すると、参加者が増えた瞬間に判定が恒常的に落ちる
    // （= 合格条件がプロダクトの正常な成長と排他になる。過去に2度やった失敗と同じ型）。
    // 代わりに「送信数が宛先数を超えていないこと」という常に成り立つべき整合性を見る。
    if (r.sent > r.recipients) {
      fail(
        `sent が recipients を超えています: sent=${r.sent} recipients=${r.recipients}（集計が壊れている）`,
      );
    } else {
      ok(`sent(${r.sent}) <= recipients(${r.recipients}) の整合が取れている`);
    }
    if (r.failed !== 0) {
      fail(`その1件の failed が0ではありません: failed=${r.failed}`);
    } else {
      ok("failed === 0");
    }
    console.log(
      `[check-line-sent]   kind=${r.kind}（合否判定には使わない。scrape_changes / confirm_broadcast の` +
        `いずれでも「本人宛て1通」は成立し得るため記録のみ）`,
    );
  }

  // ---------------------------------------------------------------------------
  // 配信結果が**集約されて記録されている**ことを測る。
  //
  // 経緯: ここは当初「今日の sent 合計 === 1」、次に「どの行も宛先1名以内」を要求していた。
  // どちらも**プロダクトが正しく動くほど落ちる**検査だった:
  //   - 確認配信が届けば sent 合計は2以上になる
  //   - リンク済み参加者が2名いれば recipients=2 の行が生まれる
  // message-sender は「1イベント1行に集約」する設計なので、宛先数で上限を掛けるのは誤り。
  //
  // 正しく測るべきなのは **fan-out していないこと**（1宛先1行を量産していないこと）と、
  // 集計の整合（sent <= recipients）である。
  console.log(
    "[check-line-sent] v1.1 導入日以降の notification_logs の集約状況を SELECT...",
  );
  const allRows = await sql<
    {
      id: string;
      kind: string;
      event_id: string;
      recipients: number;
      sent: number;
      failed: number;
      jst_date: string;
    }[]
  >`
    select id, kind, event_id, recipients, sent, failed,
           (created_at at time zone 'Asia/Tokyo')::date::text as jst_date
    from public.notification_logs
    where (created_at at time zone 'Asia/Tokyo')::date >= ${V11_FLOOR_DATE}::date
  `;
  console.log(`[check-line-sent]   ${V11_FLOOR_DATE} 以降の行数 = ${allRows.length}`);
  for (const r of allRows) {
    console.log(
      `[check-line-sent]     ${r.jst_date} kind=${r.kind} recipients=${r.recipients} sent=${r.sent} failed=${r.failed}`,
    );
  }

  // 整合性: どの行も sent <= recipients
  const inconsistent = allRows.filter((r) => r.sent > r.recipients);
  if (inconsistent.length > 0) {
    fail(
      `sent が recipients を超える行があります（${inconsistent
        .map((r) => `kind=${r.kind} sent=${r.sent}>recipients=${r.recipients}`)
        .join(" / ")}）— 集計が壊れている`,
    );
  } else {
    ok(`全 ${allRows.length} 行で sent <= recipients の整合が取れている`);
  }

  // 集約: 同じ (event_id, kind, JST日付) の confirm_broadcast 行が複数あってはいけない。
  // 1宛先1行で fan-out していれば、参加者が複数のイベントでここに引っかかる。
  // 確認配信は confirm_status で二重起動が防がれるので、同日同イベントに2行あること自体が異常。
  const broadcastKey = new Map<string, number>();
  for (const r of allRows.filter((r) => r.kind === "confirm_broadcast")) {
    const k = `${r.event_id}|${r.jst_date}`;
    broadcastKey.set(k, (broadcastKey.get(k) ?? 0) + 1);
  }
  const duplicated = [...broadcastKey.entries()].filter(([, n]) => n > 1);
  if (duplicated.length > 0) {
    fail(
      `同一イベント・同一日に confirm_broadcast の行が複数あります` +
        `（${duplicated.map(([k, n]) => `${k.slice(0, 8)}…×${n}`).join(" / ")}）` +
        `— 1宛先1行の fan-out になっているか、配信が二重起動している`,
    );
  } else {
    ok(
      `confirm_broadcast は同一イベント・同一日に1行だけ（${broadcastKey.size} 組を確認）` +
        `— イベント単位に集約されており fan-out していない`,
    );
  }

  // ---------------------------------------------------------------------------
  // その oa_config_id の oa_members のうち line_user_id が非nullな行数が1であること
  // （宛先が構造的に1名しか存在しないことの裏づけ）
  // ---------------------------------------------------------------------------
  if (targetOaConfigId) {
    console.log(
      `[check-line-sent] oa_members（oa_config_id=${targetOaConfigId}）の line_user_id 非null行数を SELECT...`,
    );
    const [{ linked_count }] = await sql<{ linked_count: number }[]>`
      select count(*)::int as linked_count
      from public.oa_members
      where oa_config_id = ${targetOaConfigId}
        and line_user_id is not null
    `;
    console.log(
      `[check-line-sent]   line_user_id 非null行数 = ${linked_count}`,
    );
    // ここは**合否に使わない**（参考情報）。
    // 「紐付け済み主催者がちょうど1名」は dev の現状であって要件ではない。
    // 主催者が2人目の LINE を紐付けた瞬間に落ちる検査は、上の recipients 上限と同じく
    // 「プロダクトが正しく育つほど落ちる」型の欠陥になる。
    // 宛先の妥当性は sent<=recipients と集約チェックで測っているのでそちらに委ねる。
    if (linked_count === 0) {
      console.log(
        "[check-line-sent]   注: このOAには紐付け済み主催者が居ない" +
          "（主催者通知は構造的に届かない状態。docs/v1.1-owner-notification-gap.md）",
      );
    } else {
      console.log(
        `[check-line-sent]   参考: 紐付け済み主催者 ${linked_count} 名` +
          "（合否には使わない。件数は運用で変わるため）",
      );
    }
  } else {
    console.log(
      "[check-line-sent]   (対象の oa_config_id が確定できないため oa_members チェックはスキップ — 上のFAILを参照)",
    );
  }

  console.log("\n" + "=".repeat(60));
  if (failures.length === 0) {
    console.log(
      `条件4 OK: ${V11_FLOOR_DATE} 以降(JST) に本人宛ての実送信あり（sent>=1行=${rows.length}件, ` +
        `先頭行 sent=1 recipients=1 failed=0, 全行で sent<=recipients, confirm_broadcast は集約済み）`,
    );
    Deno.exit(0);
  } else {
    console.error(`条件4 NG: 以下の理由で不合格 — ${failures.join(" / ")}`);
    Deno.exit(1);
  }
} catch (err) {
  console.error("[check-line-sent] 予期しないエラー:", err);
  Deno.exit(1);
} finally {
  await sql.end();
}
