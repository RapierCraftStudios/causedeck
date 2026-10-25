**Verdict**: CONFIRMED
**Confidence**: high
**Severity**: medium (greenfield feature, no live defect; no reminder jobs exist)
**Task Type**: feature

### What Was Claimed
Issue #64 (base `milestone/prepare-execute`): court-day reminder jobs. An 8 pm evening brief, a 7 am supplementary-list diff summary and an "outcome missing" nudge, honouring each member's time preference (defaults 20:00/07:00 IST). They are idempotent through `reminder_dispatch`, go out through in-app/push/email, per-kind and per-channel opt-outs, a settings card, cross-tenant coverage, zod validators and a new tenant table with RLS. The issue's file list is a guess: several paths do not match the repo layout (see Root Cause). The earlier "Investigation Report" comment on the issue is about a different issue (WhatsApp link UI) and must be ignored.

### What We Found
- No reminder feature: `grep -i reminder` finds only the `reminder.hearing` category (`packages/notifications/src/categories.ts:~37`) and UI strings; no `reminder_dispatch`, no `reminder.*` job.
- There is no `apps/worker/src/jobs/`. Jobs are defined in core: `packages/core/src/jobs/definitions/*.ts`, listed in `packages/core/src/jobs/registry.ts:~171-183`. The worker only runs the registry (`apps/worker/src/worker.ts`, `schedules.ts:10` registers `def.schedule` crons in `Asia/Kolkata`). Tests: `apps/worker/src/__tests__/registry.test.ts:~118-140` (ordered definition names), `schedules.test.ts`.
- Closest precedent is the #49 end-of-day digest, `packages/core/src/jobs/definitions/activity-digest.ts`: scheduler job (`:~118`, cron `0,30 18-23 * * *`, targets via owner-defined SQL function `app_notification_digest_targets()` because tenant tables are FORCE RLS), per-workspace fan-out (`:~162`), per-member job using `once()` (`packages/core/src/jobs/idempotency.ts`, `job_effect` table), `notify()` for in-app, `renderEmail`, `isSuppressed`, `isQuietTime`, retry `{limit:3, backoff}`. Pure slot/date maths: `packages/notifications/src/digest/schedule.ts` (`localDateOf`, `localDayBounds`, `endOfDaySlot`; slots limited to 18:00-23:00 to respect deploy-freeze windows, `:5-12`).
- Preferences: `getEndOfDayPreference`/`setEndOfDayPreference` (`packages/notifications/src/service.ts:620-632`) keep `time` on `notification_setting` and the per-channel `enabled` on `notification_pref` rows keyed by category. The categories registry (`categories.ts`) decides channels and defaults. The M2 `memory_item` source named in the issue does not exist (#72 is open), and the issue says to fall back to defaults when it is absent.
- Email templates live in `packages/notifications/src/email/templates/*.tsx` (e.g. `end-of-day-digest.tsx`), tests in `packages/notifications/src/email/__tests__/`; not `src/templates/`. Push: `packages/notifications/src/push/`, `channels/`.
- i18n messages live in `packages/i18n/src/messages/{en,kn,ta}/<ns>.json` (not `packages/i18n/messages`); namespaces registered in `packages/i18n/src/catalog.ts:7`, asserted in `packages/i18n/src/__tests__/catalog.test.ts`; generated files in `packages/i18n/src/generated/` regenerate with `pnpm --filter @causedeck/i18n i18n:types`.
- Court-day data (#58) exists: `packages/core/src/court-day/{query,clashes,diff,board}.ts`; `getCourtDay` (`query.ts:81`), `detectClashes` (`clashes.ts`), `diffLists`/`snapshotList` (`diff.ts:61,131`, `list_snapshot` table `packages/db/src/schema/court-day.ts:59`). Hearing outcome is `hearing.outcome` (null = unconfirmed) in `packages/db/src/schema/docket.ts:105-114`; `appearance` is at `docket.ts:141`, `obligation` in `docket.ts` (`status='open'`, used in `query.ts:~103`). Readiness: `computeReadiness` in `packages/core/src/briefs/index.ts:19`. Court holidays only exist as notices (`notices.ts`, kind `holiday`).
- Whole-reminder idempotency is also available through `once()`, but the issue explicitly requires the `reminder_dispatch` unique key, so that table is needed.
- Migrations are timestamped SQL in `packages/db/migrations/` (latest `20261025061924_brief_state.sql`) plus `meta/*_snapshot.json`.
- Another sibling already occupies `apps/web/app/(app)/w/[slug]/settings/notifications/` (`page.tsx`, `preferences-form.tsx`, `actions.ts`, `whatsapp-actions.ts`).

### Root Cause
Greenfield. #58 (court-day data) and #23 (notification channels) provide the inputs but no job turns them into reminders. The issue body's paths for jobs, templates and i18n are wrong for this repo, so implementation must follow the layout above.

### Affected Files
- `packages/validators/src/reminders.ts` (+ export in `index.ts`, test)
- `packages/db/src/schema/reminder.ts`, `schema/index.ts`, new migration + snapshot
- `packages/core/src/court-day/reminders.ts` (pure builders and DB readers) + test; export via `court-day/index.ts`
- `packages/core/src/jobs/definitions/reminders.ts` (3 jobs + scheduler), `jobs/registry.ts`
- `packages/notifications/src/categories.ts` (three categories), `src/email/templates/{evening-brief,morning-diff,outcome-missing}.tsx`, email renderer registry
- `apps/worker/src/__tests__/registry.test.ts`, `schedules.test.ts`
- `packages/i18n/src/messages/{en,kn,ta}/reminders.json`, `catalog.ts`, `__tests__/catalog.test.ts`, regenerated `generated/**`
- `apps/web/app/(app)/w/[slug]/settings/notifications/{_reminders-card.tsx,reminders-actions.ts,page.tsx}`, `apps/web/__tests__/cross-tenant-actions.test.ts`
- `packages/db/src/index.test.ts`, `packages/db/src/__tests__/rls/sql.test.ts`, `packages/db/src/testing/cross-tenant-registry.ts`, two-tenant seeders, `packages/core/src/__tests__/cross-tenant/services.test.ts`
- `packages/core/src/domains*` / `docs/engineering/core-domains.md` (if court-day imports notifications or briefs), `docs/adr/0039-reminder-scheduling.md`

### Sibling Sweep
Same pattern (scheduler, fan-out, member job) in `activity-digest.ts`, `news-digest.ts`, `notification-deliver.ts` (digest). Reuse their helpers (`workspaceTimezone`, `appLink`, `notificationJobDeps`) rather than copy. The registry/guard lists in CLAUDE.md all apply (core export, server actions, table, jobs, i18n, core domain deps, migration).

### History
Digest pattern from #49; court-day read model from #58 (`6a91720a`, ADR 0037); notifications from #23/#194. No earlier reminder attempt (`git log` on court-day shows none).

### Recommendation
Implement as in the contract. Key points:
- Follow the #49 job shape in core, with scheduler jobs for 07:00 and evening slots and a per-minute-or-half-hour outcome-missing scan.
- Write a `reminder_dispatch` row per (member, kind, date, channel) before sending, `ON CONFLICT DO NOTHING`, and skip the send if no row was inserted.
- Add three categories (`reminder.evening`, `reminder.morning`, `reminder.outcome_missing`) so per-kind and per-channel opt-out reuses `notification_pref`.
- Push payloads are generic ("Tomorrow's court day is ready"); only in-app and email carry counts.
- Skip when there are no listings, and send only to active members of the workspace.
- Defer the PWA local-notification path and deploy-tooling freeze enforcement.

### Related Issues
#1 (parent), #58 and #23 (inputs, merged), #15 (job conventions), #72 (memory prefs, open; fall back to defaults), #67/#70 (obligation reminders out of scope), #110 (SES credentials), #49 (digest precedent).
