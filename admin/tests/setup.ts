// admin/tests/setup.ts
// RLS_TEST=1 のときのみルートの .env.local をロードし、prod 安全弁として ref を確認する
// ワークツリー対応: .env.local が相対パスにない場合は env vars が既にセットされていると仮定

// IPv4 優先 DNS: Supabase Auth の IPv6 NAT64 timeout 回避（Node.js 17+ / vitest 実行環境）
// 並列テスト実行時に undici が 64:ff9b::/96 (NAT64) 経由で接続し 10s timeout になる問題を解消
import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");

if (process.env.RLS_TEST === "1") {
  // ルート .env.local（正）の候補パスを順に試す
  // 1. 通常実行: admin/../.env.local（モノリポルートに .env.local がある想定）
  // 2. ENV_DEV_PATH: 任意の絶対パスを環境変数で指定可能（IN-04: マシン固有パスを非コミット化）
  // 3. ワークツリー実行: 環境変数が事前にセット済みの場合は loadEnvFile をスキップ
  const candidatePaths = [
    "../.env.local",                                         // admin/ からの相対パス（リポジトリルート）
    "../../.env.local",                                      // ワークツリーから2階層上
    ...(process.env.ENV_DEV_PATH ? [process.env.ENV_DEV_PATH] : []),
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
      "SAFETY ABORT: ルートの .env.local が見つからず、DEV_PROJECT_REF も未設定です。" +
      "RLS テストを実行する前に .env.local を読み込むか、ENV_DEV_PATH で場所を指定してください。"
    );
  }

  if (process.env.DEV_PROJECT_REF !== "cmsxvxtcdniqgvhxjqri") {
    throw new Error(
      `SAFETY ABORT: DEV_PROJECT_REF is "${process.env.DEV_PROJECT_REF}", expected "cmsxvxtcdniqgvhxjqri". ` +
      "Integration tests must only run against the dev project. " +
      "Run: set -a; source /path/to/.env.local; set +a"
    );
  }
}
