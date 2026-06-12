// admin/tests/setup.ts
// RLS_TEST=1 のときのみ env.dev をロードし、prod 安全弁として ref を確認する
if (process.env.RLS_TEST === "1") {
  // env.dev のパス候補（main repo と git worktree の両方に対応）
  // - main repo: admin/ の親ディレクトリに env.dev がある → "../env.dev"
  // - git worktree: env.dev は main repo root にのみ存在。
  //   worktree では DEV_PROJECT_REF 等が shell から注入される前提で
  //   loadEnvFile はスキップし、すでにセットされた env を使う。
  const alreadyLoaded = process.env.DEV_PROJECT_REF === "cmsxvxtcdniqgvhxjqri";
  if (!alreadyLoaded) {
    try {
      // 候補1: admin/ の親（main repo 標準パス）
      process.loadEnvFile("../env.dev");
    } catch {
      // ファイルが見つからない場合は無視（worktree では shell 注入済み前提）
    }
  }
  if (process.env.DEV_PROJECT_REF !== "cmsxvxtcdniqgvhxjqri") {
    throw new Error(
      `SAFETY ABORT: DEV_PROJECT_REF is "${process.env.DEV_PROJECT_REF}", expected "cmsxvxtcdniqgvhxjqri". ` +
      "Integration tests must only run against the dev project. " +
      "Run: set -a; source /path/to/env.dev; set +a"
    );
  }
}
