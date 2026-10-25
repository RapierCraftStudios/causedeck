**Verdict**: CONFIRMED
**Confidence**: medium
**Severity**: medium (greenfield feature; no live defect)
**Task Type**: feature

### What Was Claimed
Build the one-screen hearing outcome confirmation (PRD EX-3): from the voice-note/manual proposals the lawyer confirms what happened, next date (L2, never auto-applied, conflict card on disagreement), stage, obligations and tasks. Depends on #543 (merged) and #58 (closed `ci.red`, but the service is on base). Note: the earlier FORGE comments on the issue (WhatsApp link card) belong to a different issue and are ignored; `.forge-lean/*` files from it were removed.

### What We Found
Verified on base `origin/milestone/prepare-execute` (c18c312d):
- No implementation: `packages/core/src/hearings`, `apps/web/app/(app)/w/[slug]/hearings`, `packages/validators/src/hearing-outcome.ts`, and `outcome` i18n namespace do not exist.
- Tables exist, so no migration: `hearing` (`packages/db/src/schema/docket.ts:105`: `outcome`, `adjournmentReason`, `nextDateProposed`, `nextDateConfirmed`, `stageAfterRaw`, provenance), `obligation` (`:234`, closure check `:~300` needs reason type and note for not_applicable), `task` (`:312`), `proposal` (`packages/db/src/schema/automation.ts:49`, no hearing id; linked by `proceedingId`, `captureId`, payload `hearingDate`).
- Voice job stages drafts `hearing_outcome`, `next_date`, `obligation_from_direction` (only if dated), `task` with anchors (`packages/intelligence/src/structure/to-proposals.ts:44-120`; `core/src/voice/run.ts`). The `hearing_outcome` handler is disabled (`core/src/automation/handlers/disabled.ts:23-26`), so nothing writes `hearing` from proposals today. Only `core/src/import/apply.ts:558` inserts hearings.
- Canonical next date services: `proposeNextDate` (`core/src/matter-graph/next-date.ts:134`), `confirmNextDate` (`:223`), `chooseNextDateSource` (`:303`, logs choice via conflict card), `getCanonicalNextDate` (`:407`); only that module may write `listing.list_date/canonical` (architecture test `no-direct-listing-update`). `core/src/court-day/next-date.ts` wraps them via the matter-graph index.
- Transcript storage helpers: `core/src/voice/transcript.ts` (`StoredTranscript`, `anchorValues`); `voice` is not re-exported from the root.
- Web pattern: `apps/web/app/(app)/w/[slug]/matters/actions.ts` (`workspaceAction`, `WorkspaceScoped`, `graphDeps`); i18n messages live in `packages/i18n/src/messages/<locale>/*.json` (issue's `packages/i18n/messages` path is wrong). UI patterns in `packages/ui/src/patterns/*` (proposal-card, provenance-chip, stage-badge, obligation-row, states).
- Validators subpath exports are listed in `packages/validators/package.json:8-17` (needs `./hearing-outcome`); core subpath exports in `packages/core/package.json`.

### Root Cause
Missing feature: voice (#542/#543) stages proposals and #58 provides the canonical next-date service, but no screen or service turns them into a confirmed hearing outcome.

### Affected Files
See contract deliverables D1-D14: validators, `core/src/hearings/*`, package.json exports, domain registries, web outcome route and actions, i18n namespace (3 locales), UI stories, e2e specs.

### Sibling Sweep
Other actions modules and core exports must be registered in `apps/web/__tests__/cross-tenant-actions.test.ts` and `packages/db/src/testing/cross-tenant-registry.ts`; `CORE_DOMAIN_DEPENDENCIES` + `docs/engineering/core-domains.md` need a `hearings` row. Obligation insertion pattern: `core/src/automation/handlers/obligation-from-direction.ts` (open, with provenance).

### History
Hearing/obligation/task tables added with the docket schema; voice job in 137ef577/81ad8f0f (#542). No earlier attempt at this screen. #58 closed ci.red/needs-human but its services are present on base.

### Recommendation
One lane, ordered: validators, core service (single tx, uses matter-graph index for dates, `record` for audit), cross-tenant tests, action, page/components, i18n, stories, e2e. Next-date validator rejects dates absent from anchored sources unless flagged manual. Risks: no hearing-to-proposal link (resolve by proceeding + heldOn + payload hearingDate); p95, visual baselines and e2e run only in CI.

### Related Issues
#1 (parent), #51/#543 (voice), #58 (next date), #49 (undo feed), #67, #69, #86 (consumers of `hearing.outcome_confirmed`).
