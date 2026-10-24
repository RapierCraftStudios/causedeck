**Verdict**: CONFIRMED
**Confidence**: medium
**Severity**: P3 greenfield; additive routes, but legal-gated data exposure (D-048, D-050) so the gate must fail closed
**Task Type**: feature

### What Was Claimed
Under `apps/api/src/public/v1/` add `GET /v1/cases/{cnr}`, `/v1/causelists`, `/v1/orders`, `/v1/notices`. Every record carries provenance and `source_license`. Serve only cleared sources or contributed copies, only `data_class` non-personal via `exposableThroughApi`, personal data only for the caller's own matters (docs/legal/court-data-posture.md). A maintainer comment adds: every route calls `requireScope` with its scope and stays workspace-scoped; a test that a key without the scope gets 403; D-048 (no resale of personal data) and D-050 (no judge ratings, rankings or predictions) apply to every response. Acceptance: only cleared-source data with provenance on every record [integration].

### What We Found
- Dependency #624 is CLOSED and its code is on base `e89a069f`: `requireScope` (`apps/api/src/lib/openapi.ts:78`), API-key principal (`Principal.apiKey`, `openapi.ts:19-21`), `apiKeyEnforcement` with `API_KEY_ROUTE_PREFIXES` already listing `/v1/cases|causelists|orders|notices|webhook-endpoints` (`apps/api/src/middleware/api-key.ts:17-23`), per-call billing and quota (`api-key.ts:46-58`), scopes `cases:read causelists:read orders:read notices:read` (`packages/core/src/api-keys/index.ts:20-26`).
- `apps/api/src/public/` does not exist; routers are registered in `apps/api/src/routes/v1/index.ts:33-52` (me, workspaces, billing...). Scope-403 test pattern with probe routes: `apps/api/src/__tests__/api-keys.test.ts:15-35,75-80`; fixtures in `apps/api/src/__tests__/helpers.ts`.
- `requireWorkspace` (`apps/api/src/middleware/workspace.ts:41`) resolves the workspace from a header and checks user membership; a key's principal is the issuer and `apiKeyEnforcement` already forces `x-workspace-id` to equal the key's workspace (`api-key.ts:44-49`). Public routes should take the workspace from `principal.apiKey.workspaceId` (cookie callers: `x-workspace-id` via `requireWorkspace`) and run through `c.var.withWorkspace`.
- Gate helpers: `exposableThroughApi` (`packages/core/src/sources/registry.ts:25`, only `non-personal`), `decideSourceClearance` (`registry.ts:~105`, null = cleared; needs terms+counsel cleared, `clearedAt`, no kill switch). `source.data_class` default `personal` (`packages/db/src/schema/source-registry.ts:66`).
- Data: cases = tenant `proceeding` (cnr, `proceeding.ts:~55`) + `case_watch` (source) + latest `case_status_snapshot` (`fields` = `ParsedCaseStatus`: next/last hearing, stage, bench, orders; provenance columns; `packages/db/src/schema/case-watch.ts:31-95`, `packages/adapters/src/status/types.ts:20-34`). Cause lists / orders = global `contributed_document` kinds `cause_list`/`order` (`packages/db/src/schema/network.ts:20-50`, read by `packages/core/src/network/read.ts` `findContributed`, which filters withdrawn and past-retention, no contributor field). Notices = global `notice` (`notices.ts:46-80`) with provenance columns, read per workspace via `notice_match` (`packages/core/src/notices/list.ts`).
- There is no `source_license` column or any licence text on `source` (`source-registry.ts:54-76`); it must be derived (see decision K2).
- Posture doc: personal/mixed sources "Never" through the API; non-personal "Allowed once the API exists (#487)" (`docs/legal/court-data-posture.md`, lawful-basis table). Own-matter personal data is the workspace's own `proceeding`/snapshot data.
- A stale `.forge-lean/` from another issue (#500-ish facts/conflicts) was present and has been removed; the issue comment "Investigation Report" on #625 is about a different issue and was ignored.

### Root Cause
Greenfield: the key-auth plumbing (#624) exists and allowlists the paths, but no routes, no response schemas and no data-class/clearance gate for public records exist.

### Affected Files
- NEW `apps/api/src/public/v1/` : `index.ts` (router factory `publicV1Router(db)`), `cases.ts`, `causelists.ts`, `orders.ts`, `notices.ts`, shared `schemas.ts` (Provenance + `source_license`).
- `apps/api/src/routes/v1/index.ts`: mount the public router.
- NEW core domain `packages/core/src/public-api/` (`index.ts`, `read.ts`, test) + export `./public-api` in `packages/core/package.json`: gated reads `getPublicCase`, `listPublicCauseLists`, `listPublicOrders`, `listPublicNotices`, `sourceLicense`. (Alternative of putting these in `apps/api` was rejected: logic must be unit/cross-tenant testable and apps import core only through exports.)
- `packages/config/eslint/core-domains.js` (`CORE_DOMAIN_DEPENDENCIES`: `public-api` -> `sources`) and `docs/engineering/core-domains.md`.
- `packages/db/src/testing/cross-tenant-registry.ts` (`SERVICE_TESTS` for workspace-scoped reads, `NOT_A_SERVICE` for `sourceLicense`) and `packages/core/src/__tests__/cross-tenant/services.test.ts`.
- `apps/api/src/__tests__/cross-tenant.test.ts` `ROUTES` map (every built-in `/v1` route must be listed) and a new `apps/api/src/__tests__/public-api.test.ts` (403 without scope, 200 with, non-personal/uncleared gating, provenance + `source_license` on every record, workspace isolation, no rating/ranking fields).
- Enumerating tests: `packages/core/src/sources/registry.ts` is NOT changed, so `apps/admin/__tests__/server-actions-audit.test.ts:78` and `apps/admin/__tests__/sources-actions.test.ts:12` (literal sibling export lists) stay untouched; if registry.ts gains an export, both must join. `apps/api/src/__tests__/static-guards.test.ts` and `openapi.test.ts` (route security guard) must stay green.
- Possibly `packages/validators/src/api/` if schemas are shared; prefer local `schemas.ts` to avoid a new hub edit.

### Sibling Sweep
- #626 (webhook-endpoints routes) will add the same `requireScope('webhooks:write')` requirement; the shared per-route scope pattern from this change should be reusable. No other route under the five prefixes exists today (grep of `apps/api/src/routes`).
- Every query path (contributed copies, notices, snapshots) must apply the same gate; `findContributed`/`listWorkspaceNotices` do NOT check clearance or data class, so the new reads must not reuse them unfiltered.

### History
- #624 / PR #633 added keys, scopes, allowlist and billing; `requireScope` and the prefix list were added there for this issue. #486 / PR #623 added `data_class`, `exposableThroughApi` and retention. No prior implementation of these routes.

### Recommendation
Implement with a fail-closed gate: a record is served only if its source row is cleared (`decideSourceClearance === null`) AND, for global/shared records (contributed copies, notices, cause lists), `exposableThroughApi(source.dataClass)`. Cases and own-matter orders come from the caller's workspace tables under `withWorkspace` (personal data allowed, own matters only), still requiring a cleared source and, for orders-as-text, no judge/party analytics. Each route: `middleware: [requireScope('<x>:read')]`, workspace from the key. Response records: `{ ..., provenance: { source_id, source_type, source_ref/url, captured_at, confidence?, kind: 'fetched'|'contributed' }, source_license }`. No contributor workspace, no judge ratings/rankings/predictions (D-050), no party names from shared data (D-048). Cursor/limit pagination per `packages/validators/src/api/pagination.ts`. `/causelists?advocate=` only matches the caller's own watches (`cause_list_watch`), never a free-text person search over shared copies.

### Related Issues
#487 (parent, closed not_planned), #624 (dependency, closed), #626 (webhooks, open), #627 (OpenAPI docs, open), #486 (posture/data class), #478 (source registry), #485 (contributed copies), #480 (notices), D-048, D-050.
