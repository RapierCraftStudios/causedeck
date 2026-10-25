**Verdict**: CONFIRMED
**Confidence**: high
**Severity**: medium (greenfield feature; the central follow-up model is missing and #68/#70/#60 depend on it)
**Task Type**: feature

### What Was Claimed
Build the obligation service in `packages/core` (#67): obligation create/update/close/reopen with reasoned closure, `reconcileOrder`, registry defects and `representFiling`, certified copies, `queryQueue`, due-date helpers, reminders job, validators, tables and ADR. Stale `.forge-lean/*` files in the tree belonged to the WhatsApp issue and were overwritten.

### What We Found
Verified on `origin/milestone/follow-up-continuity-memory` (216c5d7b, = HEAD).
- No `packages/core/src/obligations/`, no `packages/validators/src/obligation.ts`, no `obligation-reminders` job, no `obligation_event`/`defect`/`certified_copy` tables.
- `obligation` table already exists (#33 era): `packages/db/src/schema/docket.ts:234-300`. It has `source` (enum `OBLIGATION_SOURCES` = the issue's `kind` values, `enums.ts:66-75`), `description`, `dueDate`, `basis`, `ownerMemberId`, `status` (`open|done|not_applicable|superseded`, `enums.ts:77`), `closedReasonType` (`task_completed|lawyer_action|not_applicable`, `docket.ts:227`), `closedBy/At/Note`, `sourceOrderId`, provenance columns (source_type, source_ref, anchor_id, confidence, confirmation_state) and `obligation_closure_chk` (`docket.ts:292-297`). So the DB closure check already exists; names differ from the issue (`done` vs `closed`, `task_completed` vs `completed_task`, `source` vs `kind`, `closedReasonType` vs `closed_reason`). Renaming would break timeline (`core/matter-graph/timeline.ts`), merge-split and tests.
- Order directions are a jsonb array `order.operativeDirections: {text, anchorId}[]` (`docket.ts:175-191`); there is no per-direction id, so reconciliation links by `obligation.sourceOrderId` + `anchor_id`.
- Proceeding state machine exists (`core/matter-graph/state-machine.ts:36-45`): `filed->sr_fr->defects->re_presented->numbered`; `transitionProceeding` is the only writer of `proceeding.state`; `proceeding.srNo/frNo` exist (`proceedings.ts:~58-59`); `proceeding_state_change.cure_deadline` is set only for `to_state='defects'` (`proceedings.ts:221`); `ProceedingStateChangedEvent.cureDeadline` is documented as the hook for #67 (`matter-graph/events.ts:112-125`).
- L2/L3 proposal handler exists: `core/automation/handlers/obligation-from-direction.ts:25` (inserts an obligation `open`, records undo payload); undo contract in `automation/undo.ts`.
- Service conventions: `matter-graph/context.ts` (`inGraphScope`, `parseInput`, `can()`, event buffer), `shared/errors.ts`, `shared/membership.ts`; policy actions `packages/auth/src/policy/actions.ts:12` have only `task.read/write` (no obligation actions; matrix in `policy/matrix.ts:27`, snapshot in `policy/__tests__/__snapshots__/can.test.ts.snap`).
- Jobs: `core/jobs/definitions/*.ts` (+ `activity-digest.ts` as model for a per-workspace daily job in `Asia/Kolkata`), registered via `core/jobs/registry.ts`, schedules in `apps/worker/src/schedules.ts`, guarded by `apps/worker/src/__tests__/{registry,schedules}.test.ts`. `apps/worker/src/jobs/` does not exist; the issue's path is outdated.
- Migrations are timestamp-named, latest `20261025040000_whatsapp_inbound.sql` in `packages/db/migrations`; seeds live in `packages/db/src/seed/` (not `seeds/`).
- Core domains: `packages/config/eslint/core-domains.js` `CORE_DOMAIN_DEPENDENCIES` (e.g. `:26`, `:29`) and `docs/engineering/core-domains.md` must gain an `obligations` domain. Latest ADR is 0036 (`docs/adr/`).
- `apps/web/app/(app)/w/[slug]/obligations/page.tsx` is a placeholder; the queue UI is #68 (out of scope).

### Root Cause
Greenfield: the schema holds a bare `obligation` row and a handler that inserts one, but no service enforces lifecycle, reasons, events, defects, copies, queue or reminders.

### Affected Files
`packages/validators/src/obligation.ts` (+ package.json export if subpaths are listed); `packages/db/src/schema/docket.ts` or new `schema/obligation-tracking.ts` and `schema/index.ts`; new migration + snapshot in `packages/db/migrations`; `packages/core/src/obligations/*` and `core/package.json` export; `packages/core/src/jobs/definitions/obligation-reminders.ts` + registry; `apps/worker/src/schedules.ts`; `packages/auth/src/policy/{actions,matrix}.ts` + snapshot; `packages/db/src/seed/obligation-fixtures.ts`; registries (cross-tenant registry, db index test, RLS catalog, worker tests, core-domains); ADR.

### Sibling Sweep
Other writers of `obligation` rows: `automation/handlers/obligation-from-direction.ts` (insert; must stay compatible and route through the service guard or keep its direct insert), `matter-graph/merge-split.ts:351,466,583` (moves rows; must not break the new tables' matter linkage), `matter-graph/timeline.ts` (reads closed reasons). Any new `obligation` write path must go through `closeObligation`; a no-direct-update guard test like `matter-graph/__tests__/no-direct-listing-update.test.ts` is the precedent.

### History
`obligation` introduced with the docket tables (`0041_docket.sql`, #345-#347 series); proceeding state machine #363 emits the cure-deadline hook; #47 added the proposal handler. No prior attempt at #67 (#33 closed not_planned, #46 completed).

### Recommendation
One lane, ordered checklist: (1) validators; (2) schema + migration + RLS/registries for `obligation_event`, `defect`, `certified_copy` and any added `obligation` columns (`kind` stays `source`; add only genuinely missing columns such as `confidence` already present); (3) policy actions `obligation.read/write` (+ clerk rules); (4) `due.ts`, `create/update/close/reopen`; (5) `reconcile`; (6) defects (call `transitionProceeding`, never write state directly) and certified copies; (7) `queryQueue`; (8) reminders job + schedule; (9) tests, seed, registries, ADR. Keep existing enum names and document the mapping to the issue's terms in the ADR. Strategy-note hiding from clerks has no strategy column yet: defer.

### Related Issues
#1 (parent), #33, #46 (deps), #47 (proposals/undo), #60 (readiness), #23 (notifications), #34 (court-day calendars), #68, #69, #70, #84.
