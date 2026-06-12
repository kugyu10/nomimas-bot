---
phase: 02-line-bot
verified: 2026-06-12T16:00:00Z
status: human_needed
score: 4/4
overrides_applied: 0
human_verification:
  - test: "DRY_RUN解除後に実LINEアカウントで受信・回答体験を確認"
    expected: "友だち追加後、配信受信 → Quick Reply 3問回答 → 完了メッセージ受信。DB の confirm_status='completed'・answers 3行を確認"
    why_human: "全機械検証が LINE_DRY_RUN=1 で実施されており実LINE APIは呼ばれていない。実機での送受信体験・メッセージ表示・Quick Replyのタップ動作はプログラム的に検証不可"
---

# Phase 02: LINE Bot Verification Report

**Phase Goal:** イベントN日前の自動配信から1問1答の回答収集・保存まで、参加者側のフローが手作業ゼロで完結する
**Verified:** 2026-06-12T16:00:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | pg_cronのスケジュールトリガーで、イベントN日前に未確認の参加者のみへ最終確認メッセージが自動配信される（cronジョブが登録済みで、配信対象抽出ロジックが「未確認のみ・N日前条件」をテストで満たす） | VERIFIED | `verify-cron.ts` exits 0: `confirm-broadcast-daily` `0 1 * * *` active=true. `get_confirm_targets()` filters `attending AND pending AND linked AND event_date within confirm_days_before`. E2E `e2e_targets_test.ts` 2/2 pass: boundary cases (attending+pending+linked+within-window = included; beyond-window / sent / interested / unlinked / null-date = excluded). |
| 2 | 定型質問が1問ずつ順番に送信され、参加者のQuick Reply回答ごとにステートマシンが次の質問へ遷移する（全状態遷移が自動テストで検証できる） | VERIFIED | `confirm_state_test.ts` 14/14 pass covering: sent→in_progress→completed (3 steps), 1-question boundary, past-Q re-tap reprompt, idempotent re-delivery, unknown id, out-of-range index, completed/pending noop, empty questions. E2E `e2e_confirm_flow_test.ts` scenario (c)(d)(g) verify state machine wired to DB via webhook. |
| 3 | 全問回答すると完了メッセージが送信され、参加者の確認ステータスが完了状態になる | VERIFIED | E2E scenario (g): Q2+Q3 postbacks → `confirm_status='completed'` in DB asserted via SQL. `buildCompletionMessages()` called in webhook when `result.reply === "completion"`. Unit test: `buildCompletionMessages` returns 1 bubble containing "修正" and "主催者". |
| 4 | 各回答がanswersテーブルにparticipant_idと紐付けて正しく保存される（webhook受信→保存をテストで検証できる） | VERIFIED | E2E scenario (c): Q1 answer row confirmed with `question_text` snapshot and `participant_id=…0005`. Scenario (d): re-answer UPSERT — row count stays 1, `answer` field updated, `answered_at` advances. Scenario (g): 3 answer rows after all questions completed. Webhook uses `onConflict: "participant_id,question_key"` for idempotent UPSERT. |

