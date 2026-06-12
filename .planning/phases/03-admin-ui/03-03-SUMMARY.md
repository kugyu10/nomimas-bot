---
phase: "03-admin-ui"
plan: "03"
subsystem: "frontend"
tags: ["next16", "shadcn", "supabase-ssr", "rls", "zod", "react-hook-form", "events-crud", "scraper-trigger"]
dependency_graph:
  requires: ["03-02"]
  provides: ["events-crud", "event-form-dialog", "participants-tab", "scraper-trigger"]
  affects:
    - "admin/lib/schemas/event.ts"
    - "admin/lib/data/events.ts"
    - "admin/lib/data/participants.ts"
    - "admin/lib/actions/events.ts"
    - "admin/app/(app)/events/page.tsx"
    - "admin/app/(app)/events/[id]/page.tsx"
    - "admin/components/events/events-table.tsx"
    - "admin/components/events/event-form-dialog.tsx"
    - "admin/components/events/events-page-client.tsx"
    - "admin/components/events/participants-tab.tsx"
    - "admin/components/events/scrape-button.tsx"
    - "admin/tests/unit/event-schema.test.ts"
    - "admin/tests/integration/scraper-trigger.test.ts"
    - "admin/tests/setup.ts"
tech_stack:
  added:
    - "components/events/ (イベント専用コンポーネント群)"
    - "lib/data/participants.ts (参加者データ層)"
  patterns:
    - "eventFormSchema + zodResolver on-blur validation (A3: zod 4 + @hookform/resolvers 5.x 動作確認)"
    - "updateEvent .select() + 0-row guard (Pitfall 4: RLS silent-0-row 罠)"
    - "triggerScrape Pattern 6: user JWT Bearer → /functions/v1/scraper"
    - "Next 16: await props.params for dynamic routes"
    - "vitest multi-path env.dev lookup for worktree execution"
key_files:
  created:
    - "admin/lib/schemas/event.ts"
    - "admin/lib/data/events.ts"
    - "admin/lib/data/participants.ts"
    - "admin/lib/actions/events.ts"
    - "admin/app/(app)/events/[id]/page.tsx"
    - "admin/components/events/events-table.tsx"
    - "admin/components/events/event-form-dialog.tsx"
    - "admin/components/events/events-page-client.tsx"
    - "admin/components/events/participants-tab.tsx"
    - "admin/components/events/scrape-button.tsx"
    - "admin/tests/unit/event-schema.test.ts"
    - "admin/tests/integration/scraper-trigger.test.ts"
  modified:
    - "admin/app/(app)/events/page.tsx (スタブ → async RSC + listEvents)"
    - "admin/tests/setup.ts (worktree 対応: マルチパス env.dev 探索)"
decisions:
  - "A3 resolved: zodResolver(@hookform/resolvers 5.4.0) + zod 4.4.3 は型互換あり。confirm_days_before の .default(3) を schema から除去して form defaultValues に移動することで型エラーを解消"
  - "event_platform_urls は追加のみ（削除 UI なし）— RESEARCH Open Question 2 v1 判断"
  - "vitest setup.ts: worktree パスで env.dev が見つからない場合の候補パスフォールバック（絶対パス含む）"
  - "participants scraped_at: event_platform_urls.created_at を代用（専用列なし）"
metrics:
  duration: "~70 minutes"
  completed: "2026-06-12"
  tasks_completed: 3
  files_modified: 13
---

# Phase 03 Plan 03: イベント管理（EVENT-01）完成 Summary

**One-liner:** イベント CRUD（zod + RHF フォーム、RLS 0行ガード）+ 参加者タブ + ユーザーJWT scraper トリガー（Pattern 6）が動作し、unit 27件 + integration 2件 green、`npm run build` green。

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | event zod スキーマ + データ層 + server actions（unit テスト先行） | `d2c4d16` | lib/schemas/event.ts, lib/data/events.ts, lib/actions/events.ts, tests/unit/event-schema.test.ts |
| 2 | イベント一覧ページ + 作成/編集ダイアログ（UI-SPEC 準拠） | `95016ac` | app/(app)/events/page.tsx, components/events/events-table.tsx, event-form-dialog.tsx, events-page-client.tsx |
| 3 | イベント詳細ページ（タブ shell + 参加者タブ）+ 参加者取得トリガー + 統合テスト | `29625ad` | app/(app)/events/[id]/page.tsx, participants-tab.tsx, scrape-button.tsx, lib/data/participants.ts, tests/integration/scraper-trigger.test.ts |

## What Was Built

### Task 1: event zod スキーマ + データ層 + server actions

