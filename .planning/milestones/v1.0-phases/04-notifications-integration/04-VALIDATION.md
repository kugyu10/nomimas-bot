---
phase: 4
slug: notifications-integration
status: approved
nyquist_compliant: true
wave_0_complete: false
created: 2026-06-13
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Deno組込みランナー（supabase/ — 既存82+件）+ vitest 4.1.8（admin/ — 既存94件） |
| **Config file** | supabase/functions/deno.json / admin/vitest.config.mts（いずれも既存） |
| **Quick run command** | `deno test --config supabase/functions/deno.json --allow-read supabase/functions/tests/` + `cd admin && npx vitest run` |
| **Full suite command** | 上記 + `cd admin && RLS_TEST=1 npx vitest run && npm run build` + `E2E_TEST=1 LINE_DRY_RUN=1 deno test --allow-net --allow-read --allow-env supabase/functions/tests/e2e_full_chain_test.ts` |
| **Estimated runtime** | ~30s（quick）/ ~5分（full: E2E全鎖含む） |

---

## Sampling Rate

- **After every task commit:** Deno unit（該当 _shared/notify テスト）+ `cd admin && npx vitest run` + `npx tsc --noEmit`
- **After every plan wave:** Full suite（スキーマ変更waveは db reset --linked → setup-dev.ts → verify-cron.ts → Full の順。Edge Fn変更waveは deploy → E2E）
- **Before `/gsd:verify-work`:** 成功条件1-4の全コマンドgreen
- **Max feedback latency:** 300 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD | TBD | TBD | NOTIF-01 | — | 窓判定 diff 0..2→通知 / 3以上・負・null→非通知 | unit | `deno test ... tests/notify_window_test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | NOTIF-01 | — | 差分検出 新規/変化/不変/初回の分類 | unit | `deno test ... tests/notify_diff_test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | NOTIF-01 | T-PII | 通知文面3要素・LINE userId非含有 | unit | `deno test ... tests/notify_messages_test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | NOTIF-01 | — | 窓内→logs行あり / 窓外→logs 0行（成功条件1対比） | E2E | `E2E_TEST=1 ... e2e_full_chain_test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | NOTIF-01 | — | scraper差分通知 kind='scrape_changes' | E2E | 同上 | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | OA-03 | — | templateSchema検証（id一意・LINE上限） | unit | `npx vitest run tests/unit/template-schema.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | OA-03 | T-RLS | テンプレRLS（他OA 0行/INSERT拒否/root全件） | integration | `RLS_TEST=1 npx vitest run tests/integration/rls.test.ts`（追記） | ✅ 拡張 | ⬜ pending |
| TBD | TBD | TBD | OA-03 | — | クロスOA適用候補（user2に両OA分） | integration | `RLS_TEST=1 ... tests/integration/data.test.ts`（追記） | ✅ 拡張 | ⬜ pending |
| TBD | TBD | TBD | OA-02(root) | T-PRIV | root全SELECT可/owner他OA 0行/root UPDATE 0行/root INSERT拒否/root_users不可視 | integration | `RLS_TEST=1 ... rls.test.ts`（root軸追記） | ✅ 拡張 | ⬜ pending |
| TBD | TBD | TBD | 成功条件4 | — | 全鎖E2E（実スクレイプ→…→通知） | E2E | `E2E_TEST=1 ... e2e_full_chain_test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | UI修正 | — | build + loading.tsx×3存在 + 文言/zinc-900 grep 0件 | smoke | `npm run build` + grep + ls | ❌ W0（grep即時可） | ⬜ pending |
| TBD | ALL | ALL | 回帰 | — | Phase 1-3全テストgreen（RLS OR拡張で既存マトリクス不変） | regression | Quick/Full両コマンド | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `supabase/functions/_shared/notify/{window,diff,messages,notifier}.ts` + unit テスト3本
- [ ] マイグレーション in-place: core_tables（oa_members.line_user_id / root_users / question_templates / notification_logs）+ enable_rls（is_root() / SELECT 9本のOR拡張 / templates・logsポリシー）
- [ ] `scripts/setup-dev.ts` 拡張: dev-root@nomimas.test + root_users + user1のline_user_id投入
- [ ] `supabase/functions/tests/e2e_full_chain_test.ts`
- [ ] `admin/lib/schemas/template.ts`（questionsスキーマexport切り出し含む）
- [ ] `admin/{lib/data,lib/actions,components/oa}` テンプレート一式 + rls/dataテスト追記
- [ ] `admin/app/(app)/{events,events/[id],oa/settings}/loading.tsx`
- [ ] 実行時確認: `supabase secrets list` で LINE_DRY_RUN=1

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| 実LINEでの通知受信 | NOTIF-01 | 実機LINE | DRY_RUN解除後、owner自身のLINEで通知受信確認 |
| Vercelデプロイ | 統合仕上げ | Vercelアカウント認証要 | 朝のTODO: `cd admin && npx vercel`（環境変数設定込み） |
| 実ブラウザでのテンプレート操作 | OA-03 | GUI体験 | OA設定で保存→別OAに切替→適用 |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 300s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-06-13
