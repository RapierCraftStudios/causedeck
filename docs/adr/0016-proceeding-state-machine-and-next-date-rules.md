# 0016. Proceeding state machine and canonical next-date rules

## Status

Proposed

## Date

2026-10-21

## Context

The matter-graph services (#33, split into #362-#366) are the only writers of the graph tables. Two rules there are easy to break by accident: how a proceeding moves between states (#363), and how a proceeding's next date changes (#364). The schema from [ADR 0013](0013-matter-graph-schema.md) allows one canonical listing per proceeding (`listing_one_canonical_uq`, unique `(workspace_id, proceeding_id) WHERE canonical`). That listing is the next date the lawyer acts on. Dates arrive from many sources (manual entry, cause lists, documents, AI), and they can disagree. The [technical architecture spike](../engineering/13-technical-architecture-spike.md) §5 and the zero-entry automation design §4.2 and §5 require that a person decide between conflicting sources, and that the services never pick one silently.

## Decision drivers

- A canonical next date must never change without a member confirming it.
- When two sources give different dates, both stay visible: the conflict card is the only place they meet.
- The swap must respect the immediate partial unique index and never leave a proceeding with two canonical listings.
- The rule must be machine-checked, so a later module cannot write `listing.list_date` around it.

## Considered options

| Option                                                                       | Verdict  | Reason                                                                                                                                                   |
| ---------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One service module (`next-date.ts`) plus a source-scanning architecture test | Chosen   | It runs in every test run, catches Drizzle and raw SQL, and follows the judge-aggregation and access-mode guards                                         |
| An ESLint rule in `packages/config/eslint/rules/`                            | Rejected | It needs plugin wiring and fixtures, misses raw SQL in template strings unless it re-parses them, and is only linted in CI (locally, changed files only) |
| A database trigger refusing canonical `list_date` updates                    | Rejected | The application role must still swap the flag, so the trigger could not tell a confirmed swap from a direct write without session flags the services set |

## Decision

### Proceeding state machine

Recorded by #363.

### Next-date rules

- `proposeNextDate(deps, actor, {proceedingId, date, provenance})` (packages/core/src/matter-graph/next-date.ts) needs `matter.write` and never changes the canonical listing:
  - with no canonical listing it stores a non-canonical `proposed` listing and returns `{kind: 'proposal', listingId}`; proposing the same date again returns the earlier proposal;
  - with a canonical listing of the same date it returns `{kind: 'noop'}` and writes nothing;
  - with a canonical listing of another date (whatever its confirmation state) it stores the proposed side as its own non-canonical listing and returns `{kind: 'conflict', current, proposed}`. The services never choose between them.
- `confirmNextDate(deps, actor, {listingId, allowPast?})` is the only path that makes a listing canonical. It needs a member with `matter.write`; the role comes from the membership row. It refuses a date before today in Asia/Kolkata unless `allowPast: true` is passed explicitly. In one transaction it locks and clears the old canonical row, which stays as history with `canonical = false`, and then sets `canonical = true, confirmation_state = 'confirmed'` on the target. A concurrent swap that hits the index is `CONFLICT`.
- `getCanonicalNextDate` reads the canonical listing with `matter.read`.
- Events: `listing.next_date_proposed`, `listing.next_date_conflict` and `listing.next_date_confirmed` (with `previousListingId`). Each carries the matter's `sensitive` flag.
- `no-direct-listing-update` (packages/core/src/matter-graph/**tests**/no-direct-listing-update.test.ts) fails the build if any packages/core module other than `next-date.ts` updates `listDate`/`canonical`, inserts a listing with `canonical`, or runs raw SQL updating `list_date`/`canonical`. Deleting listing rows (the lifecycle erase) stays allowed.

## Consequences

- Positive: a next date changes only through a recorded confirmation, conflicts stay visible, and the history of earlier next dates is kept.
- Negative: every proposal adds a listing row, and future writers of listing details (court-day, #58) must keep away from `list_date` and `canonical` or go through `next-date.ts`.

## Revisit when

- A writer outside packages/core (an adapter or a worker job) needs to write listings directly; the guard then has to cover that package.
- Undo storage for confirmations (#47) needs the swap to return an `UndoPayload`.

## Links

- [ADR 0013: Matter-graph schema](0013-matter-graph-schema.md)
- [Technical architecture spike](../engineering/13-technical-architecture-spike.md)
