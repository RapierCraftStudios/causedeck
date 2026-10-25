### Approach
Followed the `sources` precedent: a core write service (staff check, rows and `incident.changed` audit in one `withUser` transaction), a `status` staff capability (ops, admin), a console page with server actions, and the guard registrations.

### Changes
- packages/core/src/status/incidents.ts: new `INCIDENT_TEMPLATES`, `createIncident`, `addIncidentUpdate`, `listIncidents`, `IncidentAdminError`, `asIncidentStaff`.
- packages/core/src/status/index.ts: exports them.
- packages/core/src/status/incidents.test.ts: DB test (rows, audit, staff gate, resolved rejects updates, next snapshot build, empty title).
- packages/core/src/audit/events.ts: `incident.changed` (security).
- packages/db/src/testing/cross-tenant-registry.ts: NOT_A_SERVICE entries; cross-tenant-registry.test.ts (new) asserts them.
- packages/config/eslint/core-domains.js, docs/engineering/core-domains.md: status depends on audit.
- apps/admin/lib/roles.ts, components/console-nav.tsx, lib/data/index.ts: `status` capability, nav item, `incidentConsole` read.
- apps/admin/app/(console)/status/{actions.ts,page.tsx,loading.tsx,error.tsx,offline-banner.tsx}: the console.
- apps/admin tests: status-page (new), server-actions-audit, no-content-fields, roles, console-layout.
- docs/engineering/admin-console.md: Status section.

### Acceptance Criteria Status
- R1 ✅ packages/core/src/status/incidents.ts, apps/admin/app/(console)/status/actions.ts, page.tsx
- R2 ✅ packages/core/src/status/incidents.test.ts (buildSnapshot includes the new incident); page note that changes publish within a minute
- R3 ✅ status/loading.tsx, error.tsx, offline-banner.tsx, page.tsx (empty state, requireStaff notFound)
- R4 ✅ server-actions-audit.test.ts, no-content-fields.test.ts, console-nav.tsx
- R5 ✅ uses #769 tables; core status service extended in incidents.ts

### Verification
- V1 core vitest src/status + security-events: pass (36 tests); new test fails without the fix (module absent).
- V2 admin vitest (5 files): pass (61 tests).
- V3 db vitest src/testing: pass; the directory had no tests, so a small registry test was added.
- V4 checks.mjs: pass. Scoped typecheck of admin, core and db: pass. ESLint on changed files: clean (needed NODE_OPTIONS=--max-old-space-size for the admin set).

### Notes
No migration, no env vars. The core staff gate is ops/admin; support is denied in core and by `requireStaff('status')`. `scripts/check-devdocs-freshness.sh` does not exist in this repo.

### Stale-list follow-up
Guard flagged incidentConsole (growth-page, migrations-page tests) and the incident exports (status.test.ts). None is a member: those tests mock/import only what their own page or publish.ts uses. Recorded in result.json `not_members`; no test edits needed.
