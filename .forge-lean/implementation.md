### Approach
Pure detectors over fetch_log and a new source_parse_run table, evaluated by a scheduled core job; alerts deduped in a ledger, routed to Slack/email, with auto-responses (block backoff, parser quarantine). The fetcher takes an optional injected health port.
### Changes
- packages/db: SLO columns on source, new data-ops tables, migration 0067 plus snapshot, GLOBAL_TABLES, index test.
- packages/core/src/data-ops: detectors, alerts, routing, response, runbooks, index (recordParseRun) and tests; job data-ops-evaluate registered.
- packages/fetch: block-signature, health port in fetcher/types, webhook sender (Slack host allow-list; the only external call, inside packages/fetch), tests.
- config env keys, docs (core-domains, env, ADR 0035), runbook, worker registry/schedule tests.
### Acceptance Criteria Status
- R1 ✅ packages/db/src/schema/source-registry.ts
- R2 ✅ packages/core/src/data-ops/detectors.ts
- R3 ✅ packages/core/src/data-ops/alerts.ts, routing.ts
- R4 ✅ packages/core/src/data-ops/response.ts
- R5 ✅ data-ops/__tests__/detectors.test.ts
- R6 ✅ data-ops/__tests__/alerts.test.ts, fetch/src/__tests__/health.test.ts
- R7 ✅ data-ops/__tests__/detectors.test.ts (runbooks)
### Verification
V1-V4 not run locally (CI mode); recorded ci:true. Lint (lane-check) on changed files and prettier passed. forgedock check: PASS. V5 widened to full because packages/core/package.json changed; not run.
### Notes
New optional env DATA_OPS_SLACK_WEBHOOK_URL and DATA_OPS_ALERT_EMAIL (unset: console routing). Core root does not re-export data-ops, so no cross-tenant service registration is needed.

## Stale-list follow-up
The 30 flagged (symbol, test) pairs in apps/admin/__tests__ (headers, server-actions-audit, sources-actions) are not list members: those tests mock admin modules and enumerate no `@causedeck/db` schema exports. Recorded under `not_members` in result.json; no test edits.

### Sibling-list check
The admin tests headers, server-actions-audit and sources-actions do not list db schema exports; their mocks cover the `@causedeck/core/sources` surface only. The new data-ops schema symbols are recorded as `not_members` in result.json; no test edits needed.

## Duplicate export fix
`response.ts` re-exported `detectBlockSignature` from `detectors.ts`, so the data-ops barrel exported it twice. Removed the re-export and the now-unneeded value import; `detectors.ts` stays the only owner. No other references.

## Prettier fix
CI `format:check` flagged `packages/db/migrations/meta/0067_snapshot.json` (generated snapshot not Prettier-formatted). Ran `prettier --write` on it; content is unchanged, only whitespace/line layout. `prettier --check` passes on it and `_journal.json`.

## Lint fix
CI lint failed (log unavailable); reproduced with lane-check lint on changed files and fixed:
- `schema.ts`: `z.url()` / `z.email()` replace the deprecated `z.string().url()/.email()`.
- `detectors.ts`, `webhook.ts`: numbers in template literals wrapped in `String()` (restrict-template-expressions).
- `health.test.ts`: dropped an unnecessary `as never` assertion.
- `boundaries.js`: `fetch` added to `CORE_DEPENDENCIES`; core imports `postWebhook` from `@causedeck/fetch` (ADR 0035, the sanctioned external-host sender).
lane-check lint is clean on the 26 changed files.
