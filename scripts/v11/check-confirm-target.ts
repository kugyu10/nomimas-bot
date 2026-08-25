/**
 * scripts/v11/check-confirm-target.ts
 * 合格条件1b: ポーリングで取り込まれた参加者が「最終確認の配信対象」になっていることを機械判定する。
 *
 * v1.1 のゴールは「Twiplaを自動ポーリングして変化を検知し、**直前参加者まで確認配信が届く**」。
 * 条件1（実ポーリングで保存できる／誤検知しない）だけでは、取り込んだ参加者が実際に
 * 配信対象として拾われるかは分からない。ここではその橋渡しを検証する:
 *
 *   1. テストイベント(741123)の participants に attending の行がある
 *   2. その行が line_users に紐付いている（propagate_oa_links による自動紐付けが効いている）
 *   3. get_confirm_targets(<event_id>) の戻り値にその participant が含まれる
 *      = 最終確認配信の cron/手動配信がこの人を対象として拾う
 *
 * SELECT のみ。何も送らない。何も書き換えない。
 *
 * 実行:
 *   set -a; source /Users/kugyu10/work/nomimas-bot/.env.local; set +a
 *   deno run --allow-net --allow-read --allow-env --config deno.json \
 *     scripts/v11/check-confirm-target.ts
 */

import { connectDev } from "../db/sql.ts";

const TEST_URL = "https://twipla.jp/events/741123";

const sql = connectDev();
let failed = false;
const fail = (msg: string) => {
  console.error(`  [NG] ${msg}`);
  failed = true;
};

