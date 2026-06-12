---
phase: 03-admin-ui
plan: 04
subsystem: ui
tags: [zod, react-hook-form, shadcn, supabase-rls, pooler, vitest, postgres-js, next-rsc]

# Dependency graph
requires:
  - phase: 03-02
    provides: admin scaffold, @supabase/ssr auth helpers, lib/data/oa.ts (listMyOas, resolveSelectedOaId)
  - phase: 03-01
    provides: RLS policies (INSERT/UPDATE), register_owner_by_identity RPC, oa_members fixtures
provides:
  - OA設定ページ (/oa/settings) 3カード構成（基本情報・定型文・質問設定）
  - oaSettingsSchema + questionSchema (Phase 2 JSONB 同形)
  - getOaSettings / updateOaSettings (.select() + 0行チェック)
  - saveOaSettings server action
  - RLS マトリクステスト 19テスト（成功条件6の機械証明）
  - モック認証スモーク 2テスト（成功条件1の機械検証）
  - pooler JWT 切替ハーネス（asUser）
affects: [03-05, phase-04, HUMAN-UAT]

# Tech tracking
tech-stack:
  added:
    - postgres@3.4.9 (devDeps, RLS テストハーネス用)
    - @supabase/supabase-js (auth.test.ts のアプリ経路スモーク)
  patterns:
    - Pattern 5: pooler set_config JWT ハーネス (asUser) — RLS テスト標準
    - silent-0-row trap: updateOaSettings の .select() + 返却行数チェック
    - questionSchema: Phase 2 JSONB {id,text,options[]} と同形に固定（T-03-14）
    - admin_twitter_id 正規化変換 (@前置除去・トリム・空要素除去)

key-files:
  created:
    - admin/lib/schemas/oa.ts
    - admin/lib/actions/oa.ts
    - admin/app/(app)/oa/settings/page.tsx (placeholder → full implementation)
    - admin/components/oa/oa-settings-form.tsx
    - admin/components/oa/question-list-editor.tsx
    - admin/tests/unit/oa-schema.test.ts
    - admin/tests/integration/rls.helpers.ts
    - admin/tests/integration/rls.test.ts
    - admin/tests/integration/auth.test.ts
  modified:
    - admin/lib/data/oa.ts (getOaSettings / updateOaSettings 追加)
    - admin/tests/setup.ts (worktree 対応: loadEnvFile の try/catch フォールバック)

key-decisions:
  - "updateOaSettings に .select() + 返却行数 0 チェックで silent-0-row trap を防ぐ (Pitfall 4)"
  - "asUser ハーネスは postgres.begin() + set local role + set_config で RLS 文脈切替（Pattern 5 Locked）"
  - "admin_twitter_id は oaSettingsSchema の transform で正規化（@除去・空白除去・空要素除去）"
  - "questionSchema は Phase 2 の {id,text,options[]} 形に完全一致（T-03-14: JSONB スキーマ整合）"
  - "tests/setup.ts: worktree では env.dev が ../env.dev に存在しないため try/catch でスキップし shell 注入済み env を使う"

patterns-established:
  - "Pattern 5 (RLS テスト): pooler ハーネス asUser + set_config は admin/tests/integration/ の標準"
  - "0行チェックパターン: data 層の UPDATE は必ず .select() 付きで返却行数を確認する"

requirements-completed: [OA-01, OA-02, AUTH-01]

# Metrics
duration: 9min
completed: 2026-06-12
---

# Phase 3 Plan 04: OA設定ページ + RLS マトリクステスト + モック認証スモーク Summary

**oaSettingsSchema (admin_twitter_id 正規化) + /oa/settings 3カード + pooler JWT ハーネスで RLS マトリクス全件証明 + signInWithPassword スモーク green**

## Performance

- **Duration:** 9 min
- **Started:** 2026-06-12T12:42:34Z
- **Completed:** 2026-06-12T12:51:18Z
- **Tasks:** 3
- **Files modified:** 9 (created 8, modified 2)

## Accomplishments
- OA設定ページ完成: 基本情報・定型文・質問設定の 3 カード + 設定を保存ボタン（UI-SPEC 準拠）
- 成功条件6 機械証明: RLS マトリクス 19 テスト（SELECT 0行/INSERT エラー/UPDATE 0行/with check/co-owner スコープ）全 pass
- 成功条件1 機械検証: signInWithPassword JWT → PostgREST RLS スコープ 2 テスト全 pass
- 冪等性確認: 2 回連続実行で green（dev データ不変）

## Task Commits

Each task was committed atomically:

