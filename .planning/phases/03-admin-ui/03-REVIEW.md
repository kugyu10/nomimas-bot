---
phase: 03-admin-ui
reviewed: 2026-06-12T13:27:40Z
depth: standard
files_reviewed: 34
files_reviewed_list:
  - supabase/migrations/20260611171038_enable_rls.sql
  - supabase/seed.sql
  - scripts/setup-dev.ts
  - admin/proxy.ts
  - admin/lib/supabase/client.ts
  - admin/lib/supabase/server.ts
  - admin/lib/supabase/proxy.ts
  - admin/app/login/page.tsx
  - admin/app/auth/callback/route.ts
  - admin/app/(app)/layout.tsx
  - admin/app/(app)/events/page.tsx
  - admin/app/(app)/events/[id]/page.tsx
  - admin/app/(app)/oa/settings/page.tsx
  - admin/components/oa-selector.tsx
  - admin/components/events/events-table.tsx
  - admin/components/events/event-form-dialog.tsx
  - admin/components/events/events-page-client.tsx
  - admin/components/events/scrape-button.tsx
  - admin/components/events/participants-tab.tsx
  - admin/components/events/answer-status-tab.tsx
  - admin/components/events/linking-tab.tsx
  - admin/components/oa/oa-settings-form.tsx
  - admin/components/oa/question-list-editor.tsx
  - admin/lib/schemas/event.ts
  - admin/lib/schemas/oa.ts
  - admin/lib/data/events.ts
  - admin/lib/data/oa.ts
  - admin/lib/data/participants.ts
  - admin/lib/actions/events.ts
  - admin/lib/actions/linking.ts
  - admin/lib/actions/oa.ts
  - admin/lib/answer-status.ts
  - admin/tests/integration/rls.test.ts
  - admin/tests/integration/rls.helpers.ts
  - admin/tests/setup.ts
findings:
  critical: 0
  warning: 7
  info: 9
  total: 16
status: issues_found
fixes:
  fixed_at: 2026-06-12T13:55:00Z
  fixed: [WR-01, WR-02, WR-03, WR-04, WR-05, WR-06, WR-07, IN-02, IN-03, IN-04]
  deferred: [IN-01, IN-05, IN-06, IN-07, IN-08, IN-09]
  fix_status: warnings_all_fixed_infos_partial
---

# Phase 3: Code Review Report

**Reviewed:** 2026-06-12T13:27:40Z
**Depth:** standard
**Files Reviewed:** 34
**Status:** issues_found

## Summary

Reviewed the Phase 3 admin UI implementation (auth, RLS write policies, owner-registration RPC, events CRUD, OA settings, answer status, manual linking) plus the supporting migration, seed, and test harness. The security posture is solid: no secrets or prod project ref anywhere in source, no `service_role` usage inside `admin/`, the open-redirect vector in the auth callback is neutralized by origin-prefixing, all user content (including scraped participant names) renders through escaped JSX, server actions re-validate with zod, and every UPDATE path uses `.select()` + 0-row guards consistent with the RLS-only authorization design. The RLS matrix test covers visibility, insert/update denial, with-check linking integrity, and RPC idempotency.

No Critical findings. However, the events "CRUD" update path is effectively broken: the edit dialog is never rendered anywhere, and the time-extraction logic it depends on contains a latent UTC/JST corruption bug that will silently shift `meeting_at` by -9 hours per edit once the UI is wired. The event detail page also resolves OA scope from the selector cookie instead of the event's own `oa_config_id`, producing cross-OA data mixing for multi-OA users. These plus validation gaps are detailed below.

## Fix Summary (2026-06-12, gsd-code-fixer)

All 7 Warnings fixed; 3 trivial Infos fixed (IN-02/03/04); 6 Infos deferred with reasons noted per finding. Migration re-applied to dev (`supabase db reset --linked --yes` + setup-dev.ts + verify-cron.ts both OK). Verification: `RLS_TEST=1 npx vitest run` 94 tests green (7 files), `npm run build` green, Deno regression 82 passed / 0 failed / 6 ignored (live), secret-hygiene grep clean (no prod ref / no service_role in admin / no machine paths added).