**lib/schemas/event.ts:**
- `platformUrlSchema`: `^https://twipla\.jp\/events\/[0-9]+$` regex（http/query/fragment/port/末尾スラッシュ reject）
- `eventFormSchema`: title/event_date 必須、confirm_days_before 1/2/3/5/7 整数、platform_urls min 1
- `composeMeetingAt`: JST 固定 timestamptz 合成純関数（`${date}T${time}:00+09:00`）

**lib/data/events.ts:**
- `listEvents`: OA スコープ + 参加者数/回答済み数を TS で集計
- `getEvent`: platform_urls 込み詳細取得
- `insertEvent`: events INSERT → event_platform_urls INSERT
- `updateEvent`: `.select("id")` 付き UPDATE + 返却行数 0 → 「保存に失敗しました」（Pitfall 4 対策）
- URL は追加のみ（削除 UI/処理は v1 スコープ外 — RESEARCH Open Question 2）

**lib/actions/events.ts:**
- `createEvent` / `updateEvent`: zod safeParse 再検証 → data 層 → revalidatePath
- `triggerScrape`: getSession で access_token 取得 → event_platform_urls 全 URL に POST /functions/v1/scraper（Pattern 6、Bearer user token、30s timeout）

**tests/unit/event-schema.test.ts:**
- 27 テスト pass
- platformUrlSchema reject 系 9 ケース（http/query/fragment/末尾スラッシュ/非twipla/ポート 等）
- confirm_days_before 全有効値 + 無効値（4）
- composeMeetingAt JST 合成（undefined/null/空文字/スペースで null）

### Task 2: イベント一覧ページ + 作成/編集ダイアログ

**app/(app)/events/page.tsx（async RSC）:**
- listMyOas + resolveSelectedOaId でスコープ解決
- listEvents を EventsPageClient に渡す

**components/events/events-page-client.tsx（client）:**
- 「+ イベントを作成」accent ボタン（zinc-900）
- 成功 alert + router.refresh() + ダイアログ状態管理

**components/events/events-table.tsx:**
- 列: イベント名 | 開催日 | 参加者数 | 回答済み/総数 | ステータス | 操作（詳細 link button sm）
- 空状態: 「まだイベントがありません」+ body copy（UI-SPEC）
- 行高 40px（compact h-10）

**components/events/event-form-dialog.tsx（client）:**
- Dialog + `useForm({ resolver: zodResolver(eventFormSchema), mode: "onBlur" })`
- 8 フィールド: イベント名(必須)/開催日(必須)/集合時刻/場所/参加費(suffix 円)/店情報備考/confirm_days_before(select)/platform_urls(repeat group)
- `useFieldArray` で URL グループの追加/削除
- Footer: [閉じる(ghost)] [イベントを保存(accent, disabled until valid)]
- 成功: ダイアログ閉鎖 + onSuccess(); 失敗: ダイアログ維持 + footer 下 Alert

**A3 検証結果:**
- `@hookform/resolvers@5.4.0` + `zod@4.4.3` の zodResolver は**動作する**
- ただし `z.number().default(3)` を使うと resolver の型推論が input 型（number | undefined）と output 型（number）で不一致になり TS エラー
- **対策**: `eventFormSchema` から `.default(3)` を除去し、form の `defaultValues: { confirm_days_before: 3 }` で初期値を提供。動作・型・テスト全て OK

### Task 3: イベント詳細ページ + 参加者タブ + scraper トリガー + 統合テスト

**app/(app)/events/[id]/page.tsx（async RSC）:**
- `const { id } = await params` — Next 16 params Promise（Pitfall 2 対応）
- getEvent + listParticipantsByEvent で 1 ページ内完結
- ScrapeButton + Tabs（参加者/回答状況/紐付け）

**components/events/participants-tab.tsx:**
- 列: Twipla参加者名 | Xアカウント | 取得日時 | 紐付けステータス(badge)
- `linkStatusStyles` = UI-SPEC Status Badge Reference そのまま（linked: green/unlinked: orange）
- 空状態: 「参加者がいません」+ body copy

**components/events/scrape-button.tsx:**
- 実行中 disabled + スピナー（Loader2Icon animate-spin）
- 成功: 「参加者の取得が完了しました（{n}件）」alert + router.refresh()
- 失敗: 「参加者の取得に失敗しました。URLを確認してもう一度お試しください」alert

