---
phase: 04-notifications-integration
reviewed: 2026-06-12T21:32:36Z
depth: standard
files_reviewed: 27
files_reviewed_list:
  - supabase/migrations/20260611171037_create_core_tables.sql
  - supabase/migrations/20260611171038_enable_rls.sql
  - supabase/functions/_shared/notify/window.ts
  - supabase/functions/_shared/notify/diff.ts
  - supabase/functions/_shared/notify/messages.ts
  - supabase/functions/_shared/notify/notifier.ts
  - supabase/functions/webhook/index.ts
  - supabase/functions/scraper/index.ts
  - supabase/functions/tests/notify_window_test.ts
  - supabase/functions/tests/notify_diff_test.ts
  - supabase/functions/tests/notify_messages_test.ts
  - supabase/functions/tests/e2e_full_chain_test.ts
  - scripts/setup-dev.ts
  - admin/lib/schemas/template.ts
  - admin/lib/schemas/oa.ts
  - admin/lib/data/templates.ts
  - admin/lib/actions/templates.ts
  - admin/components/oa/template-save-dialog.tsx
  - admin/components/oa/template-apply-select.tsx
  - admin/components/oa/question-list-editor.tsx
  - admin/components/oa-selector.tsx
  - admin/app/(app)/events/loading.tsx
  - admin/app/(app)/events/[id]/loading.tsx
  - admin/app/(app)/oa/settings/loading.tsx
  - admin/app/login/page.tsx
  - admin/tests/integration/rls.test.ts
  - admin/tests/integration/data.test.ts
findings:
  critical: 0
  warning: 7
  info: 6
  total: 13
status: resolved
resolution:
  resolved_at: 2026-06-12T21:47:00Z
  fixed: [WR-02, WR-03, WR-04, WR-05, WR-06, IN-01, IN-03]
  acknowledged: [WR-01, WR-07, IN-06]
  deferred: [IN-02, IN-04, IN-05]
  fix_commits:
    WR-02: b76f08c
    WR-03: ae02900
    WR-04: 03547a5
    WR-05: 42af062
    WR-06: c37d54f
    IN-01: e2b2457
    IN-03: 6746fd2
  redeployed: [webhook, scraper]
---

# Phase 4: Code Review Report

**Reviewed:** 2026-06-12T21:32:36Z
**Depth:** standard
**Files Reviewed:** 27
**Status:** issues_found

## Summary

Reviewed the Phase 4 notification pipeline (window/diff/messages pure functions + notifier wired into webhook and scraper), the root_users / is_root() RLS extension, question_templates (schema, data, action, UI components), and the UI fixes (loading skeletons, login page).

The security-critical invariants from the phase context were verified and hold:

- **PII discipline (T-04-03/T-04-06):** `messages.ts` signatures take no userId; `notifier.ts` console output contains no LINE userIds or participant raw data (only UUIDs, kinds, counts); `notification_logs.detail` carries counts only. `pushMessage` DRY_RUN masks userIds to last-6.
- **Root privilege containment (T-04-05/T-04-12):** `is_root()` appears only in the 9 SELECT policies (`enable_rls.sql:57,67,81,96,110,126,143,381,404`) and in **zero** write policies. `root_users` has RLS enabled with no policies (deny-by-default), and the only insertion path is service-role `setup-dev.ts`. `is_root()` is SECURITY DEFINER with `search_path=''` and revoked from public/anon. RLS tests cover root SELECT-only, root_users invisibility, and privilege-escalation rejection.
- **200/save contract (T-04-07/T-04-09):** webhook wraps `notifyConfirmUpdate` in try/catch after reply and only after answer persist success (`answerPersistFailed` gate); scraper wraps `notifyScrapeChanges` in try/catch after upsert success. Failures cannot break the 200 contract or the save path.
- **Window correctness:** `isWithinNotifyWindow` parses both date-only strings as UTC midnight, yielding integer day diffs; boundary tests (diff=2 in / diff=3 out / null out) match the locked spec. Out-of-window writes no `notification_logs` row (Pattern 4), verified by E2E step (f).
- **Template path:** server action re-validates with the shared `questionsSchema` (no schema drift), `.select("id")` surfaces RLS 403 instead of silent 0-row, and cross-OA INSERT is blocked by `with check` (covered by rls.test.ts).