| Finding | Status | Commit |
|---------|--------|--------|
| WR-01 | fixed | `d61823b` |
| WR-02 | fixed | `d426147` |
| WR-03 | fixed | `d68d1c3` |
| WR-04 | fixed | `405fa84` (+ test fix `a08da17`) |
| WR-05 | fixed | `b45e691` |
| WR-06 | fixed | `2f14fe4` (+ test fix `a08da17`) |
| WR-07 | fixed | `1f2c451` |
| IN-01 | deferred | — |
| IN-02 | fixed | `7b5483f` |
| IN-03 | fixed | `25032c4` |
| IN-04 | fixed | `057d31e` |
| IN-05 | deferred | — |
| IN-06 | deferred | — |
| IN-07 | deferred | — |
| IN-08 | deferred | — |
| IN-09 | deferred | — |

## Narrative Findings (AI reviewer)

## Warnings

### WR-01: `extractTime` reads UTC-serialized `meeting_at` as JST — round-trip corrupts time by -9h per edit

**File:** `admin/components/events/event-form-dialog.tsx:66-71` (with `admin/lib/schemas/event.ts:74-80`)
**Fix status:** fixed in `d61823b` — `extractTimeJst` (Intl, Asia/Tokyo) added to `lib/schemas/event.ts`, dialog uses it; roundtrip/idempotency unit tests added
**Issue:** `composeMeetingAt` writes `meeting_at` as `YYYY-MM-DDTHH:mm:00+09:00`. PostgREST serializes `timestamptz` back in the database timezone (UTC on Supabase), e.g. `2026-06-15T09:30:00+00:00` for 18:30 JST. `extractTime` blindly grabs `T(\d{2}:\d{2})` — `09:30` — ignoring the offset, so the edit form displays the UTC time, and saving re-composes it as `09:30+09:00`. Every edit-save cycle silently shifts the meeting time 9 hours earlier. This is currently unreachable (see WR-02), but the moment the edit UI is wired this becomes silent data corruption that feeds wrong meeting times into the LINE confirmation messages.
**Fix:**
```typescript
function extractTime(meetingAt: string | null | undefined): string {
  if (!meetingAt) return "";
  const d = new Date(meetingAt);
  if (isNaN(d.getTime())) return "";
  // JST 固定で HH:mm を取り出す（composeMeetingAt の +09:00 と対称）
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(d);
}
```

### WR-02: Event edit UI is never wired — `EventFormDialog` edit mode and `updateEvent` are dead code paths

**File:** `admin/components/events/event-form-dialog.tsx:59-60` / `admin/lib/actions/events.ts:67-87` / `admin/app/(app)/events/[id]/page.tsx`
**Fix status:** fixed in `d426147` — new `EventEditButton` client component renders the dialog in edit mode from the detail page action area; post-save reset keeps saved values in edit mode
**Issue:** `EventFormDialog` supports an `event` prop for edit mode, and `updateEvent` (action + data layer) exists with full 0-row RLS guards — but grep shows the only render site is `events-page-client.tsx:56` in create mode. The event detail page has no edit button. The phase's "events CRUD" update path is unreachable from the UI, leaving a substantial dead-code surface (`eventToFormValues`, `extractTime`, `updateEvent` action and data function) that hides the WR-01 bug from testing.
**Fix:** Render `<EventFormDialog event={...}>` from the event detail page (or events table row action), or explicitly descope editing and delete the dead path. If wired, fix WR-01 first.

### WR-03: Event detail page resolves OA scope from cookie instead of `event.oa_config_id` — cross-OA data mixing

