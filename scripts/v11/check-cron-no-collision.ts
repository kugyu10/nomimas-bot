/**
 * scripts/v11/check-cron-no-collision.ts
 * 確認配信を起動する cron ジョブどうしが**同一分に発火しない**ことを機械検証する。
 * SELECT のみ。何も送らない。
 *
 * なぜ必要か（この検査は反証から生まれた）:
 *   当日参加者の取りこぼしを塞ぐため catchup ジョブを足したとき、最初のスケジュールは
 *   「0-12時台に30分ごと」だった。この書き方は分 {0,30} を含むため UTC 01:00 に発火し、
 *   既存の confirm-broadcast-daily（'0 1 * * *' = UTC 01:00）と**同一分に同時発火**していた。
 *
 *   message-sender は「対象を読む → LINE に push → confirm_status='sent' に更新」の順で動き、
 *   読み取りと書き込みの間に await が複数挟まる（index.ts:177-184, 252-262, 366, 371-375）。
 *   排他制御は無い。よって2本が同時に走ると同じ参加者に確認配信が2通届く。
 *
 *   confirm_status による重複防止は「逐次実行なら有効・同時実行なら無効」であり、
 *   check-no-duplicate-confirm.ts はフィルタの正しさを測るだけでこの競合を検出できない。
 *   そこで「配信を起動するジョブの発火分が重ならないこと」を別途機械で見る。
 *
 * 判定:
 *   message-sender を叩く active な cron ジョブを全部集め、
 *   それぞれの「1日の発火分（UTC の 0..1439 分）」の集合を作り、**どの2本も交わらない**ことを確認する。
 *   交わる組が1つでもあれば exit 1。
 *
 * 限界（正直に書く）:
 *   これは「同一分に始まらない」ことしか保証しない。1回の実行が長引いて次の発火に
 *   かぶる可能性は消えない。根本的には message-sender 側の claim-then-send が必要
 *   （docs/v1.1-polling-design.md 付記3）。
 *
 * 実行:
 *   set -a; source .env.local; set +a
 *   deno run --allow-net --allow-read --allow-env --config deno.json \
 *     scripts/v11/check-cron-no-collision.ts
 */

import { connectDev } from "../db/sql.ts";

/** cron の1フィールドを展開する（* / a-b / a,b / n-m の組み合わせ・ステップ対応） */
function expandField(field: string, min: number, max: number): number[] {
  const out = new Set<number>();
  for (const part of field.split(",")) {
    const [rangePart, stepPart] = part.split("/");
    const step = stepPart ? parseInt(stepPart, 10) : 1;
    if (!Number.isFinite(step) || step <= 0) throw new Error(`不正なステップ: ${part}`);
    let lo: number, hi: number;
    if (rangePart === "*") {
      lo = min;
      hi = max;
    } else if (rangePart.includes("-")) {
      const [a, b] = rangePart.split("-").map((v) => parseInt(v, 10));
      if (!Number.isFinite(a) || !Number.isFinite(b)) throw new Error(`不正な範囲: ${part}`);
      lo = a;
      hi = b;
    } else {
      const v = parseInt(rangePart, 10);
      if (!Number.isFinite(v)) throw new Error(`不正な値: ${part}`);
      lo = v;
      hi = v;
    }
    for (let v = lo; v <= hi; v += step) {
      if (v < min || v > max) throw new Error(`範囲外の値 ${v}: ${part}`);
      out.add(v);
    }
  }
  return [...out];
}

/** 5フィールドの cron 式から「1日のうち発火する分（0..1439）」の集合を作る。
 *  日/月/曜日は「毎日走る」前提で無視する（配信ジョブはいずれも日次以上の頻度なので、
 *  同一分衝突の判定にはこれで十分。無視したことは呼び出し側で明示する）。 */
function firingMinutesOfDay(expr: string): Set<number> {
  const f = expr.trim().split(/\s+/);
  if (f.length !== 5) throw new Error(`5フィールドではない cron 式: '${expr}'`);
  const minutes = expandField(f[0], 0, 59);
  const hours = expandField(f[1], 0, 23);
  const set = new Set<number>();
  for (const h of hours) for (const m of minutes) set.add(h * 60 + m);
  return set;
}

const fmt = (n: number) => `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;

const sql = connectDev();
let failed = false;

try {
  // pg_cron のタイムゾーンを記録（UTC 前提であることを明示する）
  const tz = await sql<{ tz: string }[]>`select current_setting('TimeZone') as tz`;
  console.log(`  DB の TimeZone = ${tz[0]?.tz}（cron のスケジュールはこのTZで解釈される）`);

  const jobs = await sql<{ jobid: number; jobname: string; schedule: string }[]>`
    select jobid, jobname, schedule
    from cron.job
    where active is true
      and command like '%/functions/v1/message-sender%'
    order by jobid
  `;

  console.log(`  message-sender を叩く active なジョブ: ${jobs.length}本`);
  const expanded: { name: string; schedule: string; mins: Set<number> }[] = [];
  for (const j of jobs) {
    let mins: Set<number>;
    try {
      mins = firingMinutesOfDay(j.schedule);
    } catch (e) {
      console.error(`  [NG] ${j.jobname} の schedule '${j.schedule}' を解釈できない: ${e}`);
      failed = true;
      continue;
    }
    console.log(`    ${j.jobname}: '${j.schedule}' → 1日 ${mins.size} 回発火`);
    expanded.push({ name: j.jobname, schedule: j.schedule, mins });
  }

  if (expanded.length < 2) {
    console.log("  配信を起動するジョブが1本以下なので同一分衝突は起こりえない");
  }

  for (let i = 0; i < expanded.length; i++) {
    for (let k = i + 1; k < expanded.length; k++) {
      const a = expanded[i], b = expanded[k];
      const overlap = [...a.mins].filter((m) => b.mins.has(m)).sort((x, y) => x - y);
      if (overlap.length > 0) {
        console.error(
          `  [NG] ${a.name}('${a.schedule}') と ${b.name}('${b.schedule}') が同一分に発火する: ` +
            `${overlap.slice(0, 6).map(fmt).join(", ")}${overlap.length > 6 ? ` ほか計${overlap.length}回` : ""}` +
            "（同時実行で同じ参加者に確認配信が2通届く）",
        );
        failed = true;
      } else {
        console.log(`  [OK] ${a.name} と ${b.name} は同一分に発火しない`);
      }
    }
  }

  if (failed) {
    console.error("cron衝突チェック NG: 確認配信が二重に送られる可能性がある");
    Deno.exit(1);
  }
  console.log(
    `cron衝突チェック OK: message-sender を叩く ${expanded.length}本のジョブは` +
      `どの2本も同一分に発火しない（日/月/曜日は毎日実行として無視して判定）`,
  );
} catch (err) {
  console.error(`cron衝突チェック NG: ${err instanceof Error ? err.message : String(err)}`);
  Deno.exit(1);
} finally {
  await sql.end();
}