Remaining findings are below: one deployment-process hazard, a notification-spam residual, a dev-script prod-guard gap, a log-integrity gap in the notifier, two test-reliability defects, and one repo-invariant violation in public docs.

## Warnings

### WR-01: Phase 4 schema added by editing already-applied migration files — silently skipped by `supabase db push`

**File:** `supabase/migrations/20260611171037_create_core_tables.sql:151-188`, `supabase/migrations/20260611171038_enable_rls.sql:17-37,356-405`
**Issue:** Phase 4 added `root_users`, `question_templates`, `notification_logs`, `is_root()`, and the 9-policy OR-extension by mutating two migration files created in Phase 1 (commit history confirms: `8bc906d feat(04-01): migration in-place edit`). Migration versions `20260611171037`/`20260611171038` are already recorded in the remote `schema_migrations` history of any environment they were previously pushed to. `supabase db push` / `migration up` skips applied versions, so the Phase 4 DDL will **silently not execute** in any environment that has the old history — the notifier would then fail every `notification_logs` INSERT (errors are swallowed by design, so the feature dies silently) and `is_root()` would not exist. The current dev flow works only because the team runs `db reset`. A later migration (`20260612120000_setup_cron_and_targets.sql`) already exists, so the convention of appending new versioned migrations is established.
**Fix:** Move the Phase 4 sections of both files into a new migration, e.g. `supabase/migrations/20260613000000_phase4_root_templates_notifications.sql`, containing: `create table root_users / question_templates / notification_logs`, `create or replace function is_root()`, `alter table ... enable row level security`, the two new table policies, and `drop policy ... / create policy ...` (or `alter policy`) statements for the 7 existing SELECT policies' `or (select public.is_root())` extension. Revert the in-place edits.
**Status:** acknowledged (2026-06-13) — in-place migration editing is this project's established locked pattern: dev is disposable and reproducible-from-zero is a phase 1 success criterion; prod has never had migrations applied, so future prod setup applies the full current set from zero. No environment exists with old history.

### WR-02: No dedup/rate-limit on answer-update notifications — linked participant can spam owners and burn LINE push quota

**File:** `supabase/functions/webhook/index.ts:430-445`, `supabase/functions/_shared/notify/notifier.ts:52-181`
**Issue:** The phase security focus lists "notification spam (dedup)". The implemented dedup covers only (a) redelivered postbacks (`isRedelivery` skip) and (b) the completion event not double-counting as answer. However, `transition()` rule 4 (state.ts:98-127) accepts re-taps of **past** question quick-reply buttons indefinitely: every tap produces `result.answer`, the upsert succeeds, and `notifyConfirmUpdate` pushes to every owner/co-owner with a `line_user_id`. Quick-reply buttons persist in the participant's chat history, so a linked participant (passes the spoofing check) can tap an old button N times inside the 2-day window and generate N×recipients push messages. Beyond annoyance, push messages consume the OA's metered LINE message quota — this has direct cost impact. There is no cooldown, no "answer unchanged → skip", and no per-participant rate limit.
**Fix:** Cheapest effective dedup: before upserting in webhook (or inside `notifyConfirmUpdate`), skip notification when the new answer equals the stored answer (`select answer from answers where participant_id=... and question_key=...` is already implicit in the upsert path — compare before upsert). Additionally or alternatively, add a cooldown check against `notification_logs`: skip if a row with same `participant_id` and `kind` exists within the last N minutes.
**Status:** fixed (commit b76f08c) — webhook now selects the stored answer before upsert and skips notification when the value is unchanged (upsert itself still runs). Select failure falls back to notifying (safe side). E2E adds a same-answer re-tap step asserting answers stay 1 row and `kind='answer'` logs do not grow. Webhook redeployed.