try {
  // (1) テストイベントの event_platform_url を解決する
  const epu = await sql<{ id: string; event_id: string; title: string; event_date: string }[]>`
    select epu.id, epu.event_id, e.title, e.event_date
    from public.event_platform_urls epu
    join public.events e on e.id = epu.event_id
    where epu.url = ${TEST_URL}
  `;
  if (epu.length === 0) {
    fail(`${TEST_URL} が event_platform_urls に登録されていない（先に seed-dev-event.ts を実行せよ）`);
    throw new Error("no event");
  }
  const { id: epuId, event_id: eventId, title } = epu[0];
  console.log(`  対象イベント: "${title}" (event_id=${String(eventId).slice(0, 8)}…)`);

  // (2) attending の participants と紐付け状況
  const parts = await sql<
    { id: string; screen_name: string | null; status: string; confirm_status: string; linked: boolean }[]
  >`
    select p.id, p.screen_name, p.status, p.confirm_status,
           (p.line_user_id is not null) as linked
    from public.participants p
    where p.event_platform_url_id = ${epuId}
      and p.status = 'attending'
  `;
  if (parts.length === 0) {
    fail("attending の participants が0件（ポーリングで取り込めていない）");
  } else {
    console.log(`  attending participants: ${parts.length}件`);
    for (const p of parts) {
      console.log(
        `    screen_name=${p.screen_name} confirm_status=${p.confirm_status} linked=${p.linked}`,
      );
    }
  }

  const linked = parts.filter((p) => p.linked);
  if (linked.length === 0) {
    fail(
      "attending の participants が1件も line_users に紐付いていない" +
        "（propagate_oa_links が効いていない、または同一OAに screen_name 一致の既知紐付けが無い）",
    );
  }

  // (3) get_confirm_targets に含まれるか（手動モード = event_id 指定で窓を無視する）
  const targets = await sql<{ participant_id: string; event_title: string }[]>`
    select participant_id, event_title from public.get_confirm_targets(${eventId}::uuid)
  `;
  console.log(`  get_confirm_targets(event_id) の戻り: ${targets.length}件`);

  const targetIds = new Set(targets.map((t) => t.participant_id));

  // 「配信対象になった」ことの証拠は2通りある。どちらでも満たしたと見なす:
  //   (a) いま get_confirm_targets に含まれている（これから送られる）
  //   (b) 既に確認配信を受け取っている（confirm_status が pending でない）
  //
  // (b) を認めないと、**実際に届いた瞬間にこの検査が落ちる**。
  // get_confirm_targets は pending の行しか返さないので、確認配信が成功して
  // confirm_status が 'sent'/'in_progress'/'completed' になると対象から外れるためである。
  // それは「ゴールを達成したから検査が落ちる」という倒錯で、条件4で一度やった失敗と同じ
  // （合格条件がゴールの達成と排他になっていた）。**届いた実績は、対象になることの
  // 上位互換の証拠**なので、そちらを正しく数える。
  const eligible = linked.filter((p) => targetIds.has(p.id));
  const served = linked.filter((p) => p.confirm_status !== "pending");
  const hit = [...new Set([...eligible, ...served])];

  if (hit.length === 0) {
    fail(
      "紐付け済み attending の participant が、配信対象にも含まれず、確認配信を受け取った形跡も無い" +
        `（linked=${linked.length}件 / get_confirm_targets=${targets.length}件 / ` +
        `confirm_status が pending 以外=0件）`,
    );
  } else {
    console.log(
      `  配信対象になった証拠: これから送られる=${eligible.length}件 / ` +
        `既に受け取り済み=${served.length}件` +
        (served.length > 0
          ? `（${served.map((p) => `@${p.screen_name}:${p.confirm_status}`).join(", ")}）`
          : ""),
    );
  }

  // (4) 自動配信パス（cron モード = 引数 null）で拾われるかを確認する。
  //
  // ここは「参考情報」で済ませてはいけない（独立した反証プロセスの指摘）。
  // 手動モードは**日付の窓を無視する**ので、それだけで合否を出すと
  // 「自動で届く」ことを何も測らないまま exit 0 になりうる。
  //
  // ただし自動パスが今アクティブかどうかは、検証イベントを通知窓の内に置くか外に置くかで
  // 決まる。窓の内に置けば朝に実際の確認配信 LINE が飛ぶ（夜間の送信枠を超える）ので、
  // 夜の終わりに意図的に窓の外へ退避させてある。
  //
  // そこで**「自動パスから外れている理由が日付の窓だけであること」を機械的に確かめる**。
  // これなら「未紐付け」「confirm_status が pending でない」といった本質的な欠落と、
  // 「意図して窓の外に置いている」ことを区別できる。
  const cronTargets = await sql<{ participant_id: string }[]>`
    select participant_id from public.get_confirm_targets(null)
  `;
  const inCronWindow = cronTargets.some((t) => targetIds.has(t.participant_id));

  const [{ days_out, cdb }] = await sql<{ days_out: number; cdb: number }[]>`
    select (e.event_date - (now() at time zone 'Asia/Tokyo')::date)::int as days_out,
           e.confirm_days_before::int as cdb
    from public.events e where e.id = ${eventId}::uuid
  `;
  const windowExcludes = !(days_out >= 0 && days_out <= cdb);

  if (inCronWindow) {
    console.log(
      `  [OK] 自動配信パス（cronモード）でも対象に入っている（event_date は ${days_out} 日後 / ` +
        `confirm_days_before=${cdb}）— 確認配信は自動で拾われる状態`,
    );
  } else if (served.length > 0 && eligible.length === 0) {
    console.log(
      `  [OK] 自動配信パスに居ないのは**既に確認配信を受け取ったから**` +
        `（${served.map((p) => `@${p.screen_name}:${p.confirm_status}`).join(", ")}）。` +
        `get_confirm_targets は pending のみ返すので、送信済みの人が外れるのは正しい挙動`,
    );
  } else if (windowExcludes) {
    console.log(
      `  [OK] 自動配信パスから外れているが、理由は**日付の窓だけ**である` +
        `（event_date は ${days_out} 日後 / confirm_days_before=${cdb} → 窓外）。` +
        `紐付けと confirm_status は上で確認済みなので、窓の中に戻せば自動で拾われる` +
        `（scripts/v11/set-test-event-window.ts in）`,
    );
  } else {
    fail(
      `自動配信パスから外れているが、日付の窓では説明できない` +
        `（event_date は ${days_out} 日後 / confirm_days_before=${cdb} は窓内なのに ` +
        `get_confirm_targets(null) に含まれない）— 紐付けや confirm_status 以外の理由で` +
        `自動配信の対象から落ちている`,
    );
  }

  if (failed) {
    console.error("条件1b NG: 取り込んだ参加者が最終確認の配信対象になっていない");
    Deno.exit(1);
  }
  console.log(
    `条件1b OK: ポーリングで取り込んだ参加者 ${hit.length}件 が line_users に紐付き ` +
      `確認配信の対象になった（これから=${eligible.length}件 / 受け取り済み=${served.length}件、` +
      `自動パス在籍=${inCronWindow}` +
      `${inCronWindow ? "" : " / 除外理由は日付の窓のみと確認済み"}）`,
  );
} catch (err) {
  console.error(`条件1b NG: ${err instanceof Error ? err.message : String(err)}`);
  Deno.exit(1);
} finally {
  await sql.end();
}
