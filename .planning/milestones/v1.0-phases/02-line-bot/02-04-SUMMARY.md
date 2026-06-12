---
phase: 02-line-bot
plan: 04
subsystem: webhook-orchestrator
tags: [webhook, state-machine, postback, e2e, in-08, spoofing-protection, deploy]
dependency_graph:
  requires:
    - phase: 02-line-bot
      plan: 01
      provides: "schema (participants state columns, answers UPSERT constraint, line_users IN-06), seed participant …0005"
    - phase: 02-line-bot
      plan: 02
      provides: "transition(), parseWebhookEvent(), decodePostbackData(), buildQuestionMessage(), buildRepromptMessages(), buildCompletionMessages()"
    - phase: 02-line-bot
      plan: 03
      provides: "replyMessage(), LINE_DRY_RUN=1 secret, e2e fixture …0005 in pending state"
  provides:
    - "supabase/functions/webhook/index.ts: postback/follow/message event orchestrator with state machine + spoofing guard"
    - "supabase/functions/tests/e2e_confirm_flow_test.ts: full E2E (sender→postback×3→answers 3行+completed, spoofing rejection, invalid signature)"
    - "IN-08 fix: twiplaProvider.canHandle() rejects query/hash URLs"
  affects:
    - "LINE-02: 1問1答フロー完成 — E2Eで機械検証済み"
    - "LINE-03: answers UPSERT with question_text snapshot — E2Eで機械検証済み"
tech_stack:
  added: []
  patterns:
    - "Webhook orchestrator: OA config resolution → event routing → per-event try/catch → always 200"
    - "T-02-11 spoofing guard: source.userId ↔ line_users.line_user_id + oa_config_id boundary check before any write"
    - "DB-first ordering: answers UPSERT → participants UPDATE → replyMessage (reply failure is recoverable)"
    - "Lazy token issuance: issueStatelessToken only called when reply needed (no waste on no-reply events)"
    - "UUID_PATTERN regex instead of z.string().uuid() for zod 4 compatibility with seed UUIDs"
key_files:
  created:
    - supabase/functions/tests/e2e_confirm_flow_test.ts
  modified:
    - supabase/functions/webhook/index.ts
    - supabase/functions/_shared/providers/twipla.ts
    - supabase/functions/tests/twipla_parser_test.ts
    - supabase/functions/_shared/confirm/postback.ts
decisions:
  - "Lazy token issuance: getToken() closure with cache, called only when result.reply !== 'none'"
  - "supabase type: declared as any in handleEvent to avoid TypeScript generic limitations on .single() return types"
  - "UUID validation: z.string().regex(UUID_PATTERN) instead of z.string().uuid() — zod 4 rejects non-RFC-4122 UUIDs (e.g. seed UUIDs)"
  - "Message event: .in('confirm_status', ['sent','in_progress']).order('updated_at', desc).limit(1).single() — per RESEARCH Open Question 1 recommendation"
metrics:
  duration: "~90 min"
  completed: "2026-06-12"
  tasks_completed: 3
  files_created: 1
  files_modified: 4
  tests_added: 5
  tests_total_after: 73
---

# Phase 02 Plan 04: webhookオーケストレータ + E2Eフルフロー検証 Summary

**One-liner:** webhookに1問1答ステートマシンを接続（postback/follow/message、T-02-11なりすまし防止、DB先行reply後）してdevにデプロイ、IN-08軽量修正を適用、署名付きcurl E2E（sender→postback×3→3問完了+なりすまし拒否+不正署名）を全シナリオ機械検証

## Tasks Completed

| Task | Type | Commit | Files |
|------|------|--------|-------|
| Task 1: webhook state-machine orchestrator | feat | f8f5353 | webhook/index.ts |
| Task 2: IN-08 canHandle query/hash rejection | fix | 5cfa652 | twipla.ts, twipla_parser_test.ts |
| Bug fix: postback.ts UUID regex for zod 4 | fix | a9cb938 | _shared/confirm/postback.ts |
| Task 3: E2E confirm flow test + deploy | feat | 0b149b9 | tests/e2e_confirm_flow_test.ts |

## E2E Scenario Coverage

| Scenario | Description | Result |
|----------|-------------|--------|
| (a) Setup | seed participant reset to pending/index0, answers cleared | PASS |
| (b) sender→sent | message-sender curl → confirm_status='sent' | PASS |
| (c) Q1 postback | q_age a=0 → 1 answer row + question_text snapshot + in_progress/index1 | PASS |
| (d) Re-answer UPSERT | Q1 re-sent a=1 → row count unchanged, answer updated, answered_at advances | PASS |
| (e) Spoofing rejection | attack userId for Q2 → 200, Q2 answer absent, state unchanged (T-02-11) | PASS |
| (f) Text message | unexpected text → 200, state/answers unchanged | PASS |
| (g) Q2+Q3 completion | Q2+Q3 answered → confirm_status='completed', 3 answer rows | PASS |
| (h) Post-completion | postback after completed → 200, unchanged (T-02-13) | PASS |
| (i) Invalid signature | wrong signature → 401 (T-02-12) | PASS |
| teardown | participant restored to pending, answers deleted | PASS |

## Test Results Summary