1. **Task 1: oa zod スキーマ + データ層 + saveOaSettings action** - `7efbe06` (feat)
2. **Task 2: OA設定ページ 3カード** - `eda67ea` (feat)
3. **Task 3: RLS マトリクステスト + モック認証スモーク** - `7975d6c` (feat)
4. **Deviation fix: rls.helpers.ts TypeScript 型エラー** - `86952ad` (fix)

**Plan metadata:** (SUMMARY commit follows)

## Files Created/Modified
- `admin/lib/schemas/oa.ts` - questionSchema + oaSettingsSchema (admin_twitter_id 正規化変換含む)
- `admin/lib/data/oa.ts` - getOaSettings / updateOaSettings (.select() + 0行チェック) を追加
- `admin/lib/actions/oa.ts` - saveOaSettings server action (zod 再検証 → update → revalidatePath)
- `admin/app/(app)/oa/settings/page.tsx` - async RSC (cookie → resolveSelectedOaId → getOaSettings)
- `admin/components/oa/oa-settings-form.tsx` - 3カードフォーム (RHF + zodResolver + saveOaSettings)
- `admin/components/oa/question-list-editor.tsx` - drag&drop + 上下ボタン + 追加/削除/options 編集
- `admin/tests/unit/oa-schema.test.ts` - 17 テスト (accept/reject/正規化ケース)
- `admin/tests/integration/rls.helpers.ts` - pooler asUser ハーネス + connectDev
- `admin/tests/integration/rls.test.ts` - RLS マトリクス 19 テスト
- `admin/tests/integration/auth.test.ts` - モック認証スモーク 2 テスト
- `admin/tests/setup.ts` - worktree 対応 (loadEnvFile try/catch)

## Decisions Made
- `updateOaSettings` は `.select()` 付き UPDATE + 返却行数 0 チェックで Pitfall 4 (silent-0-row trap) を防止
- `questionSchema` は Phase 2 Bot の `{id,text,options[]}` 形と完全一致させることで T-03-14 (JSONB 不整合) を防止
- `asUser` ハーネスは `any` キャストを使って TypeScript の UnwrapPromiseArray 制約を回避（テストファイルのみ）
- `tests/setup.ts` は worktree で `../env.dev` が存在しない場合を `try/catch` でスキップし、shell から注入された環境変数を使う

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] tests/setup.ts が worktree で env.dev を読めない問題**
- **Found during:** Task 3 (RLS テスト実行時)
- **Issue:** setup.ts の `process.loadEnvFile("../env.dev")` がファイルなしで ENOENT エラー。worktree では env.dev は main repo root にのみ存在し、worktree 内の `../env.dev` には存在しない
- **Fix:** loadEnvFile を try/catch でラップ。RLS_TEST=1 実行時は shell から env を注入済みの場合はスキップ
- **Files modified:** admin/tests/setup.ts
- **Verification:** RLS_TEST=1 npx vitest run tests/integration/ → 21 テスト全 pass
- **Committed in:** 7975d6c (Task 3 commit)

**2. [Rule 1 - Bug] rls.helpers.ts の TypeScript 型エラー**
- **Found during:** Task 3 後の npm run build 確認
- **Issue:** `asUser<T>` の戻り値が `UnwrapPromiseArray<T>` 型推論され `T` と不一致。`next build` の TypeScript チェックで error
- **Fix:** `sql.begin()` コールバックを `Promise<any>` に明示型付け、戻り値を `as T` でキャスト
- **Files modified:** admin/tests/integration/rls.helpers.ts
- **Verification:** npm run build: green
- **Committed in:** 86952ad (fix commit)

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 bug)
**Impact on plan:** 両修正ともタスク完了に必須。スコープ拡大なし。

## Issues Encountered
- worktree 環境では env.dev のパス解決が異なるため、テスト setup に対応が必要だった（上記 Rule 3 fix）

## User Setup Required
None - no external service configuration required. 
RLS テスト実行前に `set -a; source env.dev; set +a` が必要（夜間実行時はオーケストレーターが注入）

## Next Phase Readiness
- /oa/settings ページ完成（実ブラウザ保存・ドラッグ操作感は HUMAN-UAT）
- 成功条件 1・6 の機械証明完了
- 03-05 (イベント CRUD) または phase-04 (統合仕上げ) に進む準備完了

## Known Stubs
None - all data flows are wired. OA 設定の保存・取得は getOaSettings / updateOaSettings で実装済み。

## Threat Flags
None - all new endpoints/pages operate under existing RLS policies. No new trust boundaries introduced.

---
*Phase: 03-admin-ui*
*Completed: 2026-06-12*

## Self-Check: PASSED

All 11 required files exist on disk. All 4 task commits verified in git log.
