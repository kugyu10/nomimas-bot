// admin/tests/setup.ts
// RLS_TEST=1 のときのみ env.dev をロードし、prod 安全弁として ref を確認する
// ワークツリー対応: env.dev が相対パスにない場合は env vars が既にセットされていると仮定
if (process.env.RLS_TEST === "1") {
  // env.dev の候補パスを順に試す
  // 1. 通常実行: admin/../env.dev（モノリポルートに env.dev がある想定）
  // 2. ワークツリー実行: 環境変数が事前にセット済みの場合は loadEnvFile をスキップ
  const candidatePaths = [
    "../env.dev",                                            // admin/ からの相対パス
    "../../env.dev",                                         // ワークツリーから2階層上
    "/Users/kugyu10/work/nomimas-bot/env.dev",              // 絶対パス（フォールバック）
  ];

  let loaded = false;
  for (const envPath of candidatePaths) {
    try {
      process.loadEnvFile(envPath);
      loaded = true;
      break;
    } catch {
      // try next path
    }
  }

  if (!loaded && !process.env.DEV_PROJECT_REF) {
    throw new Error(
      "SAFETY ABORT: env.dev が見つからず、DEV_PROJECT_REF も未設定です。" +
      "RLS テストを実行する前に env.dev を読み込むか、環境変数をセットしてください。"
    );
  }

  if (process.env.DEV_PROJECT_REF !== "cmsxvxtcdniqgvhxjqri") {
    throw new Error(
      `SAFETY ABORT: DEV_PROJECT_REF is "${process.env.DEV_PROJECT_REF}", expected "cmsxvxtcdniqgvhxjqri". ` +
      "Integration tests must only run against the dev project."
    );
  }
}
