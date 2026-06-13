/**
 * admin/tests/integration/rls.helpers.ts
 * pooler JWT 切替ハーネス（Pattern 5 — RESEARCH 実証済みコード）
 *
 * asUser(sql, userId, fn):
 *   - set local role authenticated
 *   - set_config('request.jwt.claims', {sub: userId, role:'authenticated'}, true)
 *   - fn(tx) を呼び出す
 *
 * 接続: aws-1-ap-northeast-1.pooler.supabase.com:5432
 *       postgres.<ref> / SUPABASE_DB_PASSWORD or SUPABASE_DIRECT_CONNECTION_STRING
 * DEV_PROJECT_REF !== 'cmsxvxtcdniqgvhxjqri' なら throw（二重 ref ガード）
 */
import postgres from "postgres";

const DEV_PROJECT_REF = "cmsxvxtcdniqgvhxjqri";
const SUPABASE_POOLER_HOST = "aws-1-ap-northeast-1.pooler.supabase.com";

/**
 * dev Supabase セッションプーラーへの接続を確立する。
 * Node 版: Deno.env の代わりに process.env を使う（同一パスワード解決ロジック）。
 */
export function connectDev(): postgres.Sql {
  // T-03-05: 二重 ref ガード（tests/setup.ts の第1ガードに加え、ここでも確認）
  const ref = process.env.DEV_PROJECT_REF ?? "";
  if (ref !== DEV_PROJECT_REF) {
    throw new Error(
      `[rls.helpers] SAFETY ABORT: DEV_PROJECT_REF='${ref}' !== '${DEV_PROJECT_REF}'. ` +
        "Integration tests must only run against the dev project.",
    );
  }

  // パスワード解決: SUPABASE_DB_PASSWORD があればそれを使う。
  // なければ SUPABASE_DIRECT_CONNECTION_STRING から pgpass 形式でパース。
  let password = process.env.SUPABASE_DB_PASSWORD ?? "";
  if (!password) {
    const connStr = process.env.SUPABASE_DIRECT_CONNECTION_STRING ?? "";
    // postgresql://postgres.<ref>:<password>@db.<ref>.supabase.co:5432/postgres
    const match = connStr.match(/^postgres(?:ql)?:\/\/[^:]+:([^@]+)@/);
    if (match) {
      password = decodeURIComponent(match[1]);
    }
  }
  if (!password) {
    throw new Error(
      "[rls.helpers] ABORT: DB パスワードが取得できませんでした。" +
        "SUPABASE_DB_PASSWORD または SUPABASE_DIRECT_CONNECTION_STRING を .env.local（ルート） に設定してください。",
    );
  }

  const host = process.env.SUPABASE_POOLER_HOST || SUPABASE_POOLER_HOST;

  return postgres({
    host,
    port: 5432,
    database: "postgres",
    username: `postgres.${ref}`,
    password,
    ssl: "require",
    prepare: false, // トランザクションプーラー互換（セッションプーラー 5432 でも無害）
    max: 3,         // テスト用に接続数を絞る
  });
}

/**
 * 指定ユーザーの RLS 文脈でクエリを実行する（Pattern 5 Locked ハーネス）
 *
 * @param sql - postgres Sql インスタンス
 * @param userId - Supabase auth.uid() に見せかける UUID
 * @param fn - トランザクション内で実行するコールバック
 * @returns fn の戻り値
 *
 * 実証: set local role authenticated + set_config(request.jwt.claims) により
 *       auth.uid() が userId を返し RLS が実効する（RESEARCH Pattern 5 dev 実証済み）
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function asUser<T = any>(
  sql: postgres.Sql,
  userId: string,
  fn: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await sql.begin(async (tx: postgres.TransactionSql): Promise<any> => {
    await tx`set local role authenticated`;
    await tx`select set_config(
      'request.jwt.claims',
      ${JSON.stringify({ sub: userId, role: "authenticated" })},
      true
    )`;
    return await fn(tx);
  });
  return result as T;
}
