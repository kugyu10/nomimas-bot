---
phase: 04-notifications-integration
plan: 01
subsystem: database
tags: [supabase, postgres, rls, deno, typescript, migrations, security-definer]

# Dependency graph
requires:
  - phase: 03-admin-ui
    provides: "migrations 2本 (create_core_tables / enable_rls), setup-dev.ts 冪等パターン, Deno テスト基盤 (82件+)"
provides:
  - "oa_members.line_user_id text nullable 列 (通知先保持)"
  - "root_users テーブル (deny-by-default, T-04-01)"
  - "question_templates テーブル (oa_members RLS + root SELECT)"
  - "notification_logs テーブル (service role INSERT, SELECT + root RLS)"
  - "is_root() SECURITY DEFINER 関数 (search_path='', T-04-02)"
  - "既存 SELECT ポリシー 7本 + 新テーブル 2本 = 9本の or (select public.is_root()) 拡張"
  - "_shared/notify/window.ts: todayJst() + isWithinNotifyWindow() 純関数"
  - "_shared/notify/diff.ts: diffParticipants() + ExistingRow/DiffResult 型"
  - "_shared/notify/messages.ts: 通知文面組み立て純関数 3本 (LINE userId 非含有 T-04-03)"
  - "setup-dev.ts 拡張: dev-root@nomimas.test + root_users 投入 + user1 line_user_id"
  - "dev 再適用済み: root/通知先データ投入済み + 全回帰 green"
affects:
  - "04-02: notifier.ts / webhook / scraper (notify モジュール利用)"
  - "04-03: RLS マトリクス root 軸 (root_users + is_root() 前提)"
  - "04-04: 質問テンプレート UI (question_templates テーブル前提)"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "is_root() SECURITY DEFINER: search_path='' + スキーマ修飾 + revoke public/anon — register_owner_by_identity と同規約"
    - "or (select public.is_root()) initplan化: 既存 (select auth.uid()) と同じ行ごと再評価回避"
    - "root_users deny-by-default: ポリシーゼロで authenticated から不可視"
    - "select-before-upsert 差分: upsert 前 1 select で既存 Map を作り純関数で差分計算"
    - "TDD RED→GREEN: テストファイル先行コミット → 実装コミットの 2 ステップ"

key-files:
  created:
    - "supabase/functions/_shared/notify/window.ts"
    - "supabase/functions/_shared/notify/diff.ts"
    - "supabase/functions/_shared/notify/messages.ts"
    - "supabase/functions/tests/notify_window_test.ts"
    - "supabase/functions/tests/notify_diff_test.ts"
    - "supabase/functions/tests/notify_messages_test.ts"
  modified:
    - "supabase/migrations/20260611171037_create_core_tables.sql"
    - "supabase/migrations/20260611171038_enable_rls.sql"
    - "scripts/setup-dev.ts"

key-decisions:
  - "root_users ポリシーゼロ確定: authenticated から不可視 = root の存在秘匿 (T-04-01)"
  - "is_root() を SELECT ポリシーより前に定義: migration 内の前方参照を避けるために RLS 有効化直後に関数定義を移動"
  - "is_root() は 9本全て or (select public.is_root()) でラップ: 裸の or is_root() 禁止 (initplan 必須)"
  - "messages.ts シグネチャに userId 引数なし: 型で PII 漏洩を構造的に防止 (T-04-03)"
  - "worktree の supabase link が必要: db reset はメインリポジトリでなくワークツリーから実行すること"

requirements-completed: [NOTIF-01, OA-03]

# Metrics
duration: 60min
completed: 2026-06-13
---

# Phase 4 Plan 01: スキーマ基盤 + 通知純関数 + dev 再適用 Summary

**root_users/question_templates/notification_logs テーブル + is_root() SECURITY DEFINER + SELECT 9本 OR 拡張 + _shared/notify 純関数3本 (TDD) + setup-dev 拡張で dev に Phase 4 スキーマを完全適用**

## Performance

- **Duration:** 60 min
- **Started:** 2026-06-13T06:00:00Z
- **Completed:** 2026-06-13T07:00:00Z
- **Tasks:** 3
- **Files modified:** 9

## Accomplishments

- 既存マイグレーション 2本を in-place 編集してスキーマ 4点 + is_root() + OR 拡張 9本を追加。`db reset --linked --yes` が exit 0 で通り構文・依存順の健全性を機械証明した
- `_shared/notify/` に純関数 3本 (window / diff / messages) を TDD RED→GREEN で実装。窓境界 (diff=0/1/2→通知、diff=3/-1/null→非通知) とPII非含有 (T-04-03) をユニットテストで網羅
- `setup-dev.ts` を拡張して dev-root/root_users 投入と user1 の line_user_id 設定を冪等化。全回帰 (Deno 105件 + admin vitest 65件 + RLS_TEST 94件) が無修正で green

## Task Commits

1. **Task 1: マイグレーション in-place 編集** - `8bc906d` (feat)
2. **Task 2 RED: 通知純関数テスト (失敗確認)** - `a2672cc` (test)
3. **Task 2 GREEN: 通知純関数実装** - `07233c6` (feat)
4. **Task 3: setup-dev 拡張** - `062685d` (feat)

