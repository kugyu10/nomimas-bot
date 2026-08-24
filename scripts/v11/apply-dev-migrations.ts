/**
 * scripts/v11/apply-dev-migrations.ts
 * dev Supabase に対して、指定したマイグレーションファイルを順番に適用するスクリプト。
 *
 * - connectDev()（scripts/db/sql.ts）を使用。DEV_PROJECT_REF が dev ref と一致しない場合は
 *   sql.ts 側の安全弁により即 Deno.exit(1) する（prod には接続できない）。
 * - 引数で受け取ったファイルを「渡された順番」に1ファイルずつ適用する。
 * - 各ファイルは1トランザクションで「SQL本体の実行」+「supabase_migrations.schema_migrations
 *   への version 記録」を行う（片方が失敗したら両方ロールバック）。
 * - version はファイル名先頭の14桁（例: 20260825010000）。既に schema_migrations に
 *   その version が存在する場合は SQL 本体を実行せずスキップする（冪等）。
 *   これは `supabase db push` が使う台帳と同じテーブルなので、翌朝 CLI から push しても
 *   二重適用にならない。
 * - 失敗したファイルがあればそこで止めて非ゼロ終了する（後続ファイルは適用しない）。
 *
 * SQL実行方法: sql.unsafe(fileContent) を使用（sql.file() ではない）。
 *   本マイグレーションは do $$ ... $$ ブロック + 別の select 文という複数ステートメント
 *   構成のため、simple query protocol で複数文をまとめて送れる sql.unsafe() を採用した。
 *
 * 使い方:
 *   set -a; source /Users/kugyu10/work/nomimas-bot/.env.local; set +a
 *   deno run --allow-net --allow-read --allow-env --config deno.json \
 *     scripts/v11/apply-dev-migrations.ts \
 *     supabase/migrations/20260825010000_add_twipla_scrape_polling_cron.sql
 *
 *   複数ファイルを順番に適用する場合:
 *   deno run --allow-net --allow-read --allow-env --config deno.json \
 *     scripts/v11/apply-dev-migrations.ts \
 *     supabase/migrations/A.sql supabase/migrations/B.sql
 */

import { connectDev } from "../db/sql.ts";

const VERSION_RE = /^(\d{14})_(.+)\.sql$/;

const files = Deno.args;
if (files.length === 0) {
  console.error(
    "[apply-dev-migrations] ABORT: 適用するマイグレーションファイルを引数で指定してください。\n" +
      "  例: deno run --allow-net --allow-read --allow-env --config deno.json " +
      "scripts/v11/apply-dev-migrations.ts supabase/migrations/xxxx.sql",
  );
  Deno.exit(1);
}

const sql = connectDev();

try {
  for (const filePath of files) {
    const basename = filePath.split("/").pop() ?? filePath;
    const match = basename.match(VERSION_RE);
    if (!match) {
      console.error(
        `[apply-dev-migrations] ABORT: ファイル名からバージョンを抽出できません: ${basename}` +
          `（期待する形式: <14桁タイムスタンプ>_<名前>.sql）`,
      );
      Deno.exit(1);
    }
    const version = match[1];
    const name = match[2];

    console.log(`\n[apply-dev-migrations] --- ${basename} (version=${version}) ---`);

    // 冪等チェック: 既に記録済みの version は SQL 本体を実行せずスキップする
    const existing = await sql`
      select version from supabase_migrations.schema_migrations where version = ${version}
    `;
    if (existing.length > 0) {
      console.log(`[apply-dev-migrations] SKIP: version=${version} は既に適用済みです`);
      continue;
    }

    let content: string;
    try {
      content = await Deno.readTextFile(filePath);
    } catch (err) {
      console.error(`[apply-dev-migrations] ABORT: ファイル読み込み失敗: ${filePath}`, err);
      Deno.exit(1);
      throw err; // 型上の到達不能保証（Deno.exitはneverだがlintのため）
    }

    try {
      await sql.begin(async (tx) => {
        // SQL本体を実行（複数ステートメント対応のため sql.unsafe を使用）
        await tx.unsafe(content);

        // supabase_migrations.schema_migrations に version を記録（supabase CLI と同じ台帳）
        await tx`
          insert into supabase_migrations.schema_migrations (version, name)
          values (${version}, ${name})
          on conflict (version) do nothing
        `;
      });
      console.log(`[apply-dev-migrations] OK: version=${version} を適用しました`);
    } catch (err) {
      console.error(`[apply-dev-migrations] FAIL: ${basename} の適用中にエラーが発生しました:`, err);
      Deno.exit(1);
    }
  }

  console.log("\n[apply-dev-migrations] 全ファイルの適用処理が完了しました");
} finally {
  await sql.end();
}
