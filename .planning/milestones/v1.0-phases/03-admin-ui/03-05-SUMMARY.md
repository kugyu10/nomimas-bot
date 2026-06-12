---
phase: 03-admin-ui
plan: 05
subsystem: ui
tags: [vitest, supabase-rls, answer-status, linking-tab, combobox, alert-dialog, server-actions, phase-gate]

# Dependency graph
requires:
  - phase: 03-03
    provides: event detail tab shell, participants data layer, scrape-button
  - phase: 03-04
    provides: RLS matrix tests, auth smoke, pooler JWT harness, rls.helpers.ts

provides:
  - 回答状況タブ (AnswerStatusTab) + buildAnswerStatusRows 純関数
  - 紐付けタブ (LinkingTab) — Combobox + AlertDialog + 楽観的更新
  - linkParticipant / unlinkParticipant server actions (.select() 0行チェック)
  - getParticipantsWithAnswers (Pattern 7 ネスト埋め込み1クエリ)
  - getLinkingLists (未紐付け/紐付け済み/LINE候補 分類)
  - data.test.ts (RLS統合: user1 JWT / クロスOA 0行)
  - Phase 3 フェーズゲート全件 green（unit 49 + RLS統合 74 + build + Deno 82）

affects: [HUMAN-UAT, phase-04]

# Tech tracking
tech-stack:
  added:
    - dns.setDefaultResultOrder('ipv4first') in tests/setup.ts (IPv6 NAT64 timeout 回避)
  patterns:
    - Pattern 7: PostgREST ネスト埋め込み1クエリ (participants × answers × line_users)
    - 楽観的更新 + 失敗時巻き戻し (UI-SPEC Interaction Contract)
    - AlertDialog 確認フロー（紐付け解除の2ステップ操作）
    - fileParallelism: false in RLS mode (並列ネットワーク競合回避)

key-files:
  created:
    - admin/lib/answer-status.ts
    - admin/lib/actions/linking.ts
    - admin/components/events/answer-status-tab.tsx
    - admin/components/events/linking-tab.tsx
    - admin/tests/unit/answer-status.test.ts
    - admin/tests/integration/data.test.ts
  modified:
    - admin/lib/data/participants.ts (getParticipantsWithAnswers + getLinkingLists 追加)
    - admin/app/(app)/events/[id]/page.tsx (プレースホルダ → 実タブに置換)
    - admin/tests/setup.ts (IPv4 first DNS + hookTimeout)
    - admin/vitest.config.mts (hookTimeout/testTimeout 30s + fileParallelism)

key-decisions:
  - "buildAnswerStatusRows は純関数（ネット不要・vitest node env のみ）— 20字 truncate は描画側に委ねる"
  - "getLinkingLists: 紐付け済み line_user_id を Set で管理し候補コンボボックスから除外"
  - "dns.setDefaultResultOrder('ipv4first') を setup.ts に追加: IPv6 NAT64 NAT64経由の並列接続 10s timeout 問題を根本解消"
  - "fileParallelism: false (RLS_TEST=1 時): 統合テストの並列実行による Supabase Auth 競合を回避"

requirements-completed: [ADMIN-01, ADMIN-02]

# Metrics
duration: 25min
completed: 2026-06-12
---

# Phase 3 Plan 05: 回答状況タブ + 手動紐付けUI + フェーズゲート Summary

**回答状況タブ（buildAnswerStatusRows 純関数 + ネスト埋め込みクエリ）と手動紐付けタブ（Combobox + AlertDialog + 楽観的更新）の完成、Phase 3 機械検証全 green（unit 49 + RLS統合 74 + build + Deno 82）**

## Performance

- **Duration:** 25 min
- **Started:** 2026-06-12T22:00:00Z
- **Completed:** 2026-06-12T22:25:00Z
- **Tasks:** 3
- **Files modified:** 10 (created 6, modified 4)

## Accomplishments

- ADMIN-01 完成: buildAnswerStatusRows 純関数（TDD 5テスト green）+ getParticipantsWithAnswers（Pattern 7 ネスト埋め込み）+ AnswerStatusTab（Table + Tooltip + Badge）
- ADMIN-02 完成: getLinkingLists + LinkingTab（Combobox 紐付け済み除外 + AlertDialog 解除確認 + 楽観的更新 + 失敗時巻き戻し）
- server actions: linkParticipant / unlinkParticipant（.select() 0行チェック + RLS raise catch）
- Phase 3 フェーズゲート: unit 49/49 + RLS統合 74/74 + build green + Deno 82/82 + シークレット grep PASS

