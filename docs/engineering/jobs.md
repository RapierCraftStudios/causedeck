# Background jobs

`apps/worker` runs every background job on **pg-boss** in Postgres (spike §1, ADR 0005): OCR, STT,
extraction, briefs, notifications, digests, imports, exports and retention, with no Redis. The
framework lives in `@causedeck/core/jobs`. Web, api and worker all enqueue through it.

```sh
pnpm --filter @causedeck/worker dev        # tsx watch src/main.ts
pnpm --filter @causedeck/worker start      # run the worker once
pnpm --filter @causedeck/worker jobs:dlq list
```

## Adding a job

1. Create `packages/core/src/jobs/definitions/<domain>-<verb>.ts`:

   ```ts
   export const documentOcr = defineJob({
     name: 'document.ocr',
     schema: z.object({ workspaceId: workspaceIdSchema, documentId: z.uuid() }),
     concurrency: 2,
     timeoutSec: 600,
     idempotencyKey: (p) => p.documentId,
     handler: async (ctx, payload) => {
       await once(ctx, ctx.idempotencyKey, async () => {
         /* the side effect, through ctx.db */
       });
     },
   });
   ```

2. Add it to `createRegistry([...])` in `packages/core/src/jobs/registry.ts`.
3. Enqueue it: `await enqueue('document.ocr', { workspaceId, documentId })`. The name and payload
   are type-checked against the registry, so an unknown name or a wrong field is a compile error.
   A payload that fails the schema throws a `ZodError` at the producer and never reaches the
   queue.

The worker creates the queue `document.ocr` and its dead-letter queue `document.ocr__dlq` on boot.

## Naming

`<domain>.<verb>`, lower case, dot separated: `notification.send`, `document.ocr`, `export.build`,
`system.retention.sweep`. `defineJob` rejects anything else (`JOB_NAME_PATTERN`). `system.*` jobs
are platform jobs that may run without a workspace.

## Payload rules

- **Identifiers only, never content.** Payloads, logs, spans and DLQ displays must not carry matter
  content (PRD §9, BSA s.132). Pass `documentId`, never the document text. `createRegistry` and a
  test reject any schema that declares a field named `content`, `text`, `body`, `prompt` or
  `transcript` (`BANNED_PAYLOAD_FIELDS`), at any depth.
