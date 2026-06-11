---
phase: 02-line-bot
plan: 02
subsystem: confirm-pure-functions
tags: [tdd, state-machine, postback, quick-reply, zod, pure-functions]
dependency_graph:
  requires: []
  provides:
    - "_shared/confirm/postback.ts: encodePostbackData / decodePostbackData"
    - "_shared/confirm/state.ts: transition() + ConfirmStatus / Question / TransitionResult types"
    - "_shared/confirm/messages.ts: buildQuestionMessage / buildInitialMessages / buildRepromptMessages / buildCompletionMessages"
    - "_shared/line/events.ts: parseWebhookEvent + ParsedEvent type"
  affects:
    - "02-03 (message-sender): uses buildInitialMessages, encodePostbackData"
    - "02-04 (webhook): uses transition(), parseWebhookEvent, buildQuestionMessage, buildRepromptMessages, buildCompletionMessages"
tech_stack:
  added: []
  patterns:
    - "Pure function state machine with no I/O (D-05)"
    - "URLSearchParams postback codec with zod validation"
    - "Quick Reply message builder with runtime LINE-constraint assertions"
    - "zod discriminated union for webhook event normalisation"
key_files:
  created:
    - supabase/functions/_shared/confirm/postback.ts
    - supabase/functions/_shared/confirm/state.ts
    - supabase/functions/_shared/confirm/messages.ts
    - supabase/functions/_shared/line/events.ts
    - supabase/functions/tests/postback_data_test.ts
    - supabase/functions/tests/confirm_state_test.ts
    - supabase/functions/tests/confirm_messages_test.ts
    - supabase/functions/tests/line_events_test.ts
  modified: []
decisions:
  - "postback.ts: zod used for decode validation with .safeParse → null (never throw). uuid() pipe on p field, min(1) on q, string regex+transform+min(0) on a."
  - "state.ts: transition() priority: pending/completed → none; empty questions → none; current-question match → advance; past-question match → reprompt with answer; unknown id → reprompt."
  - "messages.ts: buildInitialMessages always returns exactly 3 bubbles (event info + guidance + Q1). null EventInfo fields omitted row-by-row. Wording at Claude discretion per CONTEXT.md."
  - "events.ts: type-field dispatch before zod parse avoids union overhead; isRedelivery defaults false when deliveryContext absent."
metrics:
  duration: "~25 minutes (continuation agent; Task 1 RED was pre-committed)"
  completed: "2026-06-12"
  tasks_completed: 3
  files_created: 8
  tests_added: 52
  tests_total_after: 64
---

# Phase 02 Plan 02: 1問1答純関数モジュール Summary

**One-liner:** postbackコーデック・zodイベントパーサー・transition()純関数・Quick Replyメッセージビルダーの4モジュールをTDD（RED→GREEN）で実装し、全52テストがネット不要でグリーン

## Tasks Completed

| Task | RED Commit | GREEN Commit | Tests |
|------|-----------|-------------|-------|
| Task 1: postbackコーデック + webhookイベントzodスキーマ | 3ca62b5 (prior) | d2c976f | 24 |
| Task 2: ステートマシン transition() 純関数 | de93ff1 | d6cae91 | 12 |
| Task 3: Quick Replyメッセージビルダー | 8b64215 | be17a56 | 16 |

## Module Contracts (for Wave 2/3 implementors)

### `_shared/confirm/postback.ts`
- `encodePostbackData(p)` — URLSearchParams `p=&q=&a=` format, throws if >300 chars
- `decodePostbackData(s)` — returns `PostbackPayload | null`, never throws

### `_shared/confirm/state.ts`
- `transition(current, questions, input)` — pure function, no I/O
- Transitions: sent→in_progress→completed; past-Q re-tap → reprompt+answer; unknown id → reprompt; pending/completed → none

### `_shared/confirm/messages.ts`
- `buildQuestionMessage(q, participantId)` — text + quickReply, runtime asserts label≤20/items≤13
- `buildInitialMessages(event, q1, participantId)` — 3 bubbles (event info, guidance, Q1)
- `buildRepromptMessages(q, participantId)` — 2 bubbles (guide + question)
- `buildCompletionMessages()` — 1 bubble with "修正" + "主催者" (D-08)

### `_shared/line/events.ts`
- `parseWebhookEvent(raw)` — returns `ParsedEvent | null`
- Discriminates: `{kind:"postback", replyToken, userId, data, isRedelivery}` | `{kind:"follow", userId}` | `{kind:"message", replyToken, userId, text}`

## Deviations from Plan

None — plan executed exactly as written. All TDD gates (RED commit → GREEN commit) are present for each task.

## TDD Gate Compliance

| Task | RED Gate | GREEN Gate |
|------|----------|-----------|
| Task 1 | test(02-02) 3ca62b5 | feat(02-02) d2c976f |
| Task 2 | test(02-02) de93ff1 | feat(02-02) d6cae91 |
| Task 3 | test(02-02) 8b64215 | feat(02-02) be17a56 |

All RED→GREEN pairs confirmed in git log.

## Known Stubs

None. All functions return real computed values. No hardcoded empty values flow to the public API surface.

## Threat Flags

No new threat surface beyond what the plan's threat model anticipated. All T-02-04/T-02-05/T-02-06 mitigations are implemented:
- T-02-04: `decodePostbackData` validates uuid/non-empty/int≥0 via zod, returns null on failure
- T-02-05: `transition()` advances index only when questionId matches `questions[current.index].id`; pure function gives idempotency for free
- T-02-06: `buildQuestionMessage` throws if items>13 or any label>20 chars

## Self-Check: PASSED

Files verified present:
- supabase/functions/_shared/confirm/postback.ts — FOUND
- supabase/functions/_shared/confirm/state.ts — FOUND
- supabase/functions/_shared/confirm/messages.ts — FOUND
- supabase/functions/_shared/line/events.ts — FOUND
- supabase/functions/tests/postback_data_test.ts — FOUND
- supabase/functions/tests/confirm_state_test.ts — FOUND
- supabase/functions/tests/confirm_messages_test.ts — FOUND
- supabase/functions/tests/line_events_test.ts — FOUND

Commits verified:
- d2c976f feat(02-02): Task 1 GREEN — FOUND
- de93ff1 test(02-02): Task 2 RED — FOUND
- d6cae91 feat(02-02): Task 2 GREEN — FOUND
- 8b64215 test(02-02): Task 3 RED — FOUND
- be17a56 feat(02-02): Task 3 GREEN — FOUND

Full test suite: 64 passed / 0 failed / 1 ignored (live network test)