## Task Commits

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | 回答状況合成の純関数 + participants データ層 + 統合テスト | `7a76467` | lib/answer-status.ts, lib/data/participants.ts, tests/unit/answer-status.test.ts, tests/integration/data.test.ts |
| 2 | 回答状況タブ + 紐付けタブ + link/unlink server actions（UI-SPEC 準拠） | `910d3c1` | components/events/answer-status-tab.tsx, components/events/linking-tab.tsx, lib/actions/linking.ts, app/(app)/events/[id]/page.tsx |
| 3 | フェーズゲート — 全機械検証 green | `84a6137` | tests/setup.ts, vitest.config.mts |

## Files Created/Modified

- `admin/lib/answer-status.ts` — buildAnswerStatusRows 純関数、QuestionDef/ParticipantWithAnswers/AnswerStatusRow 型、confirm_status → 日本語ラベルマップ
- `admin/lib/data/participants.ts` — getParticipantsWithAnswers (Pattern 7) + getLinkingLists + 各インターフェース型（UnlinkedParticipant / LinkedParticipant / LineUserCandidate）
- `admin/lib/actions/linking.ts` — linkParticipant / unlinkParticipant server actions（.select() + 0行チェック + RLS raise 捕捉）
- `admin/components/events/answer-status-tab.tsx` — Table + Tooltip + Badge、空状態「まだ回答がありません」
- `admin/components/events/linking-tab.tsx` — Combobox + AlertDialog + 楽観的更新巻き戻し、全 UI-SPEC コピー準拠
- `admin/app/(app)/events/[id]/page.tsx` — 回答状況・紐付けプレースホルダを実コンポーネントに置換、getOaSettings で questions を取得
- `admin/tests/unit/answer-status.test.ts` — 5テスト（回答0件 / 一部回答 / 全問回答 / questions空 / 複数参加者）
- `admin/tests/integration/data.test.ts` — user1 JWT で OA-1 参加者+回答ネスト / OA-2 は 0 行の RLS 統合テスト
- `admin/tests/setup.ts` — dns.setDefaultResultOrder('ipv4first') 追加（IPv6 NAT64 timeout 回避）
- `admin/vitest.config.mts` — hookTimeout/testTimeout 30s + fileParallelism 逐次化（RLS統合時）

## Decisions Made

- `buildAnswerStatusRows` は純関数（UI 都合の truncate を含めない）。20字 truncate は AnswerStatusTab 内で担当しツールチップで全文表示
- `getLinkingLists` は `line_users.id` を候補から除外するため `Set<string>` で紐付け済み ID を管理。クライアント側フィルタ（リストが < 200 エントリ — UI-SPEC Pattern 8）
- `linkParticipant` / `unlinkParticipant` は `.select("id")` + `data.length === 0` で silent-0-row 罠（T-03-12）を防止
- `dns.setDefaultResultOrder('ipv4first')` を `tests/setup.ts` 先頭に追加: macOS + IPv6 NAT64 環境で parallel な `signInWithPassword` が undici の 10s connect timeout で失敗する根本原因を解消（Node.js `dns.setDefaultResultOrder` API — Node 17+ 対応）

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] TypeScript 型エラー — SupabaseJS ネスト埋め込み戻り値の型不一致**
- **Found during:** Task 2 (`npm run build` TypeScript チェック)
- **Issue:** `p.line_user as { display_name: string | null }` が `{ display_name: any }[]` 型との変換エラー（TS2352: overlapping 不足）
- **Fix:** `as unknown` を中継した二段キャスト（`as unknown as { ... }`）に変更
- **Files modified:** `admin/lib/data/participants.ts`
- **Commit:** `910d3c1`

**2. [Rule 3 - Blocking] IPv6 NAT64 並列接続 timeout — 統合テスト並列実行時の signInWithPassword 失敗**
- **Found during:** Task 3 (フェーズゲート実行時)
- **Issue:** macOS + IPv6 NAT64 環境で複数の統合テストファイルが並列に `signInWithPassword` を呼び出すと、undici の 10s connect timeout で 2-3 ファイルが失敗する。個別実行では全て成功
- **Fix 1:** `tests/setup.ts` に `dns.setDefaultResultOrder('ipv4first')` を追加（Node.js API — ランタイムで適用）
- **Fix 2:** `vitest.config.mts` に `fileParallelism: false` (RLS_TEST=1 時) + `hookTimeout/testTimeout: 30000` を追加
- **Files modified:** `admin/tests/setup.ts`, `admin/vitest.config.mts`
- **Verification:** `RLS_TEST=1 npx vitest run` → 7 files, 74 tests all passed
- **Commit:** `84a6137`

