**Verdict**: CONFIRMED
**Confidence**: medium
**Severity**: low (P3 greenfield, additive; new tables, routes and job only)
**Task Type**: feature

### What Was Claimed
#626 (#487 part 3): per-workspace webhook endpoints, signed delivery with retries, fired on status, cause-list and order changes for watched items; a worker delivery job registered in the apps/worker registry and schedules tests. Acceptance: webhooks fire on changes for watched items [integration]. A maintainer comment adds: every route under the public API prefixes must call `requireScope` and stay workspace-scoped, with a test that a key without the scope gets 403; D-048 (no resale of personal data) and D-050 (no judge ratings, rankings or predictions) apply to every payload.

### What We Found
- Dependency #624 is on base: `packages/core/src/api-keys/index.ts:20-26` already defines the `webhooks:write` scope; `apps/api/src/middleware/api-key.ts:17-23` already allows `/v1/webhook-endpoints` for keys; `apps/api/src/lib/openapi.ts:78-85` has `requireScope`. Not blocked.
- No webhook endpoint or outbound-delivery code exists: `apps/api/src/routes/v1/` holds only `billing.ts`, `me.ts`, `workspaces.ts`; no `webhook_endpoint` table in `packages/db/src/schema/`. The only outbound webhook is Slack-only `packages/fetch/src/webhook.ts:9-40` (host allow-list `hooks.slack.com`), so it cannot deliver to customer URLs. `@causedeck/fetch` is the only package allowed to call `fetch` on an external host (header of `webhook.ts:1-4`), and core already depends on it (`packages/core/package.json`).
- Change sources for "watched items": status/order changes come from `diffStatus` in `packages/core/src/case-watch/diff.ts:12,32-40` and are consumed in `packages/core/src/case-watch/poll.ts:122-134` (`notifyStatusChanges`, `packages/core/src/case-watch/alerts.ts:65`, which skips first snapshots and sensitive matters). Cause-list changes for watches come from `pollCauseList` in `packages/core/src/court/list-watch.ts` (matched-only rows staged as proposals).
- Job pattern to copy: `packages/core/src/jobs/definitions/notification-deliver.ts` (payload `{workspaceId,...}`, `once()`, `RetryableError` for retry, permanent failure recorded and completed), registered in `packages/core/src/jobs/registry.ts:45,163,217` and `packages/core/src/jobs/index.ts:111-123`; expected names listed in `apps/worker/src/__tests__/registry.test.ts:~127`, schedules in `apps/worker/src/__tests__/schedules.test.ts:25-44`, registered by `apps/worker/src/schedules.ts:12-24`.
- Cross-workspace job reads go through owner-defined functions (`app_case_watch_due`, `app_api_key_by_hash` in `packages/db/migrations/0081_api_keys.sql`); tenant tables use `tenantTable()` (`packages/db/src/schema/workspace-integration.ts:23`).
- Migrations are now timestamp-named (D-051, `packages/db/drizzle.config.ts`; `docs/engineering/database.md`); do not use 0083.
- `.forge-lean/*` and an earlier "Investigation Report" comment on #626 describe #499/#500 (agreement model); they are stale and unrelated, and were overwritten.

### Root Cause
Greenfield: change detection exists for watches, but nothing stores customer endpoints, signs and delivers events, or exposes endpoint management to API keys.

### Affected Files
- `packages/db/src/schema/webhooks.ts` (+ `index.ts` export), new timestamp migration + snapshot/journal: `webhook_endpoint` (tenant: url, secret, events[], active, consecutive_failures, created_by) and `webhook_delivery` (tenant: endpoint_id, event_type, event_id, payload jsonb, status, attempts, next_attempt_at, last_status, last_error); owner-defined `app_webhook_delivery_due` for the sweep.
- `packages/fetch/src/webhook-delivery.ts` (+ export in `index.ts`): https-only, private-address and redirect refusal, timeout, response size cap (SSRF guard); the one external-call point.
- `packages/core/src/webhooks/{index,endpoints,events,sign}.ts`: create/list/delete endpoints (secret shown once, audited), `emitWebhookEvent` (fan-out to matching active endpoints, content-free payload: ids, CNR, change kind, timestamps, provenance and `source_license`; never party names, order text, judge ratings), HMAC-SHA256 signature over timestamp + body.
- `packages/core/src/jobs/definitions/webhook-deliver.ts` (`webhook.deliver`) and `webhook-sweep.ts` (`system.webhook.sweep`, re-enqueues due pending deliveries), registry/index wiring.
- Emit hooks injected as deps (no new domain edge): `packages/core/src/case-watch/poll.ts` (+`alerts.ts` call site) and `packages/core/src/court/list-watch.ts`; wired in `packages/core/src/jobs/definitions/status-poll.ts` and `causelist-poll.ts`.
- `apps/api/src/routes/v1/webhook-endpoints.ts` + `v1/index.ts` mount: POST/GET/DELETE `/v1/webhook-endpoints`, each with `requireScope('webhooks:write')`, workspace from the principal.
- Registries: `packages/db/src/index.test.ts`, `packages/db/src/__tests__/rls/sql.test.ts`, `TABLE_TESTS`/seeders, `packages/db/src/testing/cross-tenant-registry.ts` + `packages/core/src/__tests__/cross-tenant/services.test.ts`, `packages/config/eslint/core-domains.js` + `docs/engineering/core-domains.md` (new `webhooks` domain; add to `jobs` deps), `apps/worker/src/__tests__/registry.test.ts` and `schedules.test.ts`.

### Sibling Sweep
Other `/v1` prefixes (`cases`, `causelists`, `orders`, `notices`) belong to #625 and must follow the same `requireScope` + workspace-scope rule, which is not this change's to deliver. Existing outbound-style paths to keep intact: Slack `postWebhook` (data-ops alerts) and `notification.deliver`. The Razorpay inbound webhook (`apps/api/src/routes/webhooks/razorpay.ts`) is inbound and unaffected.

### History
`webhooks:write` scope and prefix allow-list introduced by #624 (PR #633, merge `067d1c64`). Case-watch #591/#592; cause-list watches #482. No prior attempt at #626.

### Recommendation
Build bottom-up: schema + migration, fetch delivery guard, core webhooks domain (pure signing, endpoint services, emit), job + sweep, API routes, then hook emitters via injected deps. Retries via `RetryableError` with pg-boss backoff, a permanent failure (4xx other than 408/429) marks `failed`; disable an endpoint after N consecutive failures. Skip emission for sensitive matters (as `alerts.ts` does). Medium confidence: the cause-list emit point and the secret storage choice (plaintext column under FORCE RLS, shown once, needed for HMAC) need confirming in implementation.

### Related Issues
#487 (parent), #624 (dependency, merged on base), #625 (public read endpoints), #627 (OpenAPI/docs: should document the webhook routes), #483/#591/#592 (case-watch), #482 (cause-list watches).