| Suite | Command | Result |
|-------|---------|--------|
| Unit (--allow-read) | `deno test --config supabase/functions/deno.json --allow-read supabase/functions/tests/` | 70 passed / 0 failed / 4 ignored |
| Full E2E (E2E_TEST=1) | `E2E_TEST=1 deno test ... supabase/functions/tests/` | 73 passed / 0 failed / 1 ignored |
| Cron smoke | `deno run ... scripts/verify-cron.ts` | OK (pg_cron/pg_net enabled, confirm-broadcast-daily active) |
| Secret grep | git ls-files + git grep | OK (no env files, no key patterns) |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] decodePostbackData returns null for seed UUIDs with zod 4 strict UUID validation**
- **Found during:** Task 3 (E2E test: (c) answers が 1行 であること → got 0)
- **Issue:** zod 4 `z.string().uuid()` enforces RFC 4122 version (1-8) and variant (8/9/a/b) bits. Seed UUIDs like `00000000-0000-0000-0000-000000000005` use version 0 and non-standard variant, which fail this strict check. `decodePostbackData` returned `null` for all postback events from seed participants, causing the webhook to silently ignore all postback processing.
- **Fix:** Changed `z.string().uuid()` to `z.string().regex(UUID_PATTERN)` where `UUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/`. Security is maintained: the FK constraint in DB enforces uuid type at persistence, and spoofing prevention is done via userId ↔ line_users check (not UUID format check).
- **Files modified:** supabase/functions/_shared/confirm/postback.ts
- **Commit:** a9cb938

**2. [Rule 3 - Blocking] Worktree lacks supabase/.temp/linked-project.json**
- **Found during:** Task 3 (deploy step)
- **Issue:** Same as Wave 2 agent — worktree does not inherit linked project config
- **Fix:** `supabase link --project-ref cmsxvxtcdniqgvhxjqri`
- **Files modified:** supabase/.temp/ (gitignored — not committed)
- **Committed in:** N/A

## Phase 2 Success Criteria Verification

| Success Condition | Status | Evidence |
|-------------------|--------|----------|
| (1) cronジョブ登録 + 抽出ロジック | VERIFIED | verify-cron.ts OK, e2e_targets_test.ts 2 pass (02-01/02-03) |
| (2) 全状態遷移の自動テスト | VERIFIED | confirm_state_test.ts 12 pass (02-02) + e2e_confirm_flow_test.ts 1 pass |
| (3) 完了メッセージ + completed遷移 | VERIFIED | E2E scenario (g): confirm_status='completed', buildCompletionMessages() called |
| (4) answers保存のwebhook→DB検証 | VERIFIED | E2E scenario (c)(d)(g): 3行、question_textスナップショット、UPSERT上書き |

## HUMAN-UAT 引き継ぎ手順（D-14）

Phase 2の機械検証はすべて `LINE_DRY_RUN=1` で実施（実LINE APIは呼ばれない）。実LINEアカウントでの受信確認には以下が必要:

### 手順
1. **DRY_RUN解除**: `supabase secrets unset --project-ref cmsxvxtcdniqgvhxjqri LINE_DRY_RUN`
2. **実LINEアカウントで友だち追加**: dev LINE公式アカウント（チャネルID: 2010372840）を友だち追加
3. **手動紐付け（ADMIN-02前）**: SQL実行で `line_users.line_user_id` を実LINEのuserIdで登録、`participants.line_user_id` をそのUUIDで更新
4. **配信受信**: `message-sender` を curl で呼び出し → 初回確認メッセージ（イベント情報＋Q1）を実機で受信確認
5. **3問回答**: Quick Replyボタンを3回タップして全問回答 → 完了メッセージ受信確認
6. **DB確認**: `answers` テーブルに3行、`confirm_status='completed'` を確認

### 注意事項
- seed participant (`…0005`) の `line_user_id` は `U00000000000000000000000000000dev`（実在しない）— 実配信には別の実 `line_user_id` に紐付けた participant が必要
- 実配信はLINE通数(200通/月)を消費する
- 完了後は再テスト用に `confirm_status='pending'` にリセット、answersを削除

## Known Stubs

None. All functions return real computed values and write to real DB (DRY_RUN only affects LINE API calls, not DB writes).

## Threat Flags

No new threat surface beyond the plan's threat model. All T-02-11 through T-02-15 mitigations applied and E2E-verified:
- T-02-11: E2E scenario (e) — spoofing detected, no write
- T-02-12: E2E scenario (i) — invalid signature returns 401
- T-02-13: E2E scenario (d)(h) — UPSERT idempotency + completed state no-op
- T-02-14: no userId/body/postback data in logs (log policy enforced in code)
- T-02-15: 1 reply call per event, DB-first ordering

## Self-Check: PASSED

Files verified present:
- supabase/functions/webhook/index.ts — FOUND
- supabase/functions/_shared/providers/twipla.ts — FOUND (IN-08 fix)
- supabase/functions/tests/twipla_parser_test.ts — FOUND (IN-08 test)
- supabase/functions/tests/e2e_confirm_flow_test.ts — FOUND
- supabase/functions/_shared/confirm/postback.ts — FOUND (UUID regex fix)

Commits verified:
- f8f5353 feat(02-04): Task 1 — webhook state-machine orchestrator — FOUND
- 5cfa652 fix(02-04): Task 2 — IN-08 canHandle rejects URLs with query/hash — FOUND
- a9cb938 fix(02-04): Rule 1 — postback.ts z.string().uuid() → UUID_PATTERN — FOUND
- 0b149b9 feat(02-04): Task 3 — full E2E confirm flow test — FOUND
