### Approach
Copied the #82 client_contact pattern for five tenant tables (composite workspace-paired FKs, paise bigint, CHECKs mirroring validators enums), generated the migration with drizzle-kit and hand-added ENABLE/FORCE RLS plus `ws_isolation`. Matter, person and invoice links are RESTRICT so erasure cannot delete money records; the ADR records anonymise-not-delete.

### Changes
- packages/validators/src/fees.ts, fees.test.ts, package.json: zod schemas, tests, `./fees` export.
- packages/db/src/schema/fees.ts, schema/index.ts: five tables and export.
- packages/db/migrations/20261026131044_fees.sql, meta snapshot and journal (idx 107).
- packages/db/src/index.test.ts, __tests__/rls/sql.test.ts, testing/cross-tenant-registry.ts, testing/two-tenants.ts: registries and seeders.
- docs/adr/0043-legal-gated-billing-flag.md, docs/adr/README.md: ADR and index row.

### Acceptance Criteria Status
- R1 ✅ packages/validators/src/fees.ts
- R2 ✅ packages/db/src/schema/fees.ts, migrations/20261026131044_fees.sql
- R3 ✅ index.test.ts, rls/sql.test.ts, cross-tenant-registry.ts, two-tenants.ts
- R4 ✅ docs/adr/0043-legal-gated-billing-flag.md

### Verification
- V1 validators vitest (fees, client-contact, index): pass; fees.test.ts is new so it cannot pass without the fix.
- V2 db vitest index.test.ts and rls/sql.test.ts: pass (index.test.ts fails without the schema export).
- V3 check-schema-conventions and lint-migrations: pass. drizzle-kit check, tsc --noEmit on db and validators: clean.
- V4 adr:lint and docs:links: pass. forgedock check: PASS.
- The two-tenant DB-backed suites need Postgres and were not run here; CI covers them.

### Notes
No behaviour change for existing code; additive tables only. No env vars. The retention period in the ADR (eight years) is an assumption pending counsel.

## Stale-list follow-up
The six flagged tests (admin growth-page, headers, server-actions-audit, sources-actions; web activity-export-route, billing-actions) do not enumerate @causedeck/db schema exports (no table or export list at the cited lines), so the new tables are recorded as not_members in result.json.

### Stale-list follow-up
Checked the six flagged tests at the cited lines: none enumerates `@causedeck/db` schema exports (they mock session state, activation or sources enums, or a db mock with only `withoutWorkspace`/`withWorkspace`). All 30 symbol/test pairs are recorded in `result.json` `not_members`; no test list changed, so no new commit and validate results are unchanged.

## CI fix: tenancy
No log was available, so this is a diagnosis, not a reproduction. The five new tables' composite FKs to matter, person, fee_agreement and invoice used `ON DELETE RESTRICT`. RESTRICT is checked immediately, so deleting an organization (cascade to matter and to the fee tables in one statement) fails. The tenancy suites delete workspaces, so they likely hit this. Changed those nine FKs to NO ACTION in schema/fees.ts, the migration SQL, the snapshot and ADR 0043. NO ACTION is checked at statement end, so a workspace delete cascades, while deleting a person or matter that still has money rows is still refused. Re-ran V3, adr:lint and the db index test: pass. The DB-backed tenancy suite needs Postgres and was not run here.

## CI fix (tenancy)
Export-coverage guard failed: added ws() exporters for the five fee tables and put them before client_contact/person in the erase order.
