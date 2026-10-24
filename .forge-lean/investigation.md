**Verdict**: CONFIRMED
**Confidence**: medium
**Severity**: medium (greenfield feature, part 6 of #498; last UI slice)
**Task Type**: feature

### What Was Claimed
Add `apps/web/app/(app)/w/[slug]/portfolio/`: CSV import, dashboard (next dates, stage, adverse orders), exception alert settings, exports; an i18n namespace with catalog test; cross-tenant-actions test entries for every `'use server'` action. Depends on #663 (service), #664 (billing), #665 (alerts).

### What We Found
- No portfolio route exists: `apps/web/app/(app)/w/[slug]/` has no `portfolio/` (listing checked at origin/milestone/court-data-network, 5906e366).
- Core service is done and exported from the root: `packages/core/src/index.ts:22` -> `packages/core/src/portfolio/index.ts:5-27` (`importPortfolioCases`, `listPortfolioCases`, `portfolioSummary`, `exportPortfolioCsv`, `parsePortfolioCsv`, `scanPortfolioAlerts`). Import is owner-only, reads for any active member (`access.ts:16-24`). `packages/core/package.json` has no `./portfolio` subpath (only root and per-domain subpaths, lines 25-45).
- There is NO core function to create or list portfolios: `schema.portfolio` is only inserted by tests/seeders (`packages/db/src/testing/two-tenants.ts`, `portfolio.test.ts`). The UI cannot get a `portfolioId` without one -> small core addition needed (see Recommendation).
- Dashboard data shape: `dashboard.ts:20-36` (filters stage, nextFrom/nextTo, adverseOnly, limit<=500), `:72-81` (`PortfolioSummary`: total, byStage, withAdverseOrder, upcoming, overdue). Import report shape: `import.ts:39-51`. Export returns a CSV string: `export.ts:22-27`.
- Alert categories exist: `packages/notifications/src/categories.ts:47-58` (`portfolio.adverse_order`, `portfolio.missed_date`); the notification preferences form already maps them (`settings/notifications/preferences-form.tsx:89-90`), so "alert settings" can reuse `setNotificationPreferenceAction` (`settings/notifications/actions.ts:97`) rather than a new action.
- Billing #664 closed `needs-human conformance.unimplemented`, but `packages/billing/src/plans.ts:23,56-61` already has `TRACKED_CASE_PRICE_PAISE`/`trackedCaseChargePaise`; the UI does not need it.
- Precedent for the page/action pattern: `courts/rosters/{page,actions,loading,error}.tsx` and `workspaceAction` (`apps/web/lib/workspace-action.ts`), actions wrapped as async exports (`rosters/actions.ts:120-135`).
- Workspace kind `institution` exists (`packages/db/src/schema/auth.ts:44`); nav routes are the `WORKSPACE_ROUTES` list in `apps/web/lib/nav.ts:26-45` with `nav.test.ts` guarding it.
- i18n: namespaces in `packages/i18n/src/catalog.ts:7-38` (e.g. `courts-rosters` at :20), JSON per locale in `packages/i18n/src/messages/{en,kn,ta}/`, expected list in `packages/i18n/src/__tests__/catalog.test.ts:~95-100` (camelCase names).
- Cross-tenant actions guard: `apps/web/__tests__/cross-tenant-actions.test.ts` `ACTIONS` (:123) and probe inputs (:565-), final check that exported == ACTIONS (:798).

### Root Cause
Part 6 of a staged build: the data model (#661), adapters (#662), service (#663) and alerts (#665) landed, but nothing in `apps/web` surfaces them, and the service lacks a way to create/list a workspace's portfolio.

### Affected Files
- New: `apps/web/app/(app)/w/[slug]/portfolio/{page.tsx,loading.tsx,error.tsx,actions.ts}`, components under `apps/web/components/portfolio/`.
- `packages/core/src/portfolio/{portfolio.ts (new),index.ts}`, registry `packages/db/src/testing/cross-tenant-registry.ts`, `packages/core/src/__tests__/cross-tenant/services.test.ts` (or `portfolio.test.ts` the registry points to).
- `packages/i18n/src/{catalog.ts,messages/{en,kn,ta}/portfolio.json,__tests__/catalog.test.ts}` (+ generated types if checked in: `generated/messages.d.ts`).
- `apps/web/lib/nav.ts` (+ nav test), `apps/web/__tests__/cross-tenant-actions.test.ts`.

### Sibling Sweep
Every new core runtime export and every `'use server'` action needs a registry entry (CLAUDE.md table). Other pages' `loading/error` files and `__state` dev previews follow rosters; mirror them. No existing code path creates portfolios, so the same gap applies to any API surface (out of scope).

### History
Parent #498 (closed not_planned umbrella). Siblings #661-#665 merged on milestone/court-data-network. This is the first web slice.

### Recommendation
1. Core: add `listPortfolios` (any member) and `createPortfolio` (owner-only, name 1-200 chars, unique per workspace -> CONFLICT) in `packages/core/src/portfolio/portfolio.ts`, exported via index; register both as `denies` in the cross-tenant registry with real cases.
2. Actions (`workspaceAction`, zod, `WorkspaceScoped`): `createPortfolioAction`, `importPortfolioAction` (owner; CSV text up to a size cap, optional sourceId), `exportPortfolioCsvAction` (members; returns CSV string for a client download). Core functions take `{db}` deps; use the actor's `ctx.tx`-compatible db like other actions. Alert settings reuse the existing preference action (no new action), linking/embedding the two categories.
3. Page: server component with summary cards, filters (stage, next-date window, adverse only via search params), table of cases, import form (owner only), export button, alerts card; loading/error states; read-only for non-owners; empty state when no portfolio.
4. i18n namespace `portfolio` in en/kn/ta + catalog tests; nav item `portfolio` shown for `institution` kind workspaces.
5. Cross-tenant: ACTIONS + probes for each new action.

### Related Issues
#498 (parent), #663, #664, #665, #661, #662.
