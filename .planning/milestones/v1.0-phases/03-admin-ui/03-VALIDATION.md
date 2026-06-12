---
phase: 3
slug: admin-ui
status: approved
nyquist_compliant: true
wave_0_complete: false
created: 2026-06-12
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.1.8（admin/ — node環境のみ）+ Deno組込みランナー（supabase/ — 既存82+件） |
| **Config file** | admin/vitest.config.mts（Wave 0で新規）/ supabase/functions/deno.json（既存） |
| **Quick run command** | `cd admin && npx vitest run`（unitのみ — ネット不要・決定的） |
| **Full suite command** | `cd admin && RLS_TEST=1 npx vitest run && npm run build` + `deno test --config supabase/functions/deno.json --allow-read supabase/functions/tests/` |
| **Estimated runtime** | ~20 seconds（unit）/ ~3分（full: RLS統合+build+Deno回帰） |

---

## Sampling Rate

- **After every task commit:** `cd admin && npx vitest run`（unit）+ `npx tsc --noEmit`
- **After every plan wave:** `RLS_TEST=1 npx vitest run` + `npm run build` + Deno既存スイート（スキーマ変更waveでは db reset → setup-dev.ts → 全テストの順）
- **Before `/gsd:verify-work`:** 成功条件1-6の全コマンドgreen
- **Max feedback latency:** 180 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD | TBD | TBD | AUTH-01 | T-MOCK | モックログイン→JWTでRLSスコープ取得 | integration | `RLS_TEST=1 npx vitest run tests/integration/auth.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | AUTH-01 | T-ROUTE | 未認証アクセスが/loginへリダイレクト | integration | `next start` + `curl -I /events` → 307 | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | AUTH-01 | T-IDENT | register_owner_by_identity 冪等・identityなしで0行 | integration | rls.test.ts内rpc直叩き | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | EVENT-01 | — | eventFormSchema 必須/URL regex/不正値拒否 | unit | `npx vitest run tests/unit/schemas.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | EVENT-01 | T-RLS | owner INSERT成功・他OA INSERT拒否 | integration | rls.test.ts（with check検証） | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | ADMIN-01 | — | 回答状況合成の純関数 | unit | `npx vitest run tests/unit/answer-status.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | ADMIN-02 | T-RLS | 紐付けUPDATE 自OA成功・他OA拒否 | integration | rls.test.ts | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | OA-01 | — | oa_configs UPDATE + questions JSONB検証 | unit+integration | schemas.test.ts + rls.test.ts | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | OA-02 | T-RLS | 成功条件6マトリクス（他OA SELECT 0行/INSERT拒否/UPDATE 0行） | integration | `RLS_TEST=1 npx vitest run tests/integration/rls.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | EVENT-01 | — | scraperトリガー（user tokenでゲートウェイ通過） | integration | tests/integration/scraper-trigger.test.ts | ❌ W0 | ⬜ pending |
| TBD | ALL | ALL | 横断 | — | `next build` 成功 | smoke | `cd admin && npm run build` | ✅ scaffold後 | ⬜ pending |
| TBD | ALL | ALL | 横断 | T-SECRET | admin/にenv・service_role非コミット | smoke | `git ls-files admin \| grep -E '\.env'` 空 + `git grep -l service_role -- admin/` 空 | ✅ | ⬜ pending |
| TBD | ALL | ALL | 回帰 | — | Phase 1-2 Denoテストgreen | regression | `deno test --config supabase/functions/deno.json --allow-read supabase/functions/tests/` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `admin/` スキャフォールド一式（create-next-app + shadcn `init -y -b radix -p nova` + add — リサーチ検証済みコマンド使用）
- [ ] `admin/vitest.config.mts` + `admin/tests/setup.ts`（RLS_TEST時のみenv.devロード + ref!==dev abort）
- [ ] `admin/tests/unit/schemas.test.ts` / `answer-status.test.ts`
- [ ] `admin/tests/integration/rls.test.ts` + `rls.helpers.ts`（poolerハーネス — 実証済みコード流用）
- [ ] `admin/tests/integration/auth.test.ts` / `data.test.ts` / `scraper-trigger.test.ts`
- [ ] `scripts/setup-dev.ts` 拡張: モックユーザー2名 + oa_members投入（冪等）
- [ ] `supabase/seed.sql` 拡張: dev-oa-2 + 配下フィクスチャ
- [ ] マイグレーションin-place: RLS INSERT/UPDATEポリシー + register_owner_by_identity + IN-05 FK
- [ ] `npm i -D vitest`（admin/内）

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| 実X OAuthログイン | AUTH-01 | 実ブラウザ往復＋X認可画面が必要 | dev URLで /login → 「Xでログイン」→ X認可 → コールバック → イベント一覧表示（プロバイダーはManagement APIで有効化済み） |
| 実ブラウザでの操作感 | 全要件 | 視覚・操作の体験確認 | localhost:3000 で一連の操作（イベント作成→取得→紐付け→回答状況→OA設定） |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 180s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-06-12
