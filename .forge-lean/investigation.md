**Verdict**: CONFIRMED
**Confidence**: high
**Severity**: medium (feature; no live defect)
**Task Type**: feature

### What Was Claimed
Part 2 of #96: a staff incident console at `apps/admin/app/(console)/status/page.tsx` with actions to create, update and resolve incidents from a message template, writing incident rows and an `audit_event` per change. Incidents appear in the next `status.publish` cycle. States: loading skeleton, empty, error, offline, and permission-denied for non-staff. Register in the admin tests (server-actions-audit, no-content-fields) and the console nav. Depends on #769.

### What We Found
(verified on HEAD d03a2bc4, which already contains the merged #769)
- No status page, actions or `status` capability exist: `apps/admin/app/(console)/` has no `status/`; `apps/admin/lib/roles.ts:14-27` has no `status` capability; `apps/admin/components/console-nav.tsx:29-56` has no `/status` entry.
- Tables exist: `packages/db/src/schema/status.ts:18` (`incident`) and `:46` (`incidentUpdate`), checks make `state='resolved'` iff `resolved_at` is set (`:42`). The app role has SELECT/INSERT/UPDATE (`packages/db/migrations/20261025050000_status_incident.sql:36-37`). The schema header (`status.ts:6`) says #770 writes them.
- `packages/core/src/status/` has only the read/publish side (`index.ts`, `model.ts`, `publish.ts`: `sanitiseIncident` at `publish.ts:104`, `buildSnapshot` at `:202`). There is NO incident write service, so "the core status service" the issue relies on must gain one. The job `system.status.publish` is in `packages/core/src/jobs/definitions/status-publish.ts`; incidents reach the page on its next run.
- Write-service precedent: `packages/core/src/sources/registry.ts:268` (`assertSourceStaff` against `staffUser`), `:341` (`createSource`: `withUser` transaction, staff check, write, `record()` with actor kind `staff` and `workspaceId: null` in the same tx, `:325-331`). Console action precedent: `apps/admin/app/(console)/sources/actions.ts` (`'use server'`, `requireStaff('sources')`, zod, `redirect('?done=/?error=')`, the `// authz:` comment).
- Audit actions must be registered in `packages/core/src/audit/events.ts` (`AUDIT_ACTIONS`; `source.changed` at `:37`); `security-events.test.ts:87,362` assert registry properties.
- Reads: `apps/admin/lib/data/index.ts:217` (`sourceRegistry` via `staffQuery`, which records `staff.read` and runs in `withoutWorkspace` with a table allowlist, `lib/data/scope.ts:70`).
- Page states: only `apps/admin/app/error.tsx` and `not-found.tsx` exist; no `loading.tsx` anywhere. `requireStaff(cap)` calls `notFound()` for a non-staff or a role lacking the capability (`apps/admin/lib/staff.ts:36-40`), which is the permission-denied behaviour.
- Tests to extend: `apps/admin/__tests__/server-actions-audit.test.ts` (ACTIONS map `:300-385`, enumerates every `'use server'` export `:398+`, mocks `@causedeck/core/sources` at `:89`), `roles.test.ts:23-54` (matrix), `console-layout.test.tsx:60-100` (nav labels per role), `no-content-fields.test.ts:116+` (renders pages against seeded tenants).
- Registries from CLAUDE.md: new runtime exports of `@causedeck/core` need `NOT_A_SERVICE`/`SERVICE_TESTS` in `packages/db/src/testing/cross-tenant-registry.ts` (status block `:1149-1178`, `createSource` precedent `:918`). `status` currently depends only on `court` (`packages/config/eslint/core-domains.js:50`); importing `audit` needs a `CORE_DOMAIN_DEPENDENCIES` edit and `docs/engineering/core-domains.md` (row `:31`, mermaid, dependency table).

### Root Cause
Missing feature: #769 delivered the incident tables and publisher but no staff write path or console UI, so incidents cannot be created.

### Affected Files
- `packages/core/src/status/incidents.ts` (new) + `index.ts` export + test
- `packages/core/src/audit/events.ts`
- `packages/core/package.json` only if exports need no change (`./status` already exported by #769; no edit expected)
- `packages/db/src/testing/cross-tenant-registry.ts`, `packages/config/eslint/core-domains.js`, `docs/engineering/core-domains.md`, `docs/engineering/admin-console.md`
- `apps/admin/lib/roles.ts`, `components/console-nav.tsx`, `lib/data/index.ts`
- `apps/admin/app/(console)/status/{page.tsx,actions.ts,loading.tsx,error.tsx,incident-forms.tsx,offline-banner.tsx}` (new)
- admin tests: `roles.test.ts`, `console-layout.test.tsx`, `server-actions-audit.test.ts`, `no-content-fields.test.ts`, new `status-page.test.tsx`

### Sibling Sweep
Same pattern (audited staff write to a global table) is `sources` (`#478`) and flags; follow `sources/actions.ts`. The `no-content-fields` and `server-actions-audit` guards are the registries any new admin page/action must join. #771 (public page) reads only the published snapshot, so it is unaffected. Do not confuse with `system.status.poll` (case-watch).

### History
Tables and publisher: #769 (merged, PR #787). No prior console. `source.changed` (#478) is the template for the audit shape.

### Recommendation
Add `createIncident`, `addIncidentUpdate` (state change or resolve) and `listIncidents` plus the pure `INCIDENT_TEMPLATES` to core `status`, audited in-tx as `incident.changed`; a new `status` capability for ops and admin; the page with `loading.tsx`, `error.tsx`, empty state, an offline banner (client, `navigator.onLine`) and notFound for others; register everything in the guards listed above.

### Related Issues
#96 (parent), #769 (dependency, merged), #771, #772 (siblings).
