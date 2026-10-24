**Verdict**: CONFIRMED
**Confidence**: medium
**Severity**: medium (greenfield onboarding feature; GTM adoption milestone)
**Task Type**: feature

(Note: the pre-existing `.forge-lean/*` and the FORGE:INVESTIGATION comment on the issue described a different issue, the portfolio UI. They were stale and are replaced. This report was verified against `origin/milestone/instant-gtm-adoption` at ab7623e4.)

### What Was Claimed
Zero-entry onboarding: from an advocate's name, enrolment number/BRN and courts, run delegated advocate searches (Madras HC, KHC list by name/BRN, eCourts advocate search) over the last 30-90 days plus upcoming lists, build proposed matters and proceedings, show live progress, go through the one confirm grid, then the court-day view. Name disambiguation, instrumentation, and three acceptance criteria (e2e under 10 min, nothing saved before confirm with provenance, ambiguous names prompt).

### What We Found
- `packages/core/src/onboarding/` does not exist; no `discover.ts` anywhere (`ls packages/core/src`).
- The pieces it composes exist: governed fetcher `packages/fetch/src/fetcher.ts` (`delegatedFor` option, `types.ts:58-64`); KHC list watch `packages/core/src/court/list-watch.ts:68-259` (name/BRN watches, matched-only rule, proposals via `submitProposals`); delegated case-status lookups `packages/core/src/case-watch/lookup.ts:41-51` (`STATUS_SOURCES`; case-number lookup, not advocate search); identifiers `packages/core/src/import/identifiers.ts:39-62` (`getAdvocateIdentifiers`, `createAdvocateMatcher`: exact match only, never substring); profile `import/profile.ts:32-60`.
- Plan/confirm pipeline already exists: `import/bootstrap.ts:164` (`buildPlanFromDrafts`, matched-only filter), `:317` (`buildImportPlan`), `import/apply.ts:122` (`applyImportPlan`, nothing written to the graph until apply), `import/plan-edit.ts` (merge/split edits). Web: `apps/web/app/(app)/w/[slug]/import/{page,actions}.ts*` (actions at actions.ts:260-288) and `apps/web/components/import/{identifiers-form,processing-view,confirm-grid}.tsx`.
- No source registry rows for advocate search: the only seeded sources are `case_status`, `cause_list`, `display_board` ids (migrations `0067`, `0052`, db migrations dir; latest is `20261024182641_activation_event.sql`). `policyFor` fails closed on unknown sources, so advocate-search sources must be added (uncleared) before any fetch.
- No adapter parses an advocate-search result page (`packages/adapters/src/madras-hc/advocates.ts` only normalises advocate names; `ecourts/cause-list.ts` parses cause lists with an Advocate column).
- Instrumentation partly exists: `ACTIVATION_STEPS` already has `identifiers_entered`, `discovery_found`, `confirm_grid_done`, `first_court_day_view` (`packages/db/src/schema/activation.ts:25-36`), `recordActivation` (`core/src/activation/record.ts:24`), `timeToFirstCourtDay` (`activation/funnel.ts:87`). Only `workspace_created` is recorded today (`apps/web/app/(app)/onboarding/actions.ts:30-37`). Nothing records matters discovered vs confirmed.
- `/onboarding` (`apps/web/app/(app)/onboarding/`) only creates a workspace.
- Dependencies #479/#482 are closed and merged; #483/#495 closed not_planned but their code (case-watch, ecourts adapter) is present, so no block.

### Root Cause
Greenfield. Data layers landed, but nothing orchestrates identifiers -> delegated searches -> proposals -> confirm grid, and advocate-search sources/parsers are absent.

### Affected Files
- New `packages/core/src/onboarding/{discover.ts,index.ts}`, `packages/core/package.json` subpath if domains need it, `packages/config/eslint/core-domains.js` + `docs/engineering/core-domains.md`, `packages/core/src/domains.test.ts` expectations.
- New migration seeding uncleared advocate-search source rows (following the timestamp naming of the newest migration).
- `packages/db/src/testing/cross-tenant-registry.ts` + `packages/core/src/__tests__/cross-tenant/services.test.ts` for new runtime exports.
- `apps/web/app/(app)/w/[slug]/onboarding/*` (new route) with actions; `apps/web/__tests__/cross-tenant-actions.test.ts`; i18n namespace + `packages/i18n/src/__tests__/catalog.test.ts`.
- Possibly a small adapters parser for advocate-search results.

### Sibling Sweep
Every new core export and `'use server'` action needs registry entries (CLAUDE.md table). Matched-only/never-substring rule (`identifiers.ts:56`) must hold for discovery too, as in `list-watch.ts`. The `import` actions already enforce "nothing saved before apply"; reuse them rather than writing matters directly.

### History
Parent chain: #479 fetch layer, #482 KHC watch, #483 case-status watch, #495 eCourts adapter. Activation funnel steps added in the activation_event migration (#509). No earlier attempt at discovery.

### Recommendation
Keep one lane, build on injected ports so everything is testable offline with the mock fetch provider:
1. `discoverAdvocateCases(deps, input)` in `core/onboarding/discover.ts`: takes identifiers + courts + window (30-90 days) + a `DiscoverySource` port per court (fetch through governed fetcher with `delegatedFor`, parse in memory), emits `ProposalDraft`s via automation/import (staged only; nothing in the matter graph), reports progress counts ("found N listings in M courts") and name-ambiguity candidates.
2. Disambiguation: a name-only identifier returns `needsDisambiguation` with sample matters/distinct enrolment numbers; no proposals are staged until the caller confirms an enrolment/BRN or a sample selection.
3. Seed uncleared advocate-search sources; skip fetching uncleared/killed sources (reported as skipped courts).
4. Web onboarding steps: identifiers -> courts -> progress -> existing confirm grid (reuse import actions) -> court-day view; record the four activation steps and log discovered vs confirmed counts.
5. Persistent discovered-vs-confirmed metric display on the admin growth page is a follow-up.

### Related Issues
#479, #482, #483, #495, #57 (bootstrap import), #509 (activation funnel).
