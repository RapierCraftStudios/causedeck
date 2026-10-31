# 0039. Court-day reminder scheduling

## Status

Proposed

## Date

2026-10-25

## Context

A lawyer wants an evening brief of tomorrow's court day, a morning note when today's list changed, and a nudge when a heard appearance has no outcome. Each is per member, at the member's local time (default 20:00 and 07:00 Asia/Kolkata), and must never reach a client or an outside address.

## Decision drivers

- A retried job must not send twice, and a failed channel must be retryable alone.
- Push payloads carry no party names; names appear only in-app.
- Deploy freezes must not collide with a send slot.
- The memory engine (#72) is not built, so preferences cannot live there.

## Considered options

| Option                                                     | Verdict  | Reason                                                                    |
| ---------------------------------------------------------- | -------- | ------------------------------------------------------------------------- |
| One half-hourly scheduler enqueues per-member jobs by slot | Chosen   | Same shape as the #49 digest; the member's own time is honoured to 30 min |
| One cron per member                                        | Rejected | Unbounded schedules                                                       |
| `once()` alone for idempotency                             | Rejected | It is per job effect, not per channel                                     |
| `reminder_dispatch` row per (member, kind, date, channel)  | Chosen   | The unique key makes a retry a no-op and resends only a released channel  |

## Decision

- `system.reminder.schedule` runs `0,30 7-23 * * *` in Asia/Kolkata. For each member whose local time matches a preference it enqueues `reminder.evening` (for tomorrow), `reminder.morning` (for today) or `reminder.outcome-missing`. The scheduler lists targets through an owner-defined SQL function, as the digest does, because tenant tables are FORCE RLS.
- The evening slot is limited to 18:00-23:00 and the morning job is 07:00, the window already kept clear of change freezes. Deploy tooling enforces the freeze: `.github/actions/freeze-guard/freeze.ts` blocks production deploys in 07:00-10:30 and 18:00-23:00 IST (`deploy-prod`, `deploy-staging` records it, `hotfix-prod` overrides it), so no deploy lands while a reminder is being sent.
- The evening job sends only when tomorrow has a listing; the morning job only when today's list diff is non-empty; nothing is sent on a holiday with no listings.
- Each channel claims its `reminder_dispatch` row before sending and releases it on failure, so a retry sends only what has not gone out.
- Push carries counts and a generic title, never party names. Email uses the console transport in dev and CI and SES when configured; push uses VAPID web push.
- Recipients are workspace members only; a static test asserts no code path addresses a client or an external email.
- The jobs live in `packages/core/src/jobs/definitions/reminders.ts` and are registered in the core registry, not in `apps/worker`.
- Preferences are the three categories `reminder.evening`, `reminder.morning` and `reminder.outcome_missing` with a per-kind time or delay, the same way the digest preference is stored.

## Consequences

- Failures retry with backoff and dead-letter through the registry, and show in the admin health feed.
- Local scheduled notifications (#721): the service worker schedules reminders with Notification Triggers (`showTrigger`) when the browser supports them (`apps/web/sw/local-reminders.ts`, fed by `lib/pwa/local-reminders.ts`). Support is narrow, so it is feature-detected and server push remains the backup path; the local notification shares the push `tag`, so a push replaces it. Wiring a reminder source to the page helper is still to do.

## Revisit when

- A reminder source is wired to local scheduling, or per-member quiet hours replace the fixed freeze-safe evening window.
