**Verdict**: CONFIRMED
**Confidence**: high
**Severity**: medium (feature foundation, additive schema only; money and RLS correctness matter)
**Task Type**: feature

### What Was Claimed
Part 1 of #83: add zod schemas (`FeeAgreementInput`, `InvoiceInput`, `InvoiceLine`, `PaymentRecord`, `LedgerEntry`, `GstTreatment`) in `packages/validators/src/fees.ts`; tables `fee_agreement`, `invoice`, `invoice_line`, `payment`, `client_ledger_entry` in `packages/db/src/schema/fees.ts` (workspace_id not null, RLS on app.workspace_id) with the next free migration; registry updates (`packages/db/src/index.test.ts`, `rls/sql.test.ts`, two-tenant seeders); ADR `docs/adr/0043-legal-gated-billing-flag.md` with retention/anonymisation rules for ledger lines.

### What Was Found
- None of this exists on the base: no `fees.ts` in `packages/db/src/schema` or `packages/validators/src`; `docs/adr` ends at 0042 (`docs/adr/README.md:52`).
- Spike lists the tables as v1 legal-gated: `docs/engineering/13-technical-architecture-spike.md:196`. Flag `invoices.enabled` already exists (`docs/engineering/flags.md:11`).
- `saas_invoice` is deliberately named to avoid colliding with the client-fee `invoice` (`packages/db/src/schema/saas-invoice.ts:2-3`), so the table names `invoice`/`invoice_line` are free.
- Pattern to copy, #82's change (f5abd6f6): `packages/db/src/schema/client-contact.ts` (tenantTable, composite `(workspace_id,id)` unique, paired composite FKs, CHECKs via `inList`), `schema/index.ts:325` export, migration `packages/db/migrations/20261026080832_client_contact.sql` (hand-written RLS: ENABLE+FORCE+`ws_isolation`), `meta/_journal.json` idx 106, registries: `index.test.ts:81`, `__tests__/rls/sql.test.ts:224`, `testing/cross-tenant-registry.ts:136` (`DB_TABLES_TEST`), `testing/two-tenants.ts:1344` seeder; validators subpath export `packages/validators/package.json:10`.
- Money convention: bigint paise, `bigint(name,{mode:'number'})` (`schema/saas-invoice.ts:~40`). GSTIN pattern in `packages/validators/src/gstin.ts:6`.
- Parent keys for FKs: `matter` has `matter_workspace_id_id_uq` (`schema/matter-graph.ts:43`); `person` is in `schema/people.ts:29`.
- Latest migration is `20261026080832_client_contact` (next free = a new timestamp later than it; re-check against base at implementation).

### Root Cause
Feature not yet built; #83 was split into 5 parts and this is the schema/validator foundation.

### Affected Files
- new `packages/db/src/schema/fees.ts`; `packages/db/src/schema/index.ts`
- new migration `packages/db/migrations/<ts>_fees.sql`, `meta/<ts>_snapshot.json`, `meta/_journal.json`
- `packages/db/src/index.test.ts`, `packages/db/src/__tests__/rls/sql.test.ts`, `packages/db/src/testing/cross-tenant-registry.ts`, `packages/db/src/testing/two-tenants.ts`
- new `packages/validators/src/fees.ts`, `fees.test.ts`; `packages/validators/package.json` (export)
- new `docs/adr/0043-legal-gated-billing-flag.md`; `docs/adr/README.md` (index row)

### Sibling Sweep
Same registration lists as #82 (above). No runtime export of `@causedeck/core` and no server action is added, so the core service and action registries are untouched. No job/schedule. `docs/engineering/database.md` has no table list to update (checked grep).

### History
Pattern introduced by the #82 change f5abd6f6 (client_contact). #83 closed not_planned, replaced by siblings #868-#872.

### Recommendation
Implement as a pure schema/validator/doc change. Money in integer paise; GST treatments as a closed enum (e.g. forward_charge, reverse_charge, exempt, nil_rated, out_of_scope, pure_agent per docs/engineering/gst-invoicing.md); ledger entries append-only kinds (disbursement, fee, payment, adjustment) with an `anonymised_at` marker; ADR states ledger lines are retained for the statutory period and on erasure the client link is anonymised, never deleted. Generate the migration with `pnpm --filter @causedeck/db db:generate` (drizzle-kit only, no DB needed), then hand-add RLS statements as in client_contact.sql, and run `lint-migrations`.

### Related Issues
Parent #83; siblings #869 (GST maths), #870 (core domain), #871 (web), #872 (stories/e2e); #120 counsel unlock of the flag.
