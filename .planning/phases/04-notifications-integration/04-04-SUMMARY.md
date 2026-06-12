---
phase: 04-notifications-integration
plan: 04
subsystem: ui
tags: [nextjs, shadcn, skeleton, tailwind, aria, useTransition]

# Dependency graph
requires:
  - phase: 04-notifications-integration/04-03
    provides: admin テンプレート UI + root テスト + data.test.ts 自己完結化
  - phase: 04-notifications-integration/04-02
    provides: webhook/scraper deployed, E2E 全鎖 green 基盤

provides:
  - "CTA 二重プラス除去（events-page-client, event-form-dialog）"
  - "zinc ハードコード accent 統一 → variant=default / border-primary"
  - "loading.tsx x3（events / events/[id] / oa/settings）Skeleton スクリーン"
  - "OA セレクタ useTransition + Loader2 スピナー切替フィードバック"
  - "aria-label='URLを削除' + Tooltip（event-form-dialog URL行）"
  - "ログイン失敗文言 locked（signInWithPassword → メールアドレスまたはパスワードが正しくありません）"
  - "ステータス列削除（events-table — 全行 '—' の dead column）"
  - "フェーズゲート全 green（Deno 105件 / vitest 76件 / RLS 121件 / build / E2E 全鎖）"
affects: [vercel-deploy, human-uat, v2-features]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "shadcn Tooltip with TooltipProvider wrapping icon-only buttons"
    - "useTransition wrapping router.refresh() for loading state in selectors"
    - "Next.js App Router loading.tsx skeleton with aria-busy=true wrapper"

key-files:
  created:
    - "admin/app/(app)/events/loading.tsx"
    - "admin/app/(app)/events/[id]/loading.tsx"
    - "admin/app/(app)/oa/settings/loading.tsx"
  modified:
    - "admin/components/events/events-page-client.tsx"
    - "admin/components/events/event-form-dialog.tsx"
    - "admin/components/events/linking-tab.tsx"
    - "admin/components/events/events-table.tsx"
    - "admin/components/app-sidebar.tsx"
    - "admin/app/login/page.tsx"
    - "admin/components/oa-selector.tsx"

key-decisions:
  - "login/page.tsx line 30 (signInWithOAuth 起動失敗) は '汎用失敗文言' を適用 — Pitfall 9 準拠。locked 文言はパスワード失敗 line 43 のみ"
  - "SelectTrigger に ChevronDown を明示追加 — isPending で Loader2 に置換するため"
  - "events-table.tsx 空状態の '+ イベントを作成' テキストも修正（grep gate を通過させるため）"

patterns-established:
  - "Pattern: icon-only destructive button → aria-label + TooltipProvider wrapper（question-list-editor と同一）"
  - "Pattern: Next.js loading.tsx — space-y-4 p-6 wrapper + aria-busy=true + aria-hidden=true on each Skeleton"
  - "Pattern: OA selector useTransition — startTransition(() => router.refresh()); isPending でシェブロン→Loader2"

requirements-completed: [NOTIF-01, OA-03]

# Metrics
duration: 35min
completed: 2026-06-12
---

# Phase 04 Plan 04: UI top-3 修正 + a11y + フェーズゲート Summary

**zinc ハードコード accent 統一 + CTA 二重プラス除去 + Skeleton loading x3 + OA セレクタ切替スピナー + aria/コピー/死に列修正 でフェーズゲート全 green（Deno 105 / vitest 76 / RLS 121 / build / E2E 全鎖）**

## Performance

- **Duration:** 35 min
- **Started:** 2026-06-12T20:50:00Z
- **Completed:** 2026-06-12T21:25:58Z
- **Tasks:** 3 (2 file-change tasks + 1 verification gate)
- **Files modified:** 10 (3 created, 7 modified)

## Accomplishments

- top-3 #1: CTA 文字列リテラル "+" を2箇所除去（events-page-client:41 / event-form-dialog:337）。PlusIcon は維持
- top-3 #3: zinc ハードコード accent 4箇所を除去 — variant="default" + border-primary/text-primary に統一。font-medium も除去（UI-SPEC タイポ契約 400/600 のみ）
- top-3 #2: loading.tsx 3ファイル新規作成（events / events/[id] / oa/settings）+ oa-selector.tsx に useTransition + Loader2
- 軽微 5a: event-form-dialog URL 行ゴミ箱に aria-label="URLを削除" + TooltipProvider
- 軽微 5b: login/page.tsx — OAuth 起動失敗は汎用文言、パスワード失敗は locked 文言（Pitfall 9 準拠）
- 軽微 5c: events-table.tsx のステータス列（全行 "—"）を削除
- フェーズゲート: Deno 105 passed / vitest 76 passed / RLS 121 passed / npm run build green / E2E 全鎖 1 passed

## Task Commits

Each task was committed atomically:

1. **Task 1: CTA 二重プラス除去 + accent 統一 + a11y/コピー/死に列** - `1f1bd49` (feat)
2. **Task 2: loading.tsx x3 + OA セレクタ切替フィードバック** - `f51a77c` (feat)
3. **Task 3: フェーズゲート** - (verification only — no file changes)

## Files Created/Modified