**File:** `admin/app/(app)/events/[id]/page.tsx:37-52`
**Fix status:** fixed in `d68d1c3` — page now scopes questions/linking to `event.oa_config_id`; cookie/`resolveSelectedOaId` removed from the detail page
**Issue:** The page loads the event by id (RLS-scoped to any of the user's OAs), then resolves `selectedOaId` from the `nomimas_selected_oa_id` cookie. For a user who belongs to multiple OAs (e.g., dev user2: owner of dev-oa-2, co-owner of dev-oa), opening an event belonging to OA-A while the selector cookie points at OA-B yields: answer-status tab rendered against OA-B's `questions` (wrong columns, wrong "—" mapping), and linking-tab candidates drawn from OA-B's `line_users`. Every link attempt then fails at the RLS `with check` (cross-OA line_user) with the generic error — a guaranteed-broken flow that the UI can't explain. The correct scope is already on hand: `event.oa_config_id`.
**Fix:**
```typescript
const event = await getEvent(supabase, id);
if (!event) notFound();
const oaId = event.oa_config_id; // cookie ではなくイベント自身の OA を使う
const [participants, participantsWithAnswers, oaSettings, linkingLists] = await Promise.all([
  listParticipantsByEvent(supabase, id),
  getParticipantsWithAnswers(supabase, id),
  getOaSettings(supabase, oaId),
  getLinkingLists(supabase, id, oaId),
]);
```

### WR-04: `insertEvent` is non-atomic — failed URL insert leaves an orphan event row

**File:** `admin/lib/data/events.ts:142-186`
**Fix status:** fixed in `405fa84` (+ test fix `a08da17`) — `create_event_with_urls` SECURITY INVOKER RPC in the RLS migration (single transaction); `insertEvent` calls it and maps 23505 to 「このURLは既に他のイベントに登録されています」; integration tests cover orphan-free duplicate failure, success path, cross-OA denial
**Issue:** Event INSERT and `event_platform_urls` INSERT are two separate statements with no transaction. `event_platform_urls.url` has a UNIQUE constraint (per seed comment line 108), so creating an event with a URL already registered to another event fails the second insert — but the events row is already committed. The user sees "保存に失敗しました", retries with a corrected URL, and now has a duplicate/orphan event in the list. There is no DELETE policy (intentional), so the orphan cannot be cleaned up from the UI at all.
**Fix:** Move create into a single `SECURITY INVOKER` RPC (`insert into events ... ; insert into event_platform_urls ...` in one function = one transaction), or on URL-insert failure, surface a distinct error and/or best-effort delete is impossible — at minimum detect the unique-violation (`23505`) and return "このURLは既に他のイベントに登録されています" so users don't retry blindly.

### WR-05: `meeting_time` has no format validation — server composes unvalidated string into a timestamptz literal

**File:** `admin/lib/schemas/event.ts:51` (with `composeMeetingAt:74-80`)
**Fix status:** fixed in `b45e691` — `meeting_time` now `union([regex HH:mm, literal("")]).optional()` with boundary unit tests
**Issue:** `meeting_time: z.string().optional()` accepts any string. The server action (`createEvent`/`updateEvent`) re-validates with this same schema (the stated multi-layer defense, T-03-10), then `composeMeetingAt` blindly interpolates: a direct server-action call with `meeting_time: "garbage"` produces `"2026-06-15Tgarbage:00+09:00"`, which is rejected by Postgres as an opaque DB error mapped to the generic failure message. No injection risk (parameterized via supabase-js), but the validation layer the design relies on has a hole, and the UI `<input type="time">` is the only thing enforcing the format.
**Fix:**
```typescript
meeting_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional().or(z.literal("")),
```

### WR-06: `register_owner_by_identity` matches screen_name case-sensitively — silent onboarding failure

**File:** `supabase/migrations/20260611171038_enable_rls.sql:263`
**Fix status:** fixed in `2f14fe4` (+ test fix `a08da17`) — `lower()` on both sides of the comparison; integration test injects a mixed-case X identity and asserts owner registration against a lowercase `admin_twitter_id`
**Issue:** `where v_screen_name = any(string_to_array(coalesce(c.admin_twitter_id, ''), ','))` is a case-sensitive comparison. X screen names are case-insensitive and X preserves display casing in `identity_data` (e.g., identity returns `Alice_Bot` while the admin typed `alice_bot` in OA settings). The match fails, the RPC returns 0 rows, and the legitimate owner lands on `/no-access` with no diagnostic — the exact failure mode this RPC exists to prevent. The zod normalization (`schemas/oa.ts:33-39`) strips `@` and trims but does not lowercase, so the stored value's casing is whatever the admin typed.
**Fix:**
```sql
where lower(v_screen_name) = any(
  string_to_array(lower(coalesce(c.admin_twitter_id, '')), ',')
)
```
(and/or lowercase in `normalizeAdminTwitterId`).

### WR-07: `questions` schema lacks id-uniqueness and size caps — duplicate ids silently collapse answers

**File:** `admin/lib/schemas/oa.ts:15-21,56`
**Fix status:** fixed in `1f2c451` — superRefine id uniqueness, max 20 questions, text <= 200, options <= 13 items / <= 20 chars each (aligned with Phase 2 `messages.ts` LINE limits); unit tests added
**Issue:** `questionSchema` validates non-empty id/text/options but `z.array(questionSchema)` enforces no uniqueness of `id`, no max question count, and no max string lengths. The UI generates unique ids, but `saveOaSettings` is a public server action: a direct call can save `[{id:"q_age",...},{id:"q_age",...}]`. Downstream, `buildAnswerStatusRows` (`admin/lib/answer-status.ts:76-84`) keys answers by `question_key` in a `Map`, so duplicate ids render the same answer under multiple columns and the bot-side question flow keyed on id becomes ambiguous. Unbounded lengths also allow arbitrarily large JSONB writes.
**Fix:**
```typescript
questions: z.array(questionSchema).max(20)
  .refine((qs) => new Set(qs.map((q) => q.id)).size === qs.length,
    { message: "質問IDが重複しています" }),
// questionSchema 側: text: z.string().min(1).max(500), options: ... .max(10), 各 option .max(100)
```

## Info

### IN-01: `updateEvent` (data layer) ignores the error from the existing-URL fetch

**File:** `admin/lib/data/events.ts:228-234`
**Fix status:** deferred — error-handling polish outside the approved trivial-Info scope for this unattended run; failure mode is a duplicate-insert error already surfaced to the user (no data corruption). Candidate for Phase 4 cleanup.
**Issue:** `const { data: existingUrls } = await supabase.from("event_platform_urls").select(...)` discards `error`. If that query fails, `existingUrlSet` is empty, every submitted URL is treated as new, and the re-insert fails on duplicates — masking the real cause.
**Fix:** Check and return on the fetch error before computing `newUrls`.

### IN-02: `next` redirect machinery is dead — middleware never populates it

**File:** `admin/lib/supabase/proxy.ts:37-39` / `admin/app/login/page.tsx:22`
**Fix status:** fixed in `7b5483f` — middleware now sets `next=` for non-root paths; mock login path also honors validated `next`
**Issue:** `updateSession` redirects unauthenticated users to `/login` without appending the original path, but the login page reads `?next=` and the callback validates it. Deep links always land on `/events` after login; the validated `next` plumbing is never exercised.
**Fix:** `url.pathname = "/login"; url.searchParams.set("next", request.nextUrl.pathname);`

### IN-03: OA selector writes `localStorage` that nothing reads; cookie lacks `Secure`

**File:** `admin/components/oa-selector.tsx:29-31`
**Fix status:** fixed in `25032c4` — dead localStorage write removed; `Secure` appended when served over https
**Issue:** `localStorage.setItem(COOKIE_KEY, value)` has no reader anywhere in `admin/` (dead write). The cookie is set without the `Secure` attribute; it only carries an OA UUID that the server re-validates against membership (`resolveSelectedOaId`), so impact is nil, but `Secure` costs nothing.
**Fix:** Drop the localStorage write or add a reader; append `; Secure` in production.

### IN-04: Machine-specific absolute path committed in a public repo

**File:** `admin/tests/setup.ts:17`
**Fix status:** fixed in `057d31e` — absolute path replaced with optional `ENV_DEV_PATH` env-var fallback
**Issue:** `"/Users/kugyu10/work/nomimas-bot/env.dev"` hardcodes a local username/path in a PUBLIC repository. Not a secret, but it leaks environment detail and is non-portable.
**Fix:** Use an env var (e.g., `ENV_DEV_PATH`) as the final fallback instead of the absolute path.

### IN-05: `ensureUser` relies on an unsupported `?email=` filter on the GoTrue admin list endpoint

**File:** `scripts/setup-dev.ts:108-118`
**Fix status:** deferred — dev-only tooling with 2 users; pagination hardening has no production impact
**Issue:** GoTrue's `/admin/users` ignores an `email` query param and returns the paginated user list (default page size 50). The code compensates by scanning the returned list, which works only while the target user is on page 1. Dev-only with 2 users, so fine today; brittle as the dev project accumulates users.
**Fix:** Page through results, or use `/admin/users?page=N` iteration until the email is found.

### IN-06: Mock login leaves the form stuck in `loading` if the RPC call throws

**File:** `admin/app/login/page.tsx:48-49`
**Fix status:** deferred — dev-only mock path behind `NEXT_PUBLIC_AUTH_MOCK`; UX nit without security impact, outside approved trivial-Info scope
**Issue:** `await supabase.rpc("register_owner_by_identity")` is outside any try/catch. A network failure rejects, `window.location.href` is never set, `setLoading(false)` is never called — the button stays disabled with no error shown.
**Fix:** Wrap in try/catch (the RPC is idempotent and re-runs at callback anyway) and always navigate or reset loading.

### IN-07: `allLineUsers` can contain duplicate ids when one LINE user is linked to multiple participants

**File:** `admin/app/(app)/events/[id]/page.tsx:59-65`
**Fix status:** deferred — UI dedup nicety in the linking combobox; behavior change outside approved trivial-Info scope for the unattended run
**Issue:** `linkingLists.linked.map(...)` produces one entry per linked participant; the same `line_user_id` linked to two participants yields duplicate entries in `allLineUsers`, causing duplicate `CommandItem` keys/entries in the combobox after an unlink.
**Fix:** De-duplicate by id: `const allLineUsers = [...new Map([...candidates, ...fromLinked].map((u) => [u.id, u])).values()];`

### IN-08: `NEXT_PUBLIC_AUTH_MOCK` only hides the mock UI — the password grant stays enabled server-side

**File:** `admin/app/login/page.tsx:16,36-50`
**Fix status:** deferred — requires prod-side Supabase config action (disable email provider) which is prohibited in the unattended dev-only run; needs human follow-up + SETUP.md documentation
**Issue:** The flag gates rendering only; `signInWithPassword` against GoTrue works regardless of the flag for anyone who crafts the request. Protection rests entirely on mock users (`*@nomimas.test`) never existing in the prod project and email signups being disabled there. That invariant is currently implicit.
**Fix:** Document the invariant in SETUP.md, and disable the email provider on the prod Supabase project.

### IN-09: Any OA member can grant owner role via `admin_twitter_id`

**File:** `supabase/migrations/20260611171038_enable_rls.sql:126-143,259-265`
**Fix status:** deferred — by design; assumption recorded, action only needed if/when owner and co-owner privileges diverge
**Issue:** The `oa_configs` UPDATE policy allows any member (owner or co-owner) to edit `admin_twitter_id`, and the RPC registers any matching X login as `'owner'`. Since owner and co-owner currently have identical privileges this is not an escalation, but if role-differentiated policies are added later this becomes a privilege-escalation path. Flagging so the assumption is recorded.
**Fix:** When roles diverge, restrict `admin_twitter_id` updates to `role = 'owner'` (column-level via trigger or split the settings update into an RPC).

---

_Reviewed: 2026-06-12T13:27:40Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