### WR-03: setup-dev.ts GoTrue admin calls are not guarded by the dev-ref safety valve

**File:** `scripts/setup-dev.ts:38-39,88-132`
**Issue:** The prod safety valve (`DEV_PROJECT_REF === 'cmsxvxtcdniqgvhxjqri'`, T-02-02) lives in `connectDev()` and protects only the SQL path. `ensureUser()` calls `${supabaseUrl}/auth/v1/admin/users` with `SUPABASE_SERVICE_ROLE_KEY` taken independently from env. If `env.dev` ever carries a prod `SUPABASE_URL`/service key (copy-paste mistake, sourcing the wrong env file) while `DEV_PROJECT_REF` stays correct, the script passes the SQL guard and **creates mock users with a shared password on the prod auth instance**. Given this phase added a third mock user (`dev-root@nomimas.test`) and the repo is public, this gap is worth closing.
**Fix:** Before any admin API call, assert the URL matches the dev ref:
```ts
const ref = Deno.env.get("DEV_PROJECT_REF") ?? "";
if (!supabaseUrl.includes(ref) || ref !== "cmsxvxtcdniqgvhxjqri") {
  console.error(`[setup-dev] ABORT: SUPABASE_URL (${supabaseUrl}) は dev ref と一致しません`);
  Deno.exit(1);
}
```
**Status:** fixed (commit ae02900) — guard added after env checks, before any admin API call: aborts unless `ref === 'cmsxvxtcdniqgvhxjqri'` and `supabaseUrl.includes(ref)`.

### WR-04: notifier swallows oa_members SELECT errors — DB failure recorded as "0 recipients" in notification_logs

**File:** `supabase/functions/_shared/notify/notifier.ts:117-120,234-237`
**Issue:** Both `notifyConfirmUpdate` and `notifyScrapeChanges` destructure only `{ data: members }` from the `oa_members` select and ignore `error`. On a query failure, `members` is null, `allMembers` becomes `[]`, and a `notification_logs` row is written with `recipients=0, sent=0, skipped_no_line_id=0` — indistinguishable from "this OA genuinely has no members". The table is explicitly the "machine verification basis" (NOTIF-01) for the success criterion, so masking an infrastructure failure as a legitimate zero-recipient send corrupts the verification signal, and the owners silently receive nothing.
**Fix:** Check the error and bail without writing a misleading log row:
```ts
const { data: members, error: membersError } = await supabase
  .from("oa_members").select("line_user_id").eq("oa_config_id", ev.oa_config_id);
if (membersError) {
  console.error(`notify: oa_members select failed (kind=${params.kind}): ${membersError.message}`);
  return { ...baseResult, inWindow: true };
}
```
**Status:** fixed (commit 03547a5) — both `notifyConfirmUpdate` and `notifyScrapeChanges` now check the select error. Instead of bailing silently, they write a `notification_logs` row with `detail: { recipients_error: true }` (counts only, no PII) so the machine-verification basis distinguishes infra failure from a genuine zero-recipient send, then return without throwing (200 contract preserved). Webhook and scraper redeployed.

### WR-05: E2E teardown assertions are swallowed by the teardown catch — they can never fail the test

**File:** `supabase/functions/tests/e2e_full_chain_test.ts:486-490`
**Issue:** The teardown verification (`assertEquals(restoredEventDate, expectedDate, ...)` and `assertEquals(restoredStatus, "pending", ...)`) runs inside the `try { ... } catch (teardownErr) { console.error(...) }` block. `assertEquals` throws `AssertionError`, which is caught and merely logged, so these two assertions are structurally incapable of failing the test run. If teardown restoration silently breaks (e.g., the UPDATE matches 0 rows), subsequent runs start from corrupted seed state with no signal.
**Fix:** Move the verification assertions outside the catch-wrapped cleanup, or rethrow assertion errors:
```ts
} catch (teardownErr) {
  if (teardownErr instanceof AssertionError) throw teardownErr;
  console.error(`teardown error: ${(teardownErr as Error).message}`);
}
```
**Status:** fixed (commit 42af062) — `AssertionError` imported and rethrown from the teardown catch; non-assertion cleanup exceptions remain log-only.

