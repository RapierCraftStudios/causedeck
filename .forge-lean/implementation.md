### Approach
Outward update drafts (#735): L4-only drafts composed from templates (EN/TA/KN) with an optional India-only `outward_update` AI task, a guard that blocks forbidden phrasing, a diff for edits, and a share record. There is no send path (ADR 0039). Prior commits already hold the work; this pass merged the base (no collision left: base head 68a9c8ba, ADR 0039 and migration 20261025135312 are the next free numbers), re-ran every validate command, and applied prettier.

### Changes
- packages/validators/src/outward-draft.ts (+test, index): DraftRequest, DraftEdit, ShareRecord, Audience, Language.
- packages/db: schema/outward-draft.ts, migration 20261025135312_outward_drafts.sql, registries, RLS catalog, two-tenant seeders.
- packages/ai: task `outward_update`, mock fixtures EN/TA/KN, drafting tier.
- packages/core/src/outward/*: compose, guard, diff, share, context, templates; audit events; erase/export hooks.
- docs/adr/0039, adr README, core-domains doc and eslint domain edge.

### Acceptance Criteria Status
- R1 ✅ packages/validators/src/outward-draft.ts, packages/db/src/schema/outward-draft.ts
- R2 ✅ packages/ai/src/tasks/outward-update.ts
- R3 ✅ packages/core/src/outward/{compose,guard,diff,share}.ts, packages/core/src/audit/events.ts
- R4 ✅ docs/adr/0039-outward-drafts-no-send-path.md, packages/db/src/testing/cross-tenant-registry.ts
- R5 ✅ packages/core/src/outward/__tests__/*, packages/ai/src/tasks/__tests__/outward-update.test.ts
- R6 ✅ same tests

### Verification
- V1 validators vitest: pass. V2 ai vitest: pass. V3 core vitest: pass. V4 db vitest: pass. V5 config vitest: pass. V6 adr:lint: pass.
- V7 lane-check.sh does not exist on this host (exit 127, environment problem); substituted `tsc --noEmit` for validators, ai, db and core: all clean.
- The new tests fail without the fix because the outward modules do not exist.

### Notes
No env vars. Policy matrix, worker registry and AI gateway are unchanged.

## Stale-list follow-up
Checked the four listed tests (admin headers, server-actions-audit, sources-actions, web activity-export-route). None enumerates @causedeck/db schema exports or sibling tables (none names obligation tables either), so the outward symbols are recorded as not_members in result.json. No code change.