**Score:** 4/4 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `supabase/migrations/20260612120000_setup_cron_and_targets.sql` | pg_cron/pg_net + get_confirm_targets() + count_unlinked_confirm_targets() + cron.schedule (Vault ref) | VERIFIED | All 4 components present. No secret literals. Vault name references only. `revoke/grant service_role` on both RPCs. `set search_path = ''`. |
| `supabase/migrations/20260611171037_create_core_tables.sql` | questions JSONB / confirm_status check / current_question_index / IN-06 composite unique / confirm_days_before default 7 | VERIFIED | All schema extensions present. `unique(oa_config_id, line_user_id)` on line_users. `check (confirm_status in ('pending','sent','in_progress','completed'))`. `current_question_index integer not null default 0`. `confirm_days_before integer not null default 7`. WR-07 partial unique index added. |
| `supabase/seed.sql` | 3 questions (q_age/q_drink/q_late), event_date=current_date+3, fixture line_user+participant | VERIFIED | `q_age`, `q_drink`, `q_late` with correct options. `current_date + 3` for event_date. UUIDs …0004 (line_user) and …0005 (participant) seeded. |
| `supabase/functions/deno.json` | postgres npm import | VERIFIED | `"postgres": "npm:postgres@3.4.9"` present. |
| `scripts/db/sql.ts` | Pooler SQL helper with prod safety guard | VERIFIED | `connectDev()` with `ref !== 'cmsxvxtcdniqgvhxjqri' → Deno.exit(1)`. Pooler host used. |
| `scripts/setup-dev.ts` | Idempotent Vault injection + line_channel_id update | VERIFIED | delete-then-create_secret pattern. Updates `oa_configs.line_channel_id`. |
| `scripts/verify-cron.ts` | Mechanical cron job registration verification | VERIFIED | exit 0 confirmed in live run. Checks pg_cron, pg_net, confirm-broadcast-daily active=true. |
| `supabase/functions/_shared/confirm/state.ts` | transition() pure function + types | VERIFIED | 158 lines. Exports `transition`, `answerPersistFailureResult`, `ConfirmStatus`, `Question`, `TransitionResult`. No I/O. |
| `supabase/functions/_shared/confirm/postback.ts` | encodePostbackData / decodePostbackData | VERIFIED | URLSearchParams codec. zod validation with UUID_PATTERN regex (zod 4 fix). >300 char throw. null on failure. |
| `supabase/functions/_shared/confirm/messages.ts` | buildQuestionMessage / buildInitialMessages / buildRepromptMessages / buildCompletionMessages | VERIFIED | All 4 builders. LINE constraint assertions (items≤13, label≤20, bundle≤5). |
| `supabase/functions/_shared/line/events.ts` | parseWebhookEvent with zod discriminated union | VERIFIED | Handles postback/follow/message (including sticker/image after WR-04 fix). Returns null on unknown. `isRedelivery` defaults false. |
| `supabase/functions/_shared/line/client.ts` | pushMessage / replyMessage (DRY_RUN, X-Line-Retry-Key, 1..5 assert) | VERIFIED | 152 lines. `X-Line-Retry-Key: crypto.randomUUID()` on push. isDryRun() try/catch. messages 1..5 assert tested. No token/userId in logs. |
| `supabase/functions/_shared/confirm/format.ts` | CR-01 fix: JST timezone formatting for meeting_at and event_date | VERIFIED | 42 lines. `formatMeetingAt` converts UTC ISO to Asia/Tokyo. `formatEventDate` formats to YYYY年M月D日. 8 unit tests pass. |
| `supabase/functions/message-sender/index.ts` | cron broadcast handler (rpc→push→sent update) | VERIFIED | 274 lines. Calls `get_confirm_targets` and `count_unlinked_confirm_targets` RPCs. Token issued once outside loop. `confirm_status='sent'` update immediately after push success. WR-01 `x-cron-key` authorization added. CR-01 `formatMeetingAt/formatEventDate` applied. |
| `supabase/functions/webhook/index.ts` | Event routing + state machine + spoofing guard | VERIFIED | 487 lines (≥120). Imports and calls `transition()`. `onConflict: "participant_id,question_key"`. `replyMessage` called. T-02-11 spoofing guard (line_user_id + oa_config_id + event-side oa_config_id per WR-05). WR-03 isRedelivery skip. WR-02 answerPersistFailureResult fallback. WR-06 LINE_CHANNEL_ID guard. CR-02 display_name excluded from follow upsert. |
| `supabase/functions/tests/e2e_targets_test.ts` | Extraction boundary E2E + sent-transition E2E | VERIFIED | 2/2 E2E tests pass against dev. 6 boundary cases covered. Fixture cleanup in finally. |
| `supabase/functions/tests/e2e_confirm_flow_test.ts` | Full E2E sender→postback×3→DB verification | VERIFIED | 3/3 E2E tests pass. Scenarios (a)-(i) all PASS. Cross-OA rejection (WR-05) and CR-02 display_name retention verified. |
| `supabase/functions/tests/confirm_state_test.ts` | All state transition unit tests | VERIFIED | 14/14 pass. All transition paths covered per PLAN spec. |
| `supabase/functions/tests/postback_data_test.ts` | Postback codec unit tests | VERIFIED | 13/13 pass. Round-trip, all invalid input cases → null. |
| `supabase/functions/tests/confirm_messages_test.ts` | Message builder unit tests | VERIFIED | 16/16 pass. LINE constraint assertions tested. Codec round-trip through data field. |
| `supabase/functions/tests/line_events_test.ts` | Webhook event parsing unit tests | VERIFIED | 13/13 pass. WR-04 sticker/image cases included. |
| `supabase/functions/tests/line_client_test.ts` | LINE client unit tests | VERIFIED | 5/5 pass. Message count asserts. DRY_RUN safe fallback. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `20260612120000_setup_cron_and_targets.sql` | `vault.decrypted_secrets` | Vault name references in cron job body | VERIFIED | `select decrypted_secret from vault.decrypted_secrets where name = 'project_url'` and `'cron_function_key'` and `'cron_shared_secret'`. No literal URL or key values. |
| `scripts/setup-dev.ts` | `vault.create_secret` | Pooler SQL: delete then create_secret | VERIFIED | `vault.create_secret` pattern confirmed in SUMMARY. `connectDev()` enforces dev ref. |
| `supabase/seed.sql` | `oa_configs.questions` | JSONB insert with 3 questions | VERIFIED | q_age, q_drink, q_late in seed.sql line 16-18. |
| `message-sender/index.ts` | `public.get_confirm_targets` | `supabase.rpc("get_confirm_targets")` | VERIFIED | Line 103 confirmed. |
| `message-sender/index.ts` | `_shared/confirm/messages.ts` | `buildInitialMessages` import and call | VERIFIED | Line 32 import, line 225 call. |
| `message-sender/index.ts` | `participants.confirm_status` | `.update({ confirm_status: "sent" })` after push | VERIFIED | Line 249. |
| `webhook/index.ts` | `_shared/confirm/state.ts` | `transition()` call on postback | VERIFIED | Line 31 import, line 319 call. |
| `webhook/index.ts` | `answers` table | `upsert` with `onConflict: "participant_id,question_key"` | VERIFIED | Line 333-342. |
| `webhook/index.ts` | `_shared/line/client.ts` | `replyMessage()` call | VERIFIED | Line 28 import, line 414 call. |
| `webhook/index.ts` | `line_users` | userId matching and follow UPSERT | VERIFIED | Lines 213-221 (follow), lines 279-311 (spoofing check). |
| `_shared/confirm/messages.ts` | `_shared/confirm/postback.ts` | `encodePostbackData` in Quick Reply data field | VERIFIED | Tested by `confirm_messages_test.ts` round-trip test. |
| `tests/confirm_state_test.ts` | `_shared/confirm/state.ts` | `transition()` unit tests | VERIFIED | 14 cases covering all specified transitions. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|-------------------|--------|
| `message-sender/index.ts` | `confirmedTargets` | `supabase.rpc("get_confirm_targets")` | Yes — SQL join query against live DB | FLOWING |
| `webhook/index.ts` | `participantRow` | `.from("participants").select(...).eq("id", participantId)` | Yes — live DB read | FLOWING |
| `webhook/index.ts` | `result` (transition output) | `transition(current, oaConfig.questions, {...})` | Yes — pure function of real DB state | FLOWING |
| `answers` writes | `result.answer.questionId/Text/answer` | transition() from real postback payload | Yes — E2E confirmed 3 real answer rows | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Unit test suite (--allow-read) | `deno test --config supabase/functions/deno.json --allow-read supabase/functions/tests/` | 82 passed / 0 failed / 6 ignored | PASS |
| Cron job registered + extensions | `deno run --config ... scripts/verify-cron.ts` (exit code) | Exit 0: confirm-broadcast-daily active=true, pg_cron+pg_net present | PASS |
| E2E extraction boundary (6 cases) | `E2E_TEST=1 deno test ... e2e_targets_test.ts` | 2 passed / 0 failed | PASS |
| E2E full confirm flow (sender→3Q→completed) | `E2E_TEST=1 deno test ... e2e_confirm_flow_test.ts` | 3 passed / 0 failed | PASS |
| Secret hygiene: env.dev/env.prod not tracked | `git ls-files \| grep -E '^env\.(dev\|prod)$'` | 0 matches | PASS |
| Secret hygiene: no key strings in supabase/ scripts/ | `git grep -lE 'eyJ...\|hgojtooexbknqotzkkja' -- supabase/ scripts/` | CLEAN | PASS |