---

**Total deviations:** 2 auto-fixed (1 bug, 1 blocking)
**Impact on plan:** 両修正ともフェーズゲート通過に必須。スコープ拡大なし。

## Phase 3 Success Criteria Traceability

| 成功条件 | 検証方法 | テスト/コマンド | 結果 |
|---------|---------|-----------------|------|
| 1: X OAuth + モック認証 | auth.test.ts（signInWithPassword JWT → RLS スコープ）+ middleware リダイレクト | tests/integration/auth.test.ts (2 tests) | green |
| 2: イベント作成 + 参加者取得 | event-schema.test.ts + scraper-trigger.test.ts | tests/unit/event-schema.test.ts (27) + tests/integration/scraper-trigger.test.ts (2) | green |
| 3: 回答状況一覧 | answer-status.test.ts (純関数) + data.test.ts (ネスト埋め込みクエリ) | tests/unit/answer-status.test.ts (5) + tests/integration/data.test.ts (2) | green |
| 4: 手動紐付け DB 反映 | LinkingTab 実装 + rls.test.ts の紐付け with check + linking actions ソースアサーション | rls.test.ts（紐付け with check テスト）+ ソース grep | green |
| 5: OA設定 | oa-schema.test.ts + rls.test.ts（OA UPDATE ポリシー） | tests/unit/oa-schema.test.ts (17) + rls.test.ts | green |
| 6: RLS マトリクス（他OA不可視） | rls.test.ts 19テスト（SELECT 0行/INSERT 拒否/UPDATE 0行/with check/co-owner）| tests/integration/rls.test.ts (19) | green |

## Known Stubs

None - all tabs are fully wired. 回答状況・紐付けタブのプレースホルダは本プランで実コンポーネントに置換済み。

## Threat Flags

None - no new trust boundaries introduced beyond those already covered in the plan's threat model.

| Threat ID | Mitigation Status |
|-----------|-------------------|
| T-03-02 (cross-OA 紐付け Tampering) | MITIGATED: DB with check（03-01）+ linkParticipant で RLS raise 捕捉 |
| T-03-12 (0行更新の成功偽装) | MITIGATED: .select() + data.length === 0 チェック（linkParticipant / unlinkParticipant） |
| T-03-15 (env/service_role コミット) | MITIGATED: git ls-files admin grep = 0件、service_role = コメント行のみ |
| T-03-13 (紐付け連打 DoS) | ACCEPTED: isPending disabled + 1対1割当のみ（RLS で自OA内に限定） |

## User Setup Required

- HUMAN-UAT（実 X OAuth ログイン）: localhost:3000 で①Xログイン→callback→一覧②イベント作成→参加者取得→紐付け→回答状況→OA設定 の通し操作
- Phase 4 デプロイ準備（Vercel + 実 LINE チャンネル認証）

---
*Phase: 03-admin-ui*
*Completed: 2026-06-12*

## Self-Check: PASSED

**Created files verified:**
- [x] admin/lib/answer-status.ts
- [x] admin/lib/data/participants.ts
- [x] admin/lib/actions/linking.ts
- [x] admin/app/(app)/events/[id]/page.tsx
- [x] admin/components/events/answer-status-tab.tsx
- [x] admin/components/events/linking-tab.tsx
- [x] admin/tests/unit/answer-status.test.ts
- [x] admin/tests/integration/data.test.ts
- [x] admin/tests/setup.ts
- [x] admin/vitest.config.mts

**Commits verified:**
- [x] 7a76467 (Task 1: 純関数 + データ層 + 統合テスト)
- [x] 910d3c1 (Task 2: UIタブ + server actions)
- [x] 84a6137 (Task 3: フェーズゲート全 green)

**Phase gate all green:**
- [x] unit: 49/49
- [x] RLS統合: 74/74
- [x] build: green
- [x] Deno回帰: 82/82
- [x] シークレット: .env 0件, service_role コメントのみ
