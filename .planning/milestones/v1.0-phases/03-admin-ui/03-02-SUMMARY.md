---
phase: "03-admin-ui"
plan: "02"
subsystem: "frontend"
tags: ["next16", "shadcn", "supabase-ssr", "auth", "x-oauth", "mock-auth", "rls", "oa-selector"]
dependency_graph:
  requires: ["03-01"]
  provides: ["admin-scaffold", "auth-two-path", "route-protection", "oa-selector-shell", "vitest-infra"]
  affects:
    - "admin/package.json"
    - "admin/proxy.ts"
    - "admin/lib/supabase/client.ts"
    - "admin/lib/supabase/server.ts"
    - "admin/lib/supabase/proxy.ts"
    - "admin/app/login/page.tsx"
    - "admin/app/auth/callback/route.ts"
    - "admin/app/no-access/page.tsx"
    - "admin/app/(app)/layout.tsx"
    - "admin/components/oa-selector.tsx"
    - "admin/lib/data/oa.ts"
tech_stack:
  added:
    - "next@16.2.9 (Turbopack, App Router, proxy.ts)"
    - "@supabase/ssr@0.12.0 (createBrowserClient, createServerClient, updateSession)"
    - "@supabase/supabase-js@2.108.1"
    - "shadcn@4.11.0 CLI (radix-nova preset, 24 components)"
    - "tailwindcss@4.x"
    - "zod@4.4.3"
    - "react-hook-form@7.78.0"
    - "@hookform/resolvers@5.4.0"
    - "vitest@4.1.8 (node env, passWithNoTests)"
    - "postgres@3.4.9 (devDependency, RLS test harness)"
  patterns:
    - "@supabase/ssr 3点セット (client/server/proxy.ts)"
    - "Next 16 proxy.ts (export function proxy, matcher)"
    - "getClaims() for server-side auth (not getSession)"
    - "PKCE flow via exchangeCodeForSession"
    - "cookie + localStorage dual write for OA scope"
    - "resolveSelectedOaId pure function (testable)"
key_files:
  created:
    - "admin/ (全体スキャフォールド)"
    - "admin/proxy.ts"
    - "admin/lib/supabase/client.ts"
    - "admin/lib/supabase/server.ts"
    - "admin/lib/supabase/proxy.ts"
    - "admin/app/login/page.tsx"
    - "admin/app/auth/callback/route.ts"
    - "admin/app/no-access/page.tsx"
    - "admin/app/(app)/layout.tsx"
    - "admin/app/(app)/events/page.tsx"
    - "admin/app/(app)/oa/settings/page.tsx"
    - "admin/components/app-sidebar.tsx"
    - "admin/components/app-header.tsx"
    - "admin/components/oa-selector.tsx"
    - "admin/lib/data/oa.ts"
    - "admin/lib/actions/auth.ts"
    - "admin/vitest.config.mts"
    - "admin/tests/setup.ts"
  modified:
    - "admin/app/layout.tsx (lang=ja)"
    - "admin/app/page.tsx (redirect to /events)"
    - "admin/next.config.ts (turbopack.root)"
    - "admin/package.json (test scripts)"
decisions:
  - "shadcn init uses -y -b radix -p nova (not --style new-york; verified in 03-RESEARCH)"
  - "proxy.ts + export function proxy (not middleware.ts; Next 16 pattern)"
  - "getClaims() only for auth decisions; getSession() only for token extraction"
  - "vitest passWithNoTests=true to pass with 0 test files (Wave 2 empty state)"
  - "turbopack.root = admin/ to suppress monorepo workspace root warning"
  - "cookie SameSite=Lax for nomimas_selected_oa_id (same-site form submissions work)"
  - "open redirect guard: safeNext requires leading '/' (T-03-09)"
metrics:
  duration: "~90 minutes"
  completed: "2026-06-12"
  tasks_completed: 3
  files_modified: 53
---

# Phase 03 Plan 02: admin/ スキャフォールド + 認証基盤 + OA セレクタシェル Summary