### Probe Execution

| Probe | Command | Result | Status |
|-------|---------|--------|--------|
| `scripts/verify-cron.ts` | `deno run --config supabase/functions/deno.json --allow-net --allow-read --allow-env scripts/verify-cron.ts` | Exit 0; confirm-broadcast-daily schedule=`0 1 * * *` active=true | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| LINE-01 | 02-01, 02-03 | システムはイベントN日前に未確認の参加者へLINEで最終確認メッセージを自動配信できる | SATISFIED | pg_cron daily job in migration + get_confirm_targets() RPC with N-days window filter + message-sender push logic + E2E sent-transition verified |
| LINE-02 | 02-02, 02-04 | 最終確認は1問1答形式で、ステートマシンで定型質問を順番に投げられる | SATISFIED | transition() pure function with 14 unit tests + webhook orchestrator wired to state machine + E2E full flow (3 questions) verified |
| LINE-03 | 02-04 | 参加者の回答がSupabaseに保存される | SATISFIED | answers UPSERT with participant_id + question_text snapshot + E2E 3-row verification + re-answer UPSERT idempotency verified |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| (none found) | — | No TBD/FIXME/XXX/placeholder in phase-modified files | — | — |

Notes on deferred code review items (IN-01, IN-05, IN-06, IN-07): All four were explicitly assessed as "v1 acceptable" or "follow-on design decision" by the code reviewer and are not blockers for phase goal achievement.

