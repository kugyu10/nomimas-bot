---
phase: 1
slug: foundation-and-scraping
status: approved
nyquist_compliant: true
wave_0_complete: false
created: 2026-06-12
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Deno組み込みテストランナー（Deno 2.8.2、追加インストール不要） |
| **Config file** | supabase/functions/deno.json（Wave 0で作成） |
| **Quick run command** | `deno test --allow-read supabase/functions/tests/twipla_parser_test.ts` |
| **Full suite command** | `deno test --allow-read --allow-net supabase/functions/tests/` |
| **Estimated runtime** | ~10 seconds（unit）/ ~30 seconds（--allow-net含むfull） |

---

## Sampling Rate

- **After every task commit:** Run `deno test --allow-read supabase/functions/tests/`（ネット不要のunitのみ）
- **After every plan wave:** Run `deno test --allow-read --allow-net supabase/functions/tests/` + デプロイ系smoke
- **Before `/gsd:verify-work`:** Full suite must be green（成功条件1〜5の検証コマンドすべて）
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD | 02 | 2 | EVENT-02 | — | 参加者のみ抽出（興味あり・不参加を除外） | unit | `deno test --allow-read supabase/functions/tests/twipla_parser_test.ts` | ❌ W0 | ⬜ pending |
| TBD | 02 | 2 | EVENT-02 | — | 実Twipla URLから件数>0・形状検証 | integration | `deno test --allow-net=twipla.jp supabase/functions/tests/twipla_live_test.ts` | ❌ W0 | ⬜ pending |
| TBD | 01 | 1 | 成功条件2 | — | スキーマ+RLSがゼロから再現 | smoke | `supabase db reset --db-url "$SUPABASE_DIRECT_CONNECTION_STRING" --yes` + pg_policies/information_schema検証SQL | ❌ W0 | ⬜ pending |
| TBD | 03 | 2 | 成功条件3 | T-LINE-SIG | 正署名200・不正署名401 | unit + e2e | `deno test supabase/functions/tests/line_signature_test.ts` + デプロイ後curl | ❌ W0 | ⬜ pending |
| TBD | 03 | 2 | 成功条件4 | — | 3関数デプロイ・呼び出しログ確認 | smoke | `supabase functions list --project-ref "$DEV_PROJECT_REF"` + 各関数curl | ❌ W0 | ⬜ pending |
| TBD | 01 | 1 | 成功条件5 | T-SECRET-LEAK | env.dev/env.prodが非コミット | unit | `git check-ignore env.dev env.prod` + `git ls-files \| grep -E '^env\.(dev\|prod)$'` が空 | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `supabase/functions/deno.json` — imports固定（cheerio@1.2.0, zod@4.4.3, @supabase/supabase-js@2）
- [ ] `supabase/functions/tests/fixtures/twipla_event.html` — 実URLから取得し**匿名化**したフィクスチャ（リポジトリはpublic）
- [ ] `supabase/functions/tests/twipla_parser_test.ts` — EVENT-02 unit スタブ
- [ ] `supabase/functions/tests/line_signature_test.ts` — LINE公式テストベクタ
- [ ] フレームワークインストール: 不要（Deno同梱）

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| LINEコンソールへのWebhook URL設定 | 成功条件3（運用面） | LINE Developersコンソールの手動操作が必要 | デプロイ後のwebhook URLをLINE Developersコンソールに登録し、Verifyボタンで200を確認（署名付きcurlでの機械検証は自動側でカバー済みのため夜間ブロッカーにしない） |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 30s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-06-12（plan-checker 8a-8d PASS）
