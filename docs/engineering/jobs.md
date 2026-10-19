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
schedules: `system.retention.sweep` daily at 03:30 IST and `system.billing.reconcile` daily at
04:00 IST.

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