- `admin/app/(app)/events/loading.tsx` - イベント一覧 Skeleton（title+CTA+6col header+5 rows、aria-busy）
- `admin/app/(app)/events/[id]/loading.tsx` - イベント詳細 Skeleton（title+subtitle+3 tabs+4 rows）
- `admin/app/(app)/oa/settings/loading.tsx` - OA設定 Skeleton（title+3 cards h-48/h-40/h-64）
- `admin/components/events/events-page-client.tsx` - 二重プラス除去、zinc accent 除去
- `admin/components/events/event-form-dialog.tsx` - "+URL追加"→"URL追加"、bg-zinc-900除去、aria-label+Tooltip追加
- `admin/components/events/linking-tab.tsx` - bg-zinc-900/hover:bg-zinc-700 除去 → variant="default"
- `admin/components/events/events-table.tsx` - ステータス列（ヘッダー+セル）削除
- `admin/components/app-sidebar.tsx` - border-zinc-900 text-zinc-900 font-medium → border-primary text-primary
- `admin/app/login/page.tsx` - OAuth失敗→汎用文言 / パスワード失敗→locked文言
- `admin/components/oa-selector.tsx` - useTransition + Loader2 + aria-busy + aria-label

## Decisions Made

- **login/page.tsx line 30 の文言**: RESEARCH Pitfall 9 に従い `signInWithOAuth` 起動失敗には汎用文言「ログインに失敗しました。もう一度お試しください」を適用。locked 文言（資格情報失敗）は `signInWithPassword` 失敗の line 43 のみ
- **SelectTrigger の ChevronDown 明示**: shadcn SelectTrigger はデフォルトでシェブロンを内包するが、isPending で Loader2 に差し替えるため ChevronDown を明示インポートして isPending 分岐で表示制御
- **events-table.tsx 空状態テキスト修正**: 空状態の「右上の '+ イベントを作成' から…」テキストも grep gate に引っかかったため「イベントを作成」に統一

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] events-page-client.tsx コメント内の grep ヒット修正**
- **Found during:** Task 1 verification
- **Issue:** コメント「ページヘッダー: タイトル + + イベントを作成ボタン」が `+ イベントを作成` grep に一致し検証が失敗
- **Fix:** コメントを「タイトル・イベントを作成ボタン」に変更
- **Files modified:** admin/components/events/events-page-client.tsx
- **Verification:** `! grep -rn "+ イベントを作成" components/` PASSED
- **Committed in:** 1f1bd49 (Task 1 commit)

**2. [Rule 1 - Bug] events-table.tsx 空状態テキストの二重プラス**
- **Found during:** Task 1 execution
- **Issue:** 空状態テキスト「右上の『+ イベントを作成』から…」も grep ターゲットに引っかかる
- **Fix:** 「イベントを作成」に変更（UI-SPEC 確定形と整合）
- **Files modified:** admin/components/events/events-table.tsx
- **Verification:** grep gate PASSED
- **Committed in:** 1f1bd49 (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (Rule 1 — grep gate を通過させる最小差分修正)
**Impact on plan:** スコープ内修正。コメントと空状態テキストの整合性向上のみ。

## Issues Encountered

None — all 5 verification commands passed on first run.

## フェーズゲート結果

| コマンド | 結果 | 成功条件 |
|---------|------|---------|
| `deno test ... supabase/functions/tests/` | 105 passed, 0 failed | Deno 全件 |
| `npx vitest run`（非RLS） | 76 passed, 0 failed | admin unit |
| `RLS_TEST=1 npx vitest run` | 121 passed, 0 failed | RLS マトリクス（root 軸含む） |
| `npm run build` | green（9 routes） | 成功条件2 |
| `E2E_TEST=1 LINE_DRY_RUN=1 deno test e2e_full_chain_test.ts` | 1 passed, 0 failed | 成功条件4 |

成功条件との対応:
- **成功条件1**: E2E (e)(f) 窓内/窓外対比 + notify_window unit（diff=2通知/diff=3非通知）
- **成功条件2**: template unit + RLS + data.test.ts + UI build green
- **成功条件3**: RLS root 軸（root=全OA / owner=自OAのみ）
- **成功条件4**: E2E 全鎖（実Twipla→scrape差分通知→sender→postback×3→窓内通知/窓外非通知/二重通知防止）

## 朝のTODO（HUMAN-UAT — 本プランでは実行しない）

1. **Vercel デプロイ**: `cd admin && npx vercel`（Vercel アカウント認証が必要 — 夜間スコープ外）
2. **実 LINE 通知受信確認**: LINE_DRY_RUN を外して dev webhook に実際に postback し、オーナーの LINE アカウントに通知が届くことを確認
3. **実ブラウザでテンプレート操作**: テンプレートとして保存 → 別OA切替 → テンプレートを適用 → 設定を保存、の一連フローを実ブラウザで確認

## Known Stubs

None — 全 UI 変更は実データに結線済み。loading.tsx は Next.js App Router がルート解決中に自動表示するスケルトンのみ（stub ではなく UX 改善）。

## Threat Flags

変更ファイルにセキュリティ関連の新たなサーフェスなし。ログイン文言変更（T-04-15）は user enumeration を助長しない汎用文言に統一済み。

## Self-Check

Files created exist:
- admin/app/(app)/events/loading.tsx: FOUND
- admin/app/(app)/events/[id]/loading.tsx: FOUND
- admin/app/(app)/oa/settings/loading.tsx: FOUND

Commits exist:
- 1f1bd49: FOUND (Task 1)
- f51a77c: FOUND (Task 2)

## Self-Check: PASSED

## Next Phase Readiness

Phase 4 は全自動検証コマンドが green。HUMAN-UAT（Vercel デプロイ + 実LINE受信 + 実ブラウザ操作）は朝のTODOとして記録済み。
Phase 5（v2 機能: DATA-01 / REMIND-01 / LINK-01）は Phase 4 の全スタックの上に構築可能。

---
*Phase: 04-notifications-integration*
*Completed: 2026-06-12*
