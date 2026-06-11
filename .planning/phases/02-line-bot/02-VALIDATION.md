---
phase: 2
slug: line-bot
status: approved
nyquist_compliant: true
wave_0_complete: false
created: 2026-06-12
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Deno組み込みテストランナー（2.8.2、追加インストール不要） |
| **Config file** | supabase/functions/deno.json（既存。postgres importを追加） |
| **Quick run command** | `deno test --config supabase/functions/deno.json --allow-read supabase/functions/tests/` |
| **Full suite command** | `E2E_TEST=1 deno test --config supabase/functions/deno.json --allow-read --allow-net --allow-env supabase/functions/tests/` |
| **Estimated runtime** | ~15 seconds（unit）/ ~60 seconds（E2E含むfull） |

---

## Sampling Rate

- **After every task commit:** Run `deno test --config supabase/functions/deno.json --allow-read supabase/functions/tests/`（ネット不要unit。既存12件含め決定的）
- **After every plan wave:** Full suite（E2E_TEST=1、dev DB+デプロイ済み関数+LINE_DRY_RUN=1）+ `scripts/verify-cron.ts`
- **Before `/gsd:verify-work`:** 成功条件1〜4の検証コマンドすべてgreen
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD | TBD | TBD | LINE-01 | — | cronジョブ `confirm-broadcast-daily` 登録済み | smoke | `deno run --allow-net --allow-read --allow-env scripts/verify-cron.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | LINE-01 | — | 抽出: attending∧pending∧紐付け済み∧N日以内のみ | integration | `E2E_TEST=1 deno test ... tests/e2e_targets_test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | LINE-01 | — | sender呼び出しで対象がsentに遷移（DRY_RUN） | e2e | curl message-sender → SQL検証 | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | LINE-02 | — | 全状態遷移（再タップ・想定外入力・完了後無視・冪等含む） | unit | `deno test --allow-read ... tests/confirm_state_test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | LINE-02 | — | Quick Reply形状（items≤13・label≤20・data≤300） | unit | `deno test ... tests/confirm_messages_test.ts` + `tests/postback_data_test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | LINE-02/03 | T-SPOOF | E2E: sender→postback×3→answers 3行+completed | e2e | `E2E_TEST=1 deno test ... tests/e2e_confirm_flow_test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | LINE-03 | — | 再回答UPSERT上書き（行数不変） | integration | e2e_confirm_flow_test.ts 内ケース | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | LINE-03 | T-SPOOF | なりすまし拒否（source.userId不一致は保存されない） | e2e | e2e_confirm_flow_test.ts 内ケース | ❌ W0 | ⬜ pending |
| TBD | ALL | ALL | 横断 | T-SECRET | シークレット非コミット（migration/seedにキー・prod refなし） | unit | `git ls-files \| grep -E '^env\.(dev\|prod)$'` 空 + grep | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `supabase/functions/tests/confirm_state_test.ts` — LINE-02 unit（遷移網羅）
- [ ] `supabase/functions/tests/postback_data_test.ts` — encode/decode・桁数制限
- [ ] `supabase/functions/tests/confirm_messages_test.ts` — Quick Reply形状
- [ ] `supabase/functions/tests/line_events_test.ts` — zodスキーマ（postback/follow/message）
- [ ] `supabase/functions/tests/e2e_confirm_flow_test.ts` — E2E_TEST=1ゲート
- [ ] `scripts/db/sql.ts` — pooler SQLヘルパー（npm:postgres@3.4.9、ref!==dev時abort）
- [ ] `scripts/setup-dev.ts` / `scripts/verify-cron.ts`
- [ ] deno.json に `"postgres": "npm:postgres@3.4.9"` 追加
- [ ] フレームワークインストール: 不要（Deno同梱）

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| 実LINEアカウントでの受信・Quick Reply操作 | LINE-01/02/03 | 実機LINEアプリでの体験確認はGUI操作 | LINE_DRY_RUN解除後、自分のLINEで友だち追加→紐付け→配信受信→3問回答→完了メッセージ確認（HUMAN-UATに記録） |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 60s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-06-12
