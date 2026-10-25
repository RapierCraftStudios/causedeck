# Observability

`@causedeck/observability` gives every service (web, api, worker, admin) the same structured
logging, tracing, metrics, error reporting and health endpoints. Spec: technical spike (#1) §1,
§3.2, §6; issue #13.

## Logging

```ts
import { createLogger } from '@causedeck/observability';

const logger = createLogger({ service: 'api' }); // level defaults to LOG_LEVEL
logger.info({ matterId }, 'matter opened');
```

Each log line is one JSON object on stdout:

| Field | Source |
|---|---|
| `level` | Level label (`info`, `warn`, ...), not a number |
| `time` | UTC ISO-8601, e.g. `2026-10-18T09:30:00.000Z` (no IST field; convert at display time) |
| `service` | `createLogger({ service })` |
| `env` | `NODE_ENV` |
| `version` | `GIT_SHA` (falls back to `dev`) |
| `region` | `AWS_REGION` |
| `requestId` | Active request context (`x-request-id` header or a fresh UUID) |
| `workspaceId`, `userId`, `jobId` | Active request context, or `logger.child({...})` bindings |
| `msg` | Message, scrubbed of embedded credentials |
| `err` | Serialised error: `name`, `message` (scrubbed), `cause` chain, and `stack` only when `NODE_ENV !== 'production'` |

Request correlation uses `AsyncLocalStorage`. HTTP middleware opens the context. Jobs open it
themselves:

```ts
withRequestContext({ requestId: job.id, jobId: job.id, workspaceId }, () => run(job));
```

Logs also carry the snake_case correlation fields the pipeline indexes: `request_id`, `workspace_id` (id only)
and, inside an active span, `trace_id` and `span_id`. The camelCase `requestId` and `workspaceId` stay for existing
readers. Content keys (`title`, `filename`, `email`, `body`, `text`, ...) never reach the log; the OTel Collector
deletes the same keys again as defense in depth.

### Monitoring stack (#102)

Prometheus, Grafana, Loki, Alertmanager, the OTel Collector, cAdvisor, node_exporter and blackbox run in India from
[`infra/monitoring/compose.monitoring.yml`](../../infra/monitoring/compose.monitoring.yml). Logs are retained 200 days
by default and never fewer than 180 (Loki `retention_period` of at least 4320 h, bucket object lock of 180 days).
Adapter health is exported by `@causedeck/observability/adapter-metrics` (`adapter_parse_success_ratio`,
`adapter_last_success_timestamp`). Details, alerts and the 1,000-seat storage projection:
[infra/monitoring/README.md](../../infra/monitoring/README.md); rotation and severities:
[on-call runbook](../../infra/runbooks/on-call.md).

### Time and retention (infrastructure obligations)

- **NTP:** every host and container must sync time over NTP. CERT-In directions require logs to
  carry accurate time, and our timestamps are only as good as the host clock.
- **CERT-In 180-day retention in India:** logs must be kept for at least 180 days in an Indian
  region. Shipping, storage and alerting come with the **Production Infra** milestone. This package
  only guarantees the structured stdout format that the shipper consumes.

## Redaction policy

Matter content is privileged (BSA s.132, BCI Rules). It must never reach logs, traces or Sentry.
Several layers enforce this:

1. **Secret keys.** A key matching `/password|secret|token|authorization|cookie|api[-_]?key|otp/i`
   at any depth logs as `[REDACTED]`. `Secret` values from `@causedeck/config/env` also log as
   `[REDACTED]`.
2. **Content guard.** Fields named `content`, `text`, `body`, `quote`, `prompt` or `memoryValue` log
   as `[CONTENT_REDACTED:<length>]`. Only the length survives.
3. **Free-text scrubbing.** Messages, error messages and stacks have bearer tokens, JWTs,
   `key=value` secrets and URL passwords masked.
4. **Lint.** A `no-restricted-syntax` rule in `@causedeck/config/eslint/base` rejects logger calls
   that are passed request bodies or content fields: `logger.info(req.body)`,
   `logger.info({ ...req.body })`, `logger.info({ payload: req.content })`. Log ids and lengths
   instead.
5. **Spans.** `withSpan` and the HTTP middleware drop content and secret attribute keys and scrub
   string values. On failure a span records only the exception type and a scrubbed message.
6. **Sentry.** `beforeSend` deletes request cookies, headers, body and query string, plus user
   email and IP. `dataCollection` turns off user, cookie, header, body and query collection (the
   Sentry 11 replacement for `sendDefaultPii: false`).

Request logging records the method, the path template (or the pathname without its query string),
status, duration and requestId. It never logs query strings, headers or bodies.

The package may import only `@causedeck/config`. The boundary lint enforces this, so logging never
pulls in domain code.

## Tracing and metrics

`initTelemetry({ service })` runs once per process. Next.js calls it from `apps/web/instrumentation.ts`.

- **No `OTEL_EXPORTER_OTLP_ENDPOINT`:** nothing is registered. `@opentelemetry/api` stays a no-op
  with no exporter and no log noise.
- **Endpoint set:** the OTel Node SDK exports traces to `<endpoint>/v1/traces` and metrics to
  `<endpoint>/v1/metrics`. Selected auto-instrumentations are enabled (fs, dns and net are off).
  Sampling is `parentbased_traceidratio` at 0.1 in production and always-on elsewhere.

Add a span:

```ts
await withSpan('db.query', () => db.execute(sql), { attributes: { 'db.system': 'postgresql' } });
```

### Adding a metric

Standard histograms (milliseconds): `http.server.duration` (recorded by the HTTP middleware),
`job.duration` and `db.query.duration`. Record them with `recordHttpServerDuration`,
`recordJobDuration` and `recordDbQueryDuration`. For a new metric:

1. Add its name to `METRICS` in `packages/observability/src/otel.ts`.
2. Add a `record...` helper that creates the instrument through `meter()` and passes attributes
   through `safeAttributes`.
3. Keep attribute cardinality low: route templates, not raw paths; never ids of users or matters.

## Errors (Sentry)

`initSentry()` initialises Sentry only when `SENTRY_ENABLED=true` and `SENTRY_DSN` is set
(credential: #115). Otherwise it returns `false` without loading a client: no network calls and no
warnings. The release is `GIT_SHA`. Our own OpenTelemetry pipeline owns tracing, so Sentry does not
register a tracer provider. Browser Sentry (`apps/web/instrumentation-client.ts`) comes with the
Next.js scaffold (#10).

## Health and readiness

```ts
const health = createHealthHandlers();
health.registerCheck('db', async () => { await db.execute(sql`select 1`); });
// Next: export const GET = withRequestLogging(logger, health.readyz, { route: '/readyz' });
// Hono: app.get('/readyz', (c) => health.readyz(c.req.raw));
```

- `GET /healthz` returns 200 `{status:'ok', version}` and never runs checks.
- `GET /readyz` runs every registered check concurrently, each bounded by a 2 s timeout. It returns
  200 `{status:'ok', checks:{name:{ok,ms}}, version}` when all pass, otherwise 503 with
  `status:'error'` and `ok:false` for each failing check. Error details never appear in the body.
- Both set `cache-control: no-store` and echo `x-request-id`.

`apps/web` serves both from `app/healthz/route.ts` and `app/readyz/route.ts`. Health probes are
logged at `debug`.

**Auth middleware must skip health paths.** Use `isHealthPath(pathname)` (or `HEALTH_PATHS`) from
this package in the web auth middleware (#12) and the API auth middleware (#14), so load balancer
probes never need credentials.
