**Verdict**: CONFIRMED
**Confidence**: medium
**Severity**: medium (P2, part 3 of #495: district matters outside Chennai cannot be watched)
**Task Type**: feature

### What Was Claimed
Register eCourts status sources per state in the sources registry and `STATUS_SOURCES`, route through `packages/fetch` with `delegatedFor` and per-host rate budgets, record provenance. Acceptance: a watched district matter refreshes through a delegated lookup, with provenance [type:integration]. Depends on #634 and #635 (both merged; the stale `.forge-lean` files from #635 are superseded).

### What We Found
- `STATUS_SOURCES` has one district entry only, `in.tn.chennai-district:case_status` (`packages/core/src/case-watch/lookup.ts:41-45`), template `ecourts-district`.
- The lookup is already delegated and records provenance: `fetchSource(..., {delegatedFor})` (`lookup.ts:262-269`), then stores `via:'server'`, `tierUsed`, `costDollars`, `sourceRef` (`lookup.ts:285-291`). The new states only need registry entries.
- Server action rejects any source not in `STATUS_SOURCES` (`apps/web/app/(app)/w/[slug]/settings/case-watch/actions.ts:142`). The proceedings page lists `Object.keys(STATUS_SOURCES)` (`.../proceedings/page.tsx:98`). The label is `t('source.'+sourceKey(id))` (`apps/web/components/matters/status-watch-panel.tsx:68`), so each new id needs en/ta/kn labels in `packages/i18n/src/messages/*/case-watch.json:11-12`, plus the generated files.
- No `source` table row exists for any `:case_status` id: rows are seeded in migrations, uncleared (pattern `packages/db/migrations/0076_display_board.sql:49-71`, `ON CONFLICT DO NOTHING`; notice rows `0071_notices.sql:72-76`). `policyFor` fails closed on unknown rows, so a new id gets no fetch until a row exists and counsel clears it.
- Rate limiting is per source id (`source:<id>`, `packages/fetch/src/fetcher.ts:107-114`, `rate-limit.ts`) plus per-advocate for captcha. All district states share the host `services.ecourts.gov.in` (`db/src/seed/forum-catalogue/ecourts/snapshot.ts:151`), so N per-state sources would multiply the budget against one host. There is no per-host budget today.
- `checkUrl` already pins the URL host to the source `base_url` (`fetcher.ts:50-61`).
- Parsers and fixtures for 5 states exist (#634: `packages/adapters/src/ecourts/`, `adapters/fixtures/status/manifest.json`, template `ecourts-district`).
- The migrations dir mixes numbered (`0082_staff_conflict_rate`) and timestamped (`20261024063416_webhooks`) names; the latest journal tag is `20261024063416_webhooks` (`db/migrations/meta/_journal.json:597`).

### Root Cause
Only Chennai is registered as a district status source; there are no registry rows for the other states, and the fetch layer limits per source, not per host.

### Affected Files
- `packages/core/src/case-watch/lookup.ts`: add `in.<st>.district:case_status` for tn, ka, mh, dl, up (keep the Chennai id).
- `packages/fetch/src/fetcher.ts` (+ `types.ts` if the policy gains a field, `__tests__/fetcher.test.ts`): per-host sliding-window budget, key `host:<host>`, checked with `canAcquire` before any `tryAcquire`, so a denial spends nothing. Deny with a new `FetchDenied` reason `host_rate_limited`; check where reasons are enumerated.
- New migration (hand-written SQL plus a journal entry and snapshot, next tag after `20261024063416_webhooks`): insert the 5 uncleared `source` rows (kind `court`, access mode A0, max_tier `http` because the DB CHECK keeps court rows off `captcha`, base_url `https://services.ecourts.gov.in/`, low rate limit, notes naming the terms to confirm). Do not clear them.
- `packages/i18n/src/messages/{en,ta,kn}/case-watch.json` + generated `messages/*.json`, `generated/messages.d.ts`, `translation-status.json`. Run the i18n generator, which produces the generated files.
- Tests: `packages/core/src/case-watch/case-watch.test.ts` (a Karnataka-district watch refreshes through a stubbed delegated fetcher, asserting `delegatedFor` and the stored provenance); `packages/db/src/__tests__/source-registry.test.ts` (rows seeded uncleared).
- Enumerating tests touched: `apps/web/__tests__/case-watch-actions.test.ts:29` mocks `STATUS_SOURCES` as a literal and lists the core export names. No new core export is added, so it should need no change. Run it to confirm. `packages/i18n/src/__tests__/catalog.test.ts` checks locale parity.

### Sibling Sweep
`STATUS_SOURCES` entries for the HCs (`madras-hc`, `karnataka-hc`) have the same missing-row situation; leave them. Anything that enumerates the source table: `source-registry.test.ts`, which checks court rows are uncleared and covered by `access_mode_registry` (`:40-46`). The new rows must satisfy that check.

### History
Case-watch lookup was introduced by #591 (PR #612). The Chennai-only registry dates from #483. #634 added the template parsers, #635 the forum importer.

### Recommendation
1. Add the five state entries. State ids are an explicit choice: `in.<st>.district:case_status`, matching the `in.<st>.district` adapterId.
2. Add the per-host budget in `createFetcher`, default e.g. 30/min per host, injectable through `FetcherDeps`.
3. Seed the uncleared rows by migration.
4. Add the labels.
5. Test the end-to-end refresh with an injected fetcher and policy (no network).
Risk: the per-host budget changes the fetch behaviour of every source, so keep the default generous and covered by the existing fetcher tests. Medium confidence because the real status paths and base URLs per state need counsel review. Rows stay uncleared.

### Related Issues
#495 (parent), #634, #635, #640 (establishment data), #483/#591/#592 (watch, lookup, poll job).