**One-liner:** Next.js 16 + shadcn/ui (radix-nova) スキャフォールド + @supabase/ssr による X OAuth / モック二経路認証 + ルート保護 + cookie/localStorage 二重書込み OA セレクタシェル。`npm run build` green + 未認証 /events → /login 307 確認済み。

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | admin/ スキャフォールド + shadcn/ui + vitest 基盤 | `259d5b7` | admin/ (44 files), vitest.config.mts, tests/setup.ts |
| 2 | @supabase/ssr 3点セット + ルート保護 + ログイン二経路 | `a766661` | lib/supabase/*, proxy.ts, login/, auth/callback/, no-access/, lib/actions/auth.ts |
| 3 | アプリシェル + OA セレクタ + プレースホルダページ | `e0026b0` | app/(app)/, components/app-*.tsx, oa-selector.tsx, lib/data/oa.ts |

## What Was Built

### Task 1: スキャフォールド + 依存 + vitest 基盤

**スキャフォールド:**
- `create-next-app@latest` 研究検証済みフラグで実行（--disable-git でモノリポ内 .git 抑制）
- 自動生成された AGENTS.md / CLAUDE.md / README.md を削除（プロジェクト規約との矛盾防止）
- `shadcn init -y -b radix -p nova` → components.json: baseColor=neutral / style=radix-nova / lucide icons

**パッケージ正当性ゲート (T-03-SC):**
- `vitest`: `npm view vitest repository.url` = `git+https://github.com/vitest-dev/vitest.git` ✓
- `postgres`: `npm view postgres repository.url` = `git+https://github.com/porsager/postgres.git` ✓
- 両パッケージとも postinstall スクリプト空 ✓ → install 実行

**vitest 基盤:**
- `vitest.config.mts`: node 環境のみ / `RLS_TEST=1` で integration 含む include 切替 / `passWithNoTests: true`
- `tests/setup.ts`: `RLS_TEST=1` 時のみ `process.loadEnvFile('../env.dev')` + `DEV_PROJECT_REF` 安全弁

**検証結果:**
- `npm run build` exit 0 ✓
- `npx vitest run` exit 0 (0件・passWithNoTests) ✓
- `git check-ignore`: admin/node_modules, admin/.next, admin/.env.local → ignored ✓
- `git ls-files admin | grep -E '\.env'` = 0件 ✓

### Task 2: @supabase/ssr 3点セット + 認証基盤

**3点セット（公式コード原型維持）:**
- `lib/supabase/client.ts`: `createBrowserClient` (NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)
- `lib/supabase/server.ts`: `createServerClient` + `await cookies()` (Next 16 必須)
- `lib/supabase/proxy.ts`: `updateSession` — getClaims() のみで認証判定、supabaseResponse をそのまま返す（cookie 同期契約 T-03-08 準拠）

**proxy.ts (Next 16 middleware 後継):**
- `export function proxy` + matcher（静的アセット除外）
- 未認証かつ /login・/auth 以外 → /login redirect

**ログイン二経路:**
- X OAuth: `signInWithOAuth({ provider: 'x' })` (`'twitter'` は使わない — OAuth 1.0a)
- モック: `NEXT_PUBLIC_AUTH_MOCK=1` 時のみ email+password フォーム表示 → `signInWithPassword` → `register_owner_by_identity` RPC 呼出し → /events
- `app/auth/callback/route.ts`: `exchangeCodeForSession` → `register_owner_by_identity` → safeNext redirect（open redirect 対策 T-03-09: 先頭 '/' 検証）

**その他:**
- `app/no-access/page.tsx`: 「このOAへのアクセス権限がありません」（UI-SPEC copy）
- `lib/actions/auth.ts`: `signOut` server action → redirect('/login')
- `git grep service_role -- admin/` = 0件 ✓ (T-03-07)

### Task 3: アプリシェル

**lib/data/oa.ts:**
- `listMyOas(supabase)`: `oa_configs` select（RLS で自 OA のみ返る）
- `resolveSelectedOaId(cookieValue, myOas)`: cookie 値が OA 一覧にない場合は先頭フォールバック（純関数 — 03-04 以降のテスト対象）

**app/(app)/layout.tsx:**
- `getClaims()` で認証確認 → `listMyOas()` が 0 件なら `/no-access` redirect
- `SidebarProvider` + `AppSidebar` + `AppHeader` + `main` (padding 24px)
- cookie `nomimas_selected_oa_id` を読んで `resolveSelectedOaId` でスコープ解決

**components/app-sidebar.tsx:**
- イベント一覧 (/events) + OA設定 (/oa/settings)
- アクティブ項目: `border-l-2 border-zinc-900 text-zinc-900 font-medium`（UI-SPEC Accent 用途 2）

**components/app-header.tsx:**
- `SidebarTrigger` + `OaSelector`（max-w-[280px]）+ Avatar + DropdownMenu（ログアウト）
- 表示名: `user_metadata.user_name` → `@{screen_name}` / フォールバック: email

**components/oa-selector.tsx:**
- `document.cookie = nomimas_selected_oa_id; path=/`（server components から読める）
- `localStorage.setItem(nomimas_selected_oa_id, value)`（UI-SPEC Interaction Contract）
- 変更時 `router.refresh()`（RSC 再フェッチ）

**起動検証結果:**
- `curl http://localhost:3101/events` → HTTP 307 / Location: http://localhost:3101/login ✓
- 未認証 GET /events → /login リダイレクト（AUTH-01 ルート保護の機械検証）

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing] passWithNoTests 設定を追加**
- **Found during:** Task 1 verify (vitest run exit 1 with no test files)
- **Issue:** vitest はデフォルトでテストファイルが 0 件の場合 exit code 1 を返す。Wave 2 時点ではまだユニットテストを書いていない
- **Fix:** `vitest.config.mts` に `passWithNoTests: true` を追加
- **Files modified:** `admin/vitest.config.mts`
- **Commit:** `259d5b7`

**2. [Rule 1 - Bug] turbopack.root + outputFileTracingRoot の競合**
- **Found during:** Task 3 verify (next build warning/error)
- **Issue:** `turbopack.root` と `outputFileTracingRoot` を両方設定すると「両者は同一値でなければならない」エラーが出た
- **Fix:** `outputFileTracingRoot` を除去し `turbopack.root = __dirname`（admin/ 内）のみに統一
- **Files modified:** `admin/next.config.ts`
- **Commit:** `e0026b0`

## Known Stubs

| Stub | File | Reason |
|------|------|--------|
| `<p>データがありません</p>` | `admin/app/(app)/events/page.tsx` | 03-03 (イベント一覧 + 作成) が本実装。Wave 2 ではプレースホルダのみ |
| `<p>データがありません</p>` | `admin/app/(app)/oa/settings/page.tsx` | 03-04 (OA設定フォーム) が本実装。Wave 2 ではプレースホルダのみ |

これらのスタブはプランの想定内。03-03/03-04 で実データに置換予定。

## Threat Flags

なし（計画の脅威モデル通りに実装済み）

| Threat ID | Status |
|-----------|--------|
| T-03-SC (npm supply chain) | MITIGATED: vitest/postgres 両方の repository.url + postinstall 空を確認してからインストール |
| T-03-06 (getSession()信用) | MITIGATED: proxy.ts / layout.tsx は getClaims() のみで認証判定。getSession() は token 取り出しのみ |
| T-03-07 (NEXT_PUBLIC焼き込み) | MITIGATED: NEXT_PUBLIC は URL + publishable キー + AUTH_MOCK の3つのみ。git grep service_role = 0件 |
| T-03-08 (proxy cookie同期契約) | MITIGATED: 公式コード原型維持 + supabaseResponse をそのまま返す + getClaims() の間に挿入なし |
| T-03-09 (open redirect) | MITIGATED: callback の next パラメータは先頭 '/' チェック。存在しない場合 /events にフォールバック |

## Self-Check

**Created files:**
- [x] `admin/proxy.ts` 存在確認
- [x] `admin/lib/supabase/client.ts` 存在確認
- [x] `admin/lib/supabase/server.ts` 存在確認
- [x] `admin/lib/supabase/proxy.ts` 存在確認
- [x] `admin/app/login/page.tsx` 存在確認
- [x] `admin/app/auth/callback/route.ts` 存在確認
- [x] `admin/app/no-access/page.tsx` 存在確認
- [x] `admin/app/(app)/layout.tsx` 存在確認
- [x] `admin/components/oa-selector.tsx` 存在確認
- [x] `admin/lib/data/oa.ts` 存在確認
- [x] `admin/vitest.config.mts` 存在確認
- [x] `admin/tests/setup.ts` 存在確認

**Commits:**
- [x] commit `259d5b7` 存在確認（Task 1）
- [x] commit `a766661` 存在確認（Task 2）
- [x] commit `e0026b0` 存在確認（Task 3）

**Security assertions:**
- [x] `git ls-files admin | grep -E '\.env'` = 0件
- [x] `git grep service_role -- admin/` = 0件
- [x] admin/.env.local は gitignore 対象

**Functional:**
- [x] `npm run build` exit 0
- [x] `npx vitest run` exit 0 (passWithNoTests)
- [x] 未認証 GET /events → HTTP 307 / Location: /login

## Self-Check: PASSED
