/**
 * scripts/db/sql.ts
 * pooler経由 SQL 実行ヘルパー（npm:postgres@3.4.9）
 *
 * - connectDev() で dev DB 専用のプーラー接続を返す
 * - ref !== 'cmsxvxtcdniqgvhxjqri' の場合は即 Deno.exit(1)（prod 安全弁 T-02-02）
 * - 直接接続（db.<ref>.supabase.co）は IPv6 限定 DNS のため不可 — セッションプーラー経由（RESEARCH 実証済み）
 */

import postgres from "npm:postgres@3.4.9";

const DEV_PROJECT_REF = "cmsxvxtcdniqgvhxjqri";

/**
 * dev Supabase プーラーへの接続を確立する。
 * 環境変数 DEV_PROJECT_REF が 'cmsxvxtcdniqgvhxjqri' でない場合は即終了（prod 安全弁）。
 */
export function connectDev(): ReturnType<typeof postgres> {
  // prod 安全弁: ref を強制確認（T-02-02）
  const ref = Deno.env.get("DEV_PROJECT_REF") ?? "";
  if (ref !== DEV_PROJECT_REF) {
    console.error(
      `[sql.ts] ABORT: DEV_PROJECT_REF='${ref}' !== '${DEV_PROJECT_REF}'. 本スクリプトは dev 専用です。`,
    );
    Deno.exit(1);
  }

  // パスワード解決: SUPABASE_DB_PASSWORD があればそれを使う。
  // なければ SUPABASE_DIRECT_CONNECTION_STRING から pgpass 形式でパースする。
  let password = Deno.env.get("SUPABASE_DB_PASSWORD") ?? "";
  if (!password) {
    const connStr = Deno.env.get("SUPABASE_DIRECT_CONNECTION_STRING") ?? "";
    // postgresql://postgres.<ref>:<password>@db.<ref>.supabase.co:5432/postgres
    const match = connStr.match(/^postgres(?:ql)?:\/\/[^:]+:([^@]+)@/);
    if (match) {
      password = decodeURIComponent(match[1]);
    }
  }
  if (!password) {
    console.error(
      "[sql.ts] ABORT: DB パスワードが取得できませんでした。" +
        "SUPABASE_DB_PASSWORD または SUPABASE_DIRECT_CONNECTION_STRING を env.dev に設定してください。",
    );
    Deno.exit(1);
  }

  return postgres({
    host: "aws-1-ap-northeast-1.pooler.supabase.com",
    port: 5432,
    database: "postgres",
    username: `postgres.${ref}`,
    password,
    ssl: "require",
    prepare: false, // トランザクションプーラー互換（セッションプーラー 5432 でも無害）
  });
}
