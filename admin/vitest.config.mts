// admin/vitest.config.mts
// Source: nextjs.org/docs/app/guides/testing/vitest を node-env 構成に単純化
import { defineConfig } from "vitest/config";
import path from "node:path";
export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname) } },
  test: {
    environment: "node",
    include: process.env.RLS_TEST === "1"
      ? ["tests/**/*.test.ts"]          // full: unit + integration
      : ["tests/unit/**/*.test.ts"],    // quick: unit のみ（ネット不要・決定的）
    setupFiles: ["tests/setup.ts"],     // process.loadEnvFile('../env.dev') を RLS_TEST 時のみ
    passWithNoTests: true,              // テストファイルなしでも exit 0（Wave 2 時点は空）
  },
});
