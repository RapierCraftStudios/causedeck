### Approach
A global `review_item` queue plus tenant `review_correction` rows. A SECURITY DEFINER `app_review_propagate` writes one correction per watcher of the record. Core `review` domain services, audited admin actions and pages, and a consented report-error action in the web matter page.

### Changes
- packages/db: review_item and review_correction tables, migration 20261024134105_review_queue (renumbered after the base's portfolio migration; SQL unchanged, snapshot and journal regenerated), registry and seeders.
- packages/core/src/review and data-ops/response.ts (enqueue on parse_yield and conflict_rate breaches).
- apps/admin: review queue pages, audited actions, send-to-workbench, nav entry.
- apps/web: reportRecordErrorAction, report-error component, correction display, i18n, vitest.config.ts.
- core-domains lint config and docs.

### Acceptance Criteria Status
- R1 ✅ apps/web/app/(app)/w/[slug]/matters/[id]/actions.ts:187
- R2 ✅ apps/admin/app/(console)/review/page.tsx
- R3 ✅ packages/core/src/review/corrections.ts
- R4 ✅ packages/core/src/review/__tests__/review.test.ts
- R5 ✅ apps/admin/app/(console)/review/actions.ts; review.test.ts:217
- R6 ✅ packages/core/src/review/queue.ts:124; review.test.ts:185
- R7 ✅ packages/core/src/data-ops/response.ts:212

### Verification
V1-V5 pass with TESTCONTAINERS_RYUK_DISABLED=true (see result.json). review.test.ts and the cross-tenant ACTIONS entry fail without the fix.

### Notes
No new env vars. `turbo` is not on PATH here; use `pnpm exec turbo`.

### Post-merge check (turbo exit 127)
The merged-tree failure was `turbo: command not found` (PATH), not a code conflict. Ran `node_modules/.bin/turbo run typecheck --filter='...[origin/milestone/court-data-network]'`: 24/24 tasks pass. V1-V5 re-run and pass. No code changes needed.

### Post-merge check (turbo exit 127)
`turbo: command not found` is an environment issue (not on PATH), not a code conflict. Ran `pnpm exec turbo run typecheck` scoped to db, core, admin, web and i18n: 20/20 tasks pass. `forgedock check`: V1-V5 pass. No code change needed.

### Post-merge check (turbo exit 127, again)
Still `turbo: command not found` (PATH), not a code conflict. `pnpm exec turbo run typecheck` scoped to db, core, admin, web, i18n and adapters: all tasks pass. `forgedock check`: V1-V5 pass. No code change.
