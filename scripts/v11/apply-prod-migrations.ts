/**
 * scripts/v11/apply-prod-migrations.ts
 * **prod 専用**のマイグレーション適用スクリプト。
 *
 * なぜ dev 用と分けるのか:
 *   scripts/v11/apply-dev-migrations.ts は `connectDev()`（dev 以外だと即 exit する安全弁）を
 *   通す。prod に当てたいからといってその安全弁を外すのは最悪の改変なので、
 *   **prod 用は別ファイルにして、prod 用の安全弁を独自に持たせる**
 *   （docs/v1.1-prod-migration.md の方針）。
 *
 * 安全弁（3つとも満たさないと1文も実行しない）:
 *   1. 第1引数が正確に `--yes-apply-to-prod` であること（事故防止。補完で流れない長さにしてある）
 *   2. `PROD_PROJECT_REF` が既知の prod ref と一致すること
 *   3. 適用対象は**コマンドラインで明示したファイルのみ**
 *      （`supabase db push` と違い「未適用のものを全部」は絶対にやらない）
 *
 * 冪等性:
 *   supabase_migrations.schema_migrations（supabase CLI と同じ台帳）を見て、
 *   既に記録済みの version は**SQL 本体を実行せずスキップ**する。
 *   1ファイル = 1トランザクション。失敗したらそこで止めて非ゼロ終了。
 *
 * 使い方:
 *   set -a; source .env.prod; set +a
 *   deno run --allow-net --allow-read --allow-env --config deno.json \
 *     scripts/v11/apply-prod-migrations.ts --yes-apply-to-prod \
 *     supabase/migrations/20260825010000_add_twipla_scrape_polling_cron.sql \
 *     supabase/migrations/20260825020000_log_confirm_broadcast.sql
 *
 * 適用前に必ず docs/v1.1-prod-migration.md のチェックリストを通すこと。
 */

import postgres from "npm:postgres@3.4.9";

const PROD_REF = "hgojtooexbknqotzkkja";
const POOLER = "aws-1-ap-northeast-1.pooler.supabase.com";
const CONFIRM_FLAG = "--yes-apply-to-prod";

const args = [...Deno.args];
if (args[0] !== CONFIRM_FLAG) {
  console.error(
    `ABORT: 第1引数に ${CONFIRM_FLAG} が必要です（prod への適用を明示するため）。\n` +
      `使い方: deno run ... scripts/v11/apply-prod-migrations.ts ${CONFIRM_FLAG} <file.sql> [file2.sql ...]`,
  );
  Deno.exit(2);
}
args.shift();

if (args.length === 0) {
  console.error("ABORT: 適用するマイグレーションファイルを1つ以上指定してください。");
  Deno.exit(2);
}

const ref = Deno.env.get("PROD_PROJECT_REF") ?? "";
if (ref !== PROD_REF) {
  console.error(
    `ABORT: PROD_PROJECT_REF='${ref}' が想定の prod ref と一致しません。` +
      "（.env.prod を source していますか？）",
  );
  Deno.exit(1);
}

let password = Deno.env.get("SUPABASE_DB_PASSWORD") ?? "";
if (!password) {
  const conn = Deno.env.get("SUPABASE_DIRECT_CONNECTION_STRING") ?? "";
  const m = conn.match(/^postgres(?:ql)?:\/\/[^:]+:([^@]+)@/);
  if (m) password = decodeURIComponent(m[1]);
}
if (!password) {
  console.error("ABORT: prod の DB パスワードが取得できませんでした（.env.prod を確認）");
  Deno.exit(1);
}

const sql = postgres({
  host: POOLER,
  port: 5432,
  database: "postgres",
  username: `postgres.${ref}`,
  password,
  ssl: "require",
  prepare: false,
});

let failed = false;

try {
  console.log(`[apply-prod] 対象: prod (${ref.slice(0, 6)}…) / ${args.length} ファイル\n`);

  for (const path of args) {
    const base = path.split("/").pop() ?? path;
    const m = base.match(/^(\d{14})_(.+)\.sql$/);
    if (!m) {
      console.error(`[apply-prod] ABORT: ファイル名が <14桁>_<name>.sql の形式ではありません: ${base}`);
      failed = true;
      break;
    }
    const [, version, name] = m;
    console.log(`[apply-prod] --- ${base} (version=${version}) ---`);

    const already = await sql<{ version: string }[]>`
      select version from supabase_migrations.schema_migrations where version = ${version}
    `;
    if (already.length > 0) {
      console.log(`[apply-prod] SKIP: version=${version} は既に適用済みです`);
      continue;
    }

    const body = await Deno.readTextFile(path);

    try {
      await sql.begin(async (tx) => {
        await tx.unsafe(body);
        await tx`
          insert into supabase_migrations.schema_migrations (version, name)
          values (${version}, ${name})
          on conflict (version) do nothing
        `;
      });
      console.log(`[apply-prod] OK: version=${version} を適用しました`);
    } catch (err) {
      console.error(
        `[apply-prod] FAILED: version=${version} の適用に失敗しました: ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
      console.error("[apply-prod] このファイルはロールバックされました。後続は適用しません。");
      failed = true;
      break;
    }
  }
} finally {
  await sql.end();
}

if (failed) Deno.exit(1);
console.log("\n[apply-prod] 完了。docs/v1.1-prod-migration.md の「適用直後に見るべき観測点」を確認してください。");