**tests/integration/scraper-trigger.test.ts:**
- `dev-owner-1@nomimas.test` + `MOCK_USER_PASSWORD` で signInWithPassword
- 未登録 URL (`/events/0000000000`) で POST → status 401 以外を assert（= verify_jwt 通過）
- Authorization なし → 401 を assert（ゲートウェイが機能している）
- 2 テスト pass（実スクレイプなし）

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] A3: zodResolver + zod 4.x の confirm_days_before 型エラー**
- **Found during:** Task 2 (TypeScript check)
- **Issue:** `z.number().default(3).refine(...)` の output 型が `number` だが resolver の input 推論は `number | undefined`。RHF の Resolver generic と不一致で TS2322 エラー
- **Fix:** schema から `.default(3)` を除去、form の `defaultValues: { confirm_days_before: 3 }` で初期値を設定。同時に unit test の「default は 3」テストを「未指定は reject」テストに更新
- **Files modified:** `admin/lib/schemas/event.ts`, `admin/tests/unit/event-schema.test.ts`
- **Commit:** `95016ac`
- **A3 verdict:** zodResolver + zod 4.4.3 は**動作する**（`.default()` の使用方法に制約あり）

**2. [Rule 3 - Blocking] worktree 実行時の env.dev パス解決エラー**
- **Found during:** Task 3 (integration test 実行)
- **Issue:** `tests/setup.ts` の `process.loadEnvFile("../env.dev")` が worktree 内では存在しないパスを参照して ENOENT。worktree には env.dev がない（gitignore）
- **Fix:** setup.ts を複数候補パスで順に試す実装に更新（`../env.dev` → `../../env.dev` → 絶対パス）。どれもなければ DEV_PROJECT_REF が設定済みかチェック
- **Files modified:** `admin/tests/setup.ts`
- **Commit:** `29625ad`

## Known Stubs

| Stub | File | Reason |
|------|------|--------|
| 「まだ回答がありません」プレースホルダ | `admin/app/(app)/events/[id]/page.tsx` | 回答状況タブは 03-05 が実装予定 |
| 「データがありません」プレースホルダ | `admin/app/(app)/events/[id]/page.tsx` | 紐付けタブは 03-05 が実装予定 |
| ステータス列「—」 | `admin/components/events/events-table.tsx` | イベントステータス（開催前/開催済み等）は DB 列未定義のため保留 |
| participants.scraped_at | `admin/lib/data/participants.ts` | event_platform_urls.created_at を代用。dedicated 列がない（scraper が更新しない） |

03-05（回答状況・紐付け実装）がタブの中身を実装する予定。イベント詳細のタブ構造と URL は本タスクで確定済み。

## Threat Flags

（計画の脅威モデル通りに実装済み — 新規の表面は発見されていない）

| Threat ID | Status |
|-----------|--------|
| T-03-10 (createEvent/updateEvent 入力 Tampering) | MITIGATED: server action で zod safeParse 再検証 |
| T-03-11 (triggerScrape URL SSRF) | MITIGATED: platformUrlSchema regex + scraper 側 canHandle 二重防御 |
| T-03-12 (RLS 0行 UPDATE 成功偽装) | MITIGATED: updateEvent が .select() + length === 0 チェック |
| T-03-13 (scraper DoS) | ACCEPTED: ボタン in-flight disabled + 30s timeout |

## Self-Check

**Created files:**
- [x] `admin/lib/schemas/event.ts` 存在確認
- [x] `admin/lib/data/events.ts` 存在確認
- [x] `admin/lib/data/participants.ts` 存在確認
- [x] `admin/lib/actions/events.ts` 存在確認
- [x] `admin/app/(app)/events/page.tsx` 存在確認
- [x] `admin/app/(app)/events/[id]/page.tsx` 存在確認
- [x] `admin/components/events/events-table.tsx` 存在確認
- [x] `admin/components/events/event-form-dialog.tsx` 存在確認
- [x] `admin/components/events/events-page-client.tsx` 存在確認
- [x] `admin/components/events/participants-tab.tsx` 存在確認
- [x] `admin/components/events/scrape-button.tsx` 存在確認
- [x] `admin/tests/unit/event-schema.test.ts` 存在確認
- [x] `admin/tests/integration/scraper-trigger.test.ts` 存在確認

**Commits:**
- [x] commit `d2c4d16` 存在確認（Task 1）
- [x] commit `95016ac` 存在確認（Task 2）
- [x] commit `29625ad` 存在確認（Task 3）

**Security assertions:**
- [x] `git grep service_role -- admin/` = コメント行のみ（0 実使用）
- [x] `git ls-files admin | grep -E '\.env'` = 0件
- [x] admin/.env.local は gitignore 対象

**Functional:**
- [x] `npx vitest run tests/unit/` = 27/27 pass
- [x] `RLS_TEST=1 npx vitest run tests/integration/scraper-trigger.test.ts` = 2/2 pass
- [x] `npm run build` exit 0 (/events/[id] route 追加)
- [x] UI-SPEC Copywriting Contract: イベントを保存/閉じる/+ イベントを作成/まだイベントがありません/参加者がいません — 全文言ソースに存在確認

## Self-Check: PASSED