- **`workspaceId` is required** (a uuid) unless the job is `system.*`. `runJob` runs the handler
  inside `withWorkspace(db, { workspaceId }, ...)`, so `ctx.db` is a transaction with
  `app.workspace_id` set (`SET LOCAL` semantics). Row-level security (#19) uses that setting to
  stop a handler from reading another workspace's rows (`runjob.test.ts` proves it).
- **`fairnessKey`** is optional and defaults to `workspaceId`. It becomes the pg-boss `group`.

## Runtime contract

`runJob` gives every handler a `JobContext`:

| Field | What |
|---|---|
| `log` | pino child logger bound to `jobName`, `jobId`, `attempt`, `workspaceId` |
| `db` | the `withWorkspace` transaction (or the app-role client for system jobs) |
| `workspaceId`, `jobName`, `jobId`, `attempt` | `attempt` is 1 on the first run |
| `signal` | aborted on shutdown timeout or job expiry |
| `idempotencyKey` | `idempotencyKey(payload)` from the definition, else the job id |

Each run gets a span `job <name>` with the same four attributes and a `job.duration` metric. The
payload is never logged. A payload that fails validation is logged by issue path only.

## Retries and dead letters

| Error thrown by the handler | Result |
|---|---|
| `RetryableError` or any other error | retried with exponential backoff (`retryDelay` × 2^n with jitter, `retryBackoff: true`) |
| `PermanentError` (or an invalid payload) | moved to `<name>__dlq` immediately, with no further retries |

Defaults (`DEFAULT_RETRY`): `limit: 4` retries (5 attempts in total), `delaySec: 5`, backoff on,
capped at 1 hour. Override per job with `retry: { ... }`. After the last attempt pg-boss copies the
job into `<name>__dlq`, recording `sourceName`, `sourceId`, retry count and the failure output.
The output is `{ error: { name, code } }` and never a message. Dead-lettered jobs are kept for 60
days.

Error messages must not contain payload content: they reach logs and spans.

## Idempotency

Jobs can be delivered more than once (crash after the effect, expiry, a manual retry). Wrap every
side effect in `once(ctx, key, fn)`. It inserts `(workspace_id, job_name, idempotency_key)` into
`job_effect` in the job's own transaction. The unique index turns a duplicate into a no-op, and a
failed effect rolls the claim back so a retry can apply it. `once()` needs a workspace-scoped job.
`system.retention.sweep` deletes `job_effect` rows older than 30 days in every workspace. It has
no workspace and `job_effect` is under FORCE RLS, so it calls the owner-defined
`app_purge_job_effects(cutoff)` (SECURITY DEFINER, `0006_rls_baseline`) rather than
`withoutWorkspace`, which only reaches global tables. Other cross-tenant maintenance follows the
same pattern ([tenancy.md](tenancy.md)).
`system.billing.reconcile` lists its targets the same way, through
`app_billing_reconcile_targets()` (ids only, `0007_billing_reconcile`), then reads each
subscription inside `withWorkspace` ([billing.md](billing.md#daily-reconcile)).
`system.billing.dunning-tick` does the same through `app_billing_dunning_targets()` (ids of
`past_due` subscriptions, `0015_billing_dunning`), then retries, moves and notifies each one inside
`withWorkspace` ([billing.md](billing.md#dunning)).
`billing.process-event` (workspace job, payload `{ workspaceId, providerEventId }`, singleton per
event id) applies one stored Razorpay webhook event exactly once by locking its `billing_event` row
and setting `processed_at` in the same transaction ([billing.md](billing.md#webhooks)).

## Concurrency and fairness

- `concurrency` (default 2) is the number of jobs one worker process runs at once for a queue
  (pg-boss `localConcurrency`, one job per fetch).
- `singleton: { key, policy }` sets the pg-boss `singletonKey` and queue policy. The default
  `singleton` policy allows one active job per key.
- `fairnessConcurrency` (default 3) caps concurrent jobs per `fairnessKey` (the workspace) across
  all workers (pg-boss `group` + `groupConcurrency`), so one noisy workspace cannot starve the
  others (architecture §6.3).

## Schedules

A definition may declare `schedule: { cron, payload }`. `registerSchedules` registers it with
`boss.schedule(..., { tz: 'Asia/Kolkata' })`. pg-boss keeps schedules in its own table and sends
each occurrence once, so every replica registers on boot without double-sending. Current
schedules: `system.audit.verify` daily at 02:00 IST, `system.audit.retention` daily at 03:00 IST,
`system.retention.sweep` daily at 03:30 IST, `system.billing.reconcile` daily at 04:00 IST,
`system.billing.dunning-tick` daily at 04:30 IST, `system.notification.digest` every half hour and
`system.backup.health` every minute (#101: reads the backup status reports from the ops bucket,
exposes `walg_last_archive_age_seconds`, `walg_last_backup_age_seconds`,
`restore_drill_last_success_timestamp` and `restore_drill_rto_seconds`, and logs `backup_alert`
errors for stale WAL, failed backups, failed drills and RPO/RTO breaches; needs `BACKUP_OPS_*`).

## Notification jobs

`notification.deliver` (`definitions/notification-deliver.ts`, #196) sends one email or push for
one in-app notification. Its payload is `{ workspaceId, notificationId, channel }`. `notify()` in
`@causedeck/notifications` enqueues it after commit; pass `enqueueNotificationDelivery` as
`NotifyContext.enqueueDelivery`.

- The singleton key and the `once()` key are both `<notificationId>:<channel>`, so a duplicate or
  redelivered job never sends twice. Retries: 5 retries with exponential backoff from 30 s.
- The job re-checks membership and the channel preference. A suppression-listed address
  (`email_suppression`) is skipped and the transport is never called.
- A permanent send failure (`isPermanentEmailError`: SES `MessageRejected`, unverified sender,
  suspended account, other 4xx, SMTP 5xx) is recorded as `failed` and the job completes: it is
  never retried or re-sent. Any other failure throws `RetryableError`. That rolls back the
  `once()` claim, and pg-boss retries.
- The outcome is written to `notification.data.delivery.<channel>` as
  `{ status: 'sent'|'failed'|'skipped', reason?, code?, at }` on the existing row. The job never
  inserts notifications.
- Push is recorded as `skipped` (`push_disabled`) until #197 provides a `PushSender`.

The digest has two jobs (`definitions/notification-digest.ts`):

- `system.notification.digest` runs at `0,30 * * * *` in `Asia/Kolkata`. It lists live workspaces
  and their timezone through the owner-defined `app_notification_digest_targets()`
  (`0013_notification_digest`). It enqueues `notification.digest { workspaceId, digestDate }` for
  each workspace whose local time is in the 18:30 slot.
- `notification.digest` emails each active member the notifications from the previous 24 hours
  (18:30 to 18:30 local) in categories whose email channel is set to `daily`. It sends nothing in
  these cases: nothing to report, the `digest.daily` email turned off, a suppressed address, or the
  member's quiet hours. Quiet hours come from `notification_setting.court_hours_quiet`, which makes
  10:30-17:00 local quiet. Each member gets at most one send per day (`once()`), each in its own
  savepoint.
- The timezone is the workspace's (`workspace_settings.timezone`, default `Asia/Kolkata`); users
  have no timezone of their own.

Both jobs read `EMAIL_PROVIDER` (via `createEmailTransport`) and `APP_URL`. Tests replace the
transports with `setNotificationJobDeps`.

## Audit jobs

`definitions/audit-verify.ts` and `definitions/audit-retention.ts` (#230) keep the audit chains
checked and trimmed ([audit.md](audit.md#verification-and-retention)).

- `system.audit.verify` (daily 02:00 IST, stately singleton) verifies the account chain through
  `app_audit_verify_account_chain` and enqueues one `audit.verify` per workspace listed by
  `app_audit_chain_targets()` (ids only, `0019_audit_jobs`).
- `audit.verify` (payload `{ workspaceId }`, singleton per workspace) runs `verifyChain` from the
  epoch inside the workspace transaction, so a chain trimmed by retention starts at its oldest
  surviving row. A mismatch logs `fatal` `audit.chain_mismatch` with `severity: 'critical'`,
  `workspaceId` (null for the account chain), `eventId`, `reason` and `checked`, and the job
  completes: a retry would only repeat the alert.
- `system.audit.retention` (daily 03:00 IST, stately singleton, payload
  `{ retentionDays?: number }`, at least 180 and default 400) deletes audit events and `ai_call`
  rows older than the window only through `app_purge_audit` and `app_purge_ai_calls`, and records
  `audit.retention_purged` on the account chain in the same transaction. A window below 180 days
  fails the payload schema, and the handler's `assertRetentionDays` throws `PermanentError`
  (`AUDIT_RETENTION_TOO_SHORT`).

`system.orders.poll` (#494, hourly at :45 IST, stately singleton, no workspace) ingests the new
daily orders of watched matters. It uses the due-watch list, caps and kill switch of
`system.status.poll`: the latest snapshot's order links not yet captured are fetched as delegated
lookups (the watch's advocate and matter, through the governed fetcher wired with
`setStatusFetcherFactory`) and stored as `bulk_import` captures, so `extraction.extract-order`
stages their directions as L2 proposals. A sensitive matter is skipped. Only ids and counts are
logged.

## The `pgboss` schema and roles

- pg-boss lives in its own schema `pgboss`. Migration `0001_job_effect` creates the schema owned by
  `causedeck_owner`, grants `USAGE` to `causedeck_app`, and sets default privileges so tables
  pg-boss creates there are open to the app role for DML (`SELECT/INSERT/UPDATE/DELETE`, sequences,
  functions).
- The **worker** connects pg-boss as the owner (`DATABASE_URL_OWNER`). pg-boss creates and
  migrates its own tables, creates queues and partitions, supervises and schedules. Handlers use
  the app role (`DATABASE_URL`).
- **Producers** (`enqueue`, via `getProducer()`) connect as the app role with
  `migrate/createSchema/supervise/schedule: false`: send-only.

## Process, health and shutdown

- `src/main.ts`: env → telemetry → logger → health server on `WORKER_PORT` (default 3003) → pg-boss
  start, queues and handlers → schedules.
- `/healthz` always answers 200. `/readyz` checks the database through pg-boss's pool and that every
  handler is registered, and returns 503 otherwise.
- SIGTERM/SIGINT run `boss.stop({ graceful: true, timeout: 30000 })`. In-flight jobs get 30 s to
  finish. Anything still running is failed back to the queue and retried by another worker. The
  process then closes its pools and exits 0.
- Image: `infra/docker/worker.Dockerfile` (non-root `node` user, exec-form `CMD`, `STOPSIGNAL
  SIGTERM`).

## Dead-letter CLI

```sh
pnpm --filter @causedeck/worker jobs:dlq list                     # id, queue, when, attempts
pnpm --filter @causedeck/worker jobs:dlq show <id>                # details, payload redacted
pnpm --filter @causedeck/worker jobs:dlq retry <id>               # back onto its source queue
pnpm --filter @causedeck/worker jobs:dlq purge --older-than 30d   # d, h or m; required
```

The CLI connects as the owner. `show` replaces content-named fields with
`[CONTENT_REDACTED:<length>]` and secrets with `[REDACTED]`. `purge` refuses to run without
`--older-than`.
