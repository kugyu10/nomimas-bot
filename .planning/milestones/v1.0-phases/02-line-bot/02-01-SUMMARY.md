---
phase: 02-line-bot
plan: 01
subsystem: database
tags: [postgres, pg_cron, pg_net, supabase-vault, deno, typescript, migrations, seed]

# Dependency graph
requires:
  - phase: 01-foundation-and-scraping
    provides: core tables (oa_configs, events, event_platform_urls, participants, line_users, answers), RLS, scraper patterns
provides:
  - pg_cron/pg_net enabled via migration (reset-resilient)
  - cron.schedule 'confirm-broadcast-daily' (01:00 UTC, Vault-ref-only, no secrets committed)
  - RPC public.get_confirm_targets() — service_role-only, returns attending+pending+linked+within-N-days participants
  - RPC public.count_unlinked_confirm_targets() — skipped participant count for logging
  - oa_configs.questions JSONB column with 3-question seed (q_age/q_drink/q_late)
  - participants.confirm_status check constraint + current_question_index column
  - line_users composite unique(oa_config_id, line_user_id) replacing global unique (IN-06 fix)
  - events.confirm_days_before default changed from 3 to 7 (D-09 Locked)
  - scripts/db/sql.ts: pooler-based SQL helper with prod safety guard
  - scripts/setup-dev.ts: idempotent Vault injection + line_channel_id update
  - scripts/verify-cron.ts: mechanical cron job registration verification (exit 0)
  - E2E seed fixture: line_user (…0004) + participant (…0005) for get_confirm_targets() testing
affects:
  - 02-02-message-sender (depends on get_confirm_targets RPC, confirm_status transitions)
  - 02-03-webhook (depends on participants state columns, line_users composite unique)
  - 02-04-e2e (depends on seed fixture rows and verify-cron script)

# Tech tracking
tech-stack:
  added:
    - "npm:postgres@3.4.9 (Deno npm: specifier, pooler-only, scripts/db only — not in Edge Fn runtime)"
    - "pg_cron 1.6.4 (enabled via migration, reset-resilient)"
    - "pg_net 0.20.3 (already installed; extension creation idempotent)"
    - "supabase_vault 0.3.1 (existing; Vault name-reference pattern established)"
  patterns:
    - "Reset-resilient cron: create extension + cron.schedule in migration (not manual SQL)"
    - "Vault-ref cron: cron.schedule body references vault.decrypted_secrets by name — no secrets in migrations"
    - "Pooler-only scripts: all Deno DB scripts use aws-1-ap-northeast-1.pooler.supabase.com (IPv4); direct db.* DNS is IPv6-only and fails"
    - "prod safety guard: connectDev() aborts on ref !== 'cmsxvxtcdniqgvhxjqri' (T-02-02)"
    - "Idempotent Vault injection: delete by name then create_secret (setup-dev.ts)"
    - "RPC access control: revoke from public/anon/authenticated + grant to service_role + set search_path=''"

key-files:
  created:
    - supabase/migrations/20260612120000_setup_cron_and_targets.sql
    - scripts/db/sql.ts
    - scripts/setup-dev.ts
    - scripts/verify-cron.ts
  modified:
    - supabase/migrations/20260611171037_create_core_tables.sql
    - supabase/seed.sql
    - supabase/functions/deno.json

key-decisions:
  - "D-01: questions JSONB column on oa_configs, element shape {id, text, options[]}"
  - "D-05: participants holds oa state (confirm_status + current_question_index); no separate table"
  - "D-09: confirm_days_before default 7 (RESEARCH found prior default was 3)"
  - "D-10: cron schedule '0 1 * * *' (01:00 UTC = 10:00 JST)"
  - "D-11: get_confirm_targets() filters attending+pending+linked+within-N-days; count_unlinked for skip logging"
  - "D-15: line_users composite unique(oa_config_id, line_user_id) replacing global unique (IN-06 fix)"
  - "Vault holds anonKey as cron_function_key (sufficient to pass gateway JWT, minimal privilege)"
  - "deno check requires --config supabase/functions/deno.json for scripts/ (outside functions/ dir)"

patterns-established:
  - "Migration-first cron: all pg_cron setup in migration file; cronJobs are wipe-safe after db reset"
  - "Vault name-only in SQL: never commit URL/key values to public repo"
  - "connectDev() pattern: centralised prod safety + pooler config for all dev scripts"
  - "setup-dev.ts pattern: idempotent Vault injection + seed column updates from env (not committed)"

requirements-completed: [LINE-01]

# Metrics
duration: ~40min
completed: 2026-06-12
---

# Phase 2 Plan 01: DB Foundation for Scheduled LINE Confirmation Summary

**pg_cron-driven daily confirmation trigger ('confirm-broadcast-daily') + get_confirm_targets() RPC + state machine columns + IN-06 composite unique — all reset-resilient via migration, zero secrets committed**

## Performance

- **Duration:** ~40 min (continuation from prior quota-killed executor)
- **Started:** 2026-06-12
- **Completed:** 2026-06-12
- **Tasks:** 3 (Task 1 committed by prior executor; Tasks 2-3 by this executor)
- **Files modified:** 7

## Accomplishments

- Schema extended in-place: questions JSONB, state machine columns (confirm_status check + current_question_index), IN-06 composite unique on line_users, confirm_days_before default 7
- New migration 20260612120000_setup_cron_and_targets.sql: pg_cron/pg_net extensions + get_confirm_targets() + count_unlinked_confirm_targets() + daily cron job with Vault name references only
- Dev operations fully scripted: setup-dev.ts (idempotent Vault + line_channel_id), verify-cron.ts (mechanical verification, exit 0 confirmed)
- db reset verified: all 3 migrations + seed applied cleanly; verify-cron.ts passes; all SQL acceptance criteria confirmed