## Files Created/Modified

- `supabase/migrations/20260611171037_create_core_tables.sql` - oa_members.line_user_id / root_users / question_templates / notification_logs 追加
- `supabase/migrations/20260611171038_enable_rls.sql` - is_root() 関数 + RLS 有効化 3テーブル + SELECT 9本 OR 拡張 + question_templates/notification_logs ポリシー
- `supabase/functions/_shared/notify/window.ts` - todayJst() + isWithinNotifyWindow() 純関数
- `supabase/functions/_shared/notify/diff.ts` - diffParticipants() + ExistingRow/DiffResult 型
- `supabase/functions/_shared/notify/messages.ts` - buildAnswerNotification / buildCompletionNotification / buildScrapeChangesNotification
- `supabase/functions/tests/notify_window_test.ts` - 8 ケース (diff=0/1/2/3/-1/null/10 + YYYY-MM-DD 形式確認)
- `supabase/functions/tests/notify_diff_test.ts` - 5 ケース (不変/新規/status変化/初回/混在)
- `supabase/functions/tests/notify_messages_test.ts` - 11 ケース (3種 x 3要素確認 + LINE userId 非含有 T-04-03)
- `scripts/setup-dev.ts` - dev-root@nomimas.test 作成 + root_users 投入 + user1 line_user_id UPDATE

## Decisions Made

- `is_root()` 関数をマイグレーション内の SELECT ポリシー定義より**前**に配置: SQL は前方参照不可のため、RLS 有効化直後に関数定義ブロックを置いた
- `root_users` テーブルにポリシーを一切作らない: deny-by-default により authenticated から不可視 = root の存在自体を秘匿 (T-04-01)
- `messages.ts` のシグネチャから userId 引数を完全に排除: 型レベルで PII 漏洩経路を塞ぐ (T-04-03)
- worktree での supabase link が必要: `db reset --linked --yes` はメインリポジトリではなくワークツリーのディレクトリから実行する必要があった (ワークツリーはサブディレクトリに独自の .temp を持たないため)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] is_root() 関数定義順序修正**
- **Found during:** Task 1 (マイグレーション編集)
- **Issue:** RESEARCH の Pattern 5 では `is_root()` 定義を末尾に置く例示だったが、SELECT ポリシーの `or (select public.is_root())` 参照が前方参照になり Postgres がエラーを返す
- **Fix:** `is_root()` 定義ブロックを RLS 有効化直後・SELECT ポリシーの前に移動。末尾の重複定義を削除
- **Files modified:** supabase/migrations/20260611171038_enable_rls.sql
- **Verification:** `db reset --linked --yes` が exit 0 で成功。`grep -c "or (select public.is_root())"` = 9
- **Committed in:** 8bc906d (Task 1 commit)

**2. [Rule 3 - Blocking] worktree の supabase link 欠落**
- **Found during:** Task 3 (db reset 実行時)
- **Issue:** worktree には supabase/.temp が存在せず、メインリポジトリから `db reset` すると worktree の修正済みマイグレーションではなくメインリポジトリの古いファイルが適用される。その結果 `public.root_users` が存在しない状態で setup-dev.ts が失敗した
- **Fix:** ワークツリーディレクトリで `supabase link --project-ref cmsxvxtcdniqgvhxjqri` を実行してリンクを確立。以降の `db reset` / `setup-dev.ts` はワークツリーから実行
- **Files modified:** supabase/.temp/project-ref (gitignore 対象 — コミットなし)
- **Verification:** `db reset --linked --yes` exit 0 + SQL 検証 5 項目すべて OK
- **Committed in:** 062685d (Task 3 commit、ただし .temp は gitignore)

---

**Total deviations:** 2 auto-fixed (Rule 3 - Blocking x2)
**Impact on plan:** どちらも実行環境の構造的問題に対する自動修正。スコープの変更はなし。

## Issues Encountered

- worktree の supabase link 欠落は夜間無人実行で想定外の詰まりポイント。今後の Plan でも worktree から supabase CLI を使う場合は最初に link 確認が必要 (deferred-items として記録)

## Known Stubs

なし — 全テーブル・全関数が実装済み。純関数3本はユニットテスト通過確認済み。

## Threat Flags

なし — PLAN.md の `<threat_model>` 全項目 (T-04-01 〜 T-04-05) を実装で対処済み。新たな脅威面の追加はなし。

## Next Phase Readiness

- Wave 2 並列実行の前提 (スキーマ確定・純関数準備済み) がすべて成立
- 04-02: notifier.ts + webhook/scraper への通知結線 → `_shared/notify/` 3モジュールを import して組み立て可能
- 04-03: RLS マトリクス root 軸 → root_users + is_root() + setup-dev 投入済みで即テスト可能
- 04-04: question_templates UI → テーブル + RLS ポリシー + RESEARCH Pattern 6 のアクション実装可能

---
*Phase: 04-notifications-integration*
*Completed: 2026-06-13*

## Self-Check: PASSED

All created files found, all commit hashes verified.
