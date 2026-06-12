// admin/tests/setup.ts
// RLS_TEST=1 のときのみ env.dev をロードし、prod 安全弁として ref を確認する
if (process.env.RLS_TEST === "1") {
  process.loadEnvFile("../env.dev");
  if (process.env.DEV_PROJECT_REF !== "cmsxvxtcdniqgvhxjqri") {
    throw new Error(
      `SAFETY ABORT: DEV_PROJECT_REF is "${process.env.DEV_PROJECT_REF}", expected "cmsxvxtcdniqgvhxjqri". ` +
      "Integration tests must only run against the dev project."
    );
  }
}