## Task Commits

Each task was committed atomically:

1. **Task 1: 既存マイグレーション+seedのin-place拡張** - `10902ef` (feat)
2. **Task 2: cron基盤マイグレーション新規作成 + dev運用スクリプト3本** - `985d7c6` (feat)
3. **Task 3: [BLOCKING] devスキーマ再適用 + Vault/チャネルID投入 + cron登録検証** - `1afc0aa` (fix)

**Plan metadata:** (see below — committed after SUMMARY)

## Files Created/Modified

- `supabase/migrations/20260611171037_create_core_tables.sql` - In-place: questions JSONB, confirm_status check, current_question_index, IN-06 composite unique, default 7
- `supabase/migrations/20260612120000_setup_cron_and_targets.sql` - New: pg_cron/pg_net, get_confirm_targets() RPC, count_unlinked_confirm_targets() RPC, cron.schedule (Vault refs)
- `supabase/seed.sql` - 3 standard questions + E2E fixture rows (line_user …0004, participant …0005) + bug fix
- `supabase/functions/deno.json` - Added "postgres": "npm:postgres@3.4.9"
- `scripts/db/sql.ts` - Pooler-based SQL helper with prod safety guard (ref !== cmsxvxtcdniqgvhxjqri → exit 1)
- `scripts/setup-dev.ts` - Idempotent Vault injection (project_url + cron_function_key) + oa_configs.line_channel_id update
- `scripts/verify-cron.ts` - Mechanical verification: pg_cron/pg_net extensions + confirm-broadcast-daily job (exit 0)

## Decisions Made

- Used `delete from vault.secrets` + `vault.create_secret` (not update_secret) for idempotency — avoids Vault API inconsistencies between Supabase versions
- scripts/ files use `import postgres from "npm:postgres@3.4.9"` directly; deno check and deno run both require `--config supabase/functions/deno.json` since the import map is not auto-discovered outside the functions/ directory
- get_confirm_targets() returns `lu.line_user_id` (the "U..." string) directly from line_users join, avoiding the participant.line_user_id (uuid FK) vs LINE userId confusion (RESEARCH Pitfall 6)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed events INSERT column count mismatch in seed.sql**
- **Found during:** Task 3 (db reset execution — failed with "INSERT has more target columns than expressions")
- **Issue:** seed.sql events INSERT listed 9 columns (including confirm_days_before) but provided only 8 values — missing the `7` value for confirm_days_before
- **Fix:** Added `, 7` as the 9th value in the events INSERT values clause
- **Files modified:** supabase/seed.sql
- **Verification:** db reset --linked --yes succeeded without errors; seeded data confirmed via SQL check
- **Committed in:** 1afc0aa (Task 3 fix commit)

**2. [Rule 3 - Blocking] Re-linked Supabase CLI to dev in worktree**
- **Found during:** Task 3 (supabase db reset — worktree lacked supabase/.temp/linked-project.json)
- **Issue:** Worktree did not have .temp/ so Supabase CLI could not find the linked project. Running from main repo used old migrations.
- **Fix:** Ran `supabase link --project-ref cmsxvxtcdniqgvhxjqri` in the worktree to create .temp/ (gitignored)
- **Files modified:** supabase/.temp/ (gitignored — not committed)
- **Verification:** db reset completed successfully from worktree
- **Committed in:** N/A (runtime state, gitignored)

**3. [Rule 3 - Blocking] Added --config flag to deno run/check for scripts/**
- **Found during:** Task 2 verification (deno check failed — npm:postgres@3.4.9 not found)
- **Issue:** Scripts outside supabase/functions/ don't auto-inherit the functions' deno.json import map. deno check and deno run need --config explicitly.
- **Fix:** All deno run/check commands for scripts/ use `--config supabase/functions/deno.json`
- **Files modified:** None (operational pattern, documented here)
- **Verification:** deno check scripts/db/sql.ts scripts/setup-dev.ts scripts/verify-cron.ts PASS

---

**Total deviations:** 3 auto-fixed (1 bug fix, 2 blocking issues)
**Impact on plan:** All three fixes required for db reset to succeed and scripts to run. No scope creep.

## Issues Encountered

- Prior quota-killed executor left a partial seed.sql without the confirm_days_before value — Task 1's commit (10902ef) was completed by the previous agent but the column count bug was introduced there and caught during Task 3's db reset. Fixed in-place as Rule 1.

## Known Stubs

None — all columns are wired with real data. seed.sql provides E2E-capable fixture rows. line_channel_id is populated by setup-dev.ts at runtime (intentional: secret non-commit policy).

## Threat Flags

No new security-relevant surface beyond the plan's threat model. All T-02-01/T-02-02/T-02-03 mitigations applied:
- cron.schedule body uses Vault name references only (no secrets committed)
- connectDev() enforces ref === 'cmsxvxtcdniqgvhxjqri' (prod safety guard)
- get_confirm_targets()/count_unlinked_confirm_targets() have revoke + service_role-only grant + set search_path=''

## Next Phase Readiness

- get_confirm_targets() RPC ready for message-sender (02-03) to call via supabase.rpc()
- participants.confirm_status + current_question_index ready for webhook state machine (02-03)
- line_users composite unique ready for follow event UPSERT (02-03)
- E2E fixture participant (…0005) in confirm_status='pending' — will be picked up by get_confirm_targets() since event_date = current_date+3 is within confirm_days_before=7 window
- verify-cron.ts provides ongoing mechanical verification after future db resets

---
*Phase: 02-line-bot*
*Completed: 2026-06-12*