### WR-06: Vacuous assertion in root cross-OA participants test — `toBeGreaterThanOrEqual(0)` always passes

**File:** `admin/tests/integration/rls.test.ts:518-525`
**Issue:** The test titled "root は両OAの participants を SELECT できる（OA2 の参加者も可視）" asserts `expect(rootParticipants.length).toBeGreaterThanOrEqual(0)` for the OA2 query — a length is always >= 0, so the headline claim (root can see OA2 participants that user1 cannot) is never actually verified. If the participants SELECT policy's root branch regressed, this test would still pass. The comment even acknowledges the seed dependency ("dev-participant-2 がある前提") and then declines to assert it.
**Fix:** Either assert `>= 1` against the seeded `dev-participant-2` fixture (`00000000-0000-0000-0000-000000000015`), or insert a service-role fixture participant under OA2 in `beforeAll` and assert it is visible to root and invisible to user1 (mirroring the notification_logs fixture pattern in the same file).
**Status:** fixed (commit c37d54f) — asserts `length >= 1` and that the result contains seeded `dev-participant-2` (`...0015`, confirmed present in seed.sql under OA2 epu `...0013`). The user1-invisible contrast is covered by the existing visibility test on the same epu.

### WR-07: Prod project ref appears in public-repo docs, violating the stated repo invariant

**File:** `docs/SETUP.md:55`, `docs/NIGHT-RUN.md:68` (outside the phase file list — repo-invariant observation)
**Issue:** The phase context locks "prod ref hgojtooexbknqotzkkja must NOT appear" in this PUBLIC repository. All 27 reviewed phase files comply, but the ref is committed in `docs/SETUP.md` ("本番用に `https://hgojtooexbknqotzkkja.supabase.co/auth/v1/callback` ...") and `docs/NIGHT-RUN.md`, plus several `.planning/` artifacts, on the public GitHub remote. A project ref is not a credential by itself, but publishing it hands attackers the exact prod GoTrue/PostgREST endpoints and contradicts the project's own locked invariant.
**Fix:** Replace the literal ref in `docs/` with a placeholder (`<PROD_PROJECT_REF>`) and keep the real value only in untracked env files. Note the ref persists in git history; if the invariant is strict, history rewrite or ref rotation (new prod project) is the only complete remediation — at minimum stop adding new occurrences.
**Status:** acknowledged (2026-06-13) — Supabase project refs are public identifiers (they appear in public URLs), not secrets; the no-prod-ref invariant exists to prevent misoperation in code/scripts, which remains enforced (all code-path guards intact). Additionally, `docs/NIGHT-RUN.md` has uncommitted user edits and must not be touched.

## Info

### IN-01: `ExistingRow.display_name` is dead — declared, selected from DB, never read

**File:** `supabase/functions/_shared/notify/diff.ts:11-15`, `supabase/functions/scraper/index.ts:114-117`
**Issue:** `diffParticipants` never reads `existing[].display_name` (new-participant and status-change entries take `displayName` from `incoming`). The scraper nonetheless selects `display_name` in the pre-upsert query solely to satisfy the interface.
**Fix:** Drop `display_name` from `ExistingRow` and from the scraper's select column list, or document why it is reserved.
**Status:** fixed (commit e2b2457) — `display_name` removed from `ExistingRow`, the scraper's select column list, and the diff test fixtures. Scraper redeployed.

### IN-02: Template questions applied to the editor via unvalidated cast of DB jsonb