### Human Verification Required

#### 1. 実LINEアカウントでの受信・回答体験（HUMAN-UAT）

**Test:** DRY_RUN解除後、実LINEアカウントで友だち追加 → 手動紐付け（SQL）→ message-sender 呼び出し → 初回確認メッセージ（イベント情報 + 案内文 + Q1 Quick Reply）を実機で受信 → 3問をタップ回答 → 完了メッセージを受信確認 → DB で `confirm_status='completed'`・`answers` 3行を確認

**Expected:**
- 配信メッセージがLINE上で正しく表示される（イベント情報・JST時刻表記・日本語文面）
- Quick Replyボタンが表示されタップ可能
- 各回答後に次の質問が届く（in_progress遷移）
- 3問完了後に完了メッセージが届く
- DB: `confirm_status='completed'`、`answers` 3行・`question_text`スナップショット付き

**Why human:** 全機械検証は `LINE_DRY_RUN=1` で実施（実LINE API非呼び出し）。実機での送受信・メッセージUI・Quick Replyボタン表示・タップ後の応答動作はプログラム的に検証不可能。

**手順参照:** `02-04-SUMMARY.md` の「HUMAN-UAT 引き継ぎ手順」

---

### Gaps Summary

No gaps. All 4 phase success criteria are VERIFIED by automated tests and live E2E against the dev Supabase project. The `human_needed` status is solely due to the intentional `LINE_DRY_RUN=1` design decision (D-14) deferring real LINE delivery verification to HUMAN-UAT.

**Post-review fixes included:** 13 of 17 code review findings (CR-01, CR-02, WR-01 through WR-07, IN-02 through IN-04, IN-08) were fixed after initial execution. The fixes are incorporated in the codebase and verified by the expanded test suite (82 unit + 5 E2E tests green).

---

_Verified: 2026-06-12T16:00:00Z_
_Verifier: Claude (gsd-verifier)_