**File:** `admin/components/oa/template-apply-select.tsx:57`, `admin/lib/data/templates.ts:32`
**Issue:** `listQuestionTemplates` casts raw jsonb to `QuestionTemplate[]` and `handleConfirm` casts `selectedTemplate.questions as QuestionItem[]` with no runtime check. Today the only authenticated write path is the zod-validated server action, but `questions` has no DB-level shape constraint; a malformed row (service-role tooling, future migration) would crash the settings page at render (`t.questions.length`) or inject non-conforming items into the form.
**Fix:** Run `questionsSchema.safeParse(t.questions)` in `listQuestionTemplates` and drop (or flag) rows that fail, removing both casts.
**Status:** deferred (2026-06-13) — not zero-risk in an unattended run (touches the data layer and apply flow); the only authenticated write path is already zod-validated. Candidate for a follow-up hardening pass.

### IN-03: Option rows keyed by array index; success-message timer not cleared on unmount

**File:** `admin/components/oa/question-list-editor.tsx:246,147`
**Issue:** (a) `key={oIndex}` on editable option inputs causes focus/IME state to jump to the wrong input when a middle option is deleted. (b) `setTimeout(() => setSaveSuccessMessage(null), 4000)` is never cleared; navigating away within 4s fires setState on an unmounted component (harmless no-op in React 18, but untracked timers accumulate on repeated saves).
**Fix:** (a) Key options by a stable id (extend the option model or generate per-option keys). (b) Store the timer id and clear it in a `useEffect` cleanup.
**Status:** partially fixed (commit 6746fd2) — (b) timer is now held in a ref, cleared on unmount and before re-arming on repeated saves. (a) deferred: keying options by stable id requires extending the option data model (not zero-risk).

### IN-04: `notifyScrapeChanges` receives full participant name arrays but uses only their lengths

**File:** `supabase/functions/_shared/notify/notifier.ts:197-198,259-262`
**Issue:** `params.newParticipants` / `params.statusChanges` carry `displayName` / `from` / `to` per entry, yet the notifier only ever reads `.length` (the message and `detail` are count-only by lock T-04-06). Passing names into the I/O layer needlessly widens the PII surface that a future log line or detail change could leak.
**Fix:** Change the signature to `{ newCount: number; statusChangedCount: number }`, matching the type-level guarantee the messages module already uses.
**Status:** deferred (2026-06-13) — signature change across notifier + scraper is a refactor, not zero-risk for an unattended run. Note WR-04's fix added `detail` counts derived from these arrays; counts-only discipline (T-04-06) remains enforced.

### IN-05: Scraper response `count` is pre-dedup while persisted rows are post-dedup

**File:** `supabase/functions/scraper/index.ts:96-110,198`
**Issue:** When the provider returns duplicate natural keys, last-wins dedup shrinks `rows`, but the response reports `count: result.participants.length` (raw). Callers comparing `count` against DB rows or `changes` totals will see a discrepancy.
**Fix:** Include both (`count` and `deduped`) or report `rows.length`; at minimum document the semantics in the response comment.
**Status:** deferred (2026-06-13) — response keys are a locked contract (A5: existing keys unchanged); changing `count` semantics or adding keys needs an explicit decision, not an unattended fix.

### IN-06: Participant removals are undetectable by design — stale rows and no "left the event" notification

**File:** `supabase/functions/_shared/notify/diff.ts:31-46`, `supabase/functions/scraper/index.ts:123-125`
**Issue:** The diff classifies only additions and status changes; participants who disappear from the platform list are never detected (upsert never deletes), so their rows keep the last status indefinitely and owners get no notification of withdrawals that Twipla expresses by removal rather than a 'declined' status. The E2E exploits exactly this (a deleted row reappears as "new").
**Fix:** Acceptable as a documented v1 limitation; if withdrawals matter, compute `existing keys − incoming keys` in `diffParticipants` and surface a `removed` count in `detail`.
**Status:** acknowledged (2026-06-13) — accepted as the documented v1 limitation per the reviewer's own assessment; `removed` detection is a v2 candidate.

---

_Reviewed: 2026-06-12T21:32:36Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
