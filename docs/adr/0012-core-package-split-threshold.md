# 0012. Split @causedeck/core into domain packages at a threshold

## Status

Proposed

## Date

2026-10-20

## Context

`@causedeck/core` holds every domain service: workspaces, audit, billing, usage, jobs and matters today, and the court and practice domains (matter graph, court-day, briefs, limitation, obligations, delegation, enquiries, client contacts, outward updates) from the later milestones of the [technical architecture spike](../engineering/13-technical-architecture-spike.md). One package keeps refactors cheap, but a single package with free cross-folder imports turns into a tangle. Issue #293 makes the domains explicit: each folder under `packages/core/src/` exposes an `index.ts`, other domains import it only through that file, and the allowed edges live in `packages/config/eslint/core-domains.js`, enforced by `causedeck/core-domain-boundaries` and documented in [core domains](../engineering/core-domains.md). Today core has about 7k lines of non-test source in six domains plus `shared/`.

## Decision drivers

- Keep refactors across domains cheap while the platform layer is still changing.
- Stop the court and practice domains from growing hidden edges that make a later split expensive.
- Split before package boundaries would cost more than they save: when build, test and review scope suffer from one package.
- The rule must be checkable by a machine, not only by review.

## Considered options

| Option                                                            | Verdict  | Reason                                                                                                      |
| ----------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------- |
| One package with lint-enforced domains, split at a threshold      | Chosen   | Cheap refactors now; the map keeps the domains separable, so the split is a mechanical move later           |
| Split into `core-court`, `core-practice` and `core` now           | Rejected | Neither cluster exists yet; package plumbing (exports, tsconfig, turbo) for empty packages is pure overhead |
| Never split; rely on folders only, without lint or a declared map | Rejected | Nothing stops deep and circular imports, so a later split becomes an untangling project                     |

## Decision

- `@causedeck/core` stays one package, with lint-enforced domains, through the Platform & Tenancy milestone.
- Re-evaluate, and split unless the review finds a reason not to, before the Court Layer & Matter Graph milestone starts.
- Split earlier if any of these holds: core exceeds about 25k lines of non-test source; it has more than about 12 domains; or the court cluster (matter graph, court-day, briefs, limitation) and the practice cluster (obligations, delegation, enquiries, client contacts, outward updates) have no edges between them in `CORE_DOMAIN_DEPENDENCIES`.
- The candidate packages are `core-court` and `core-practice`. `workspaces`, `audit`, `billing`, `usage`, `jobs` and `shared` stay in `core`, which both new packages may depend on.
- Until then every new domain gets a folder, an `index.ts`, a map entry, a package.json export and a row in [core domains](../engineering/core-domains.md).

## Consequences

- Positive: domain edges are explicit and acyclic, so a split moves folders and rewrites `../<domain>/index.ts` imports to package names.
- Positive: the split threshold is observable (line count, domain count, map edges), not a judgement call.
- Negative: one package's typecheck and test scope keeps growing until the split.
- Negative: adding a cross-domain edge needs a map change that a reviewer must accept.

## Revisit when

- The Court Layer & Matter Graph milestone is about to start.
- Non-test source under `packages/core/src` exceeds about 25k lines.
- `CORE_DOMAIN_DEPENDENCIES` lists more than about 12 domains.
- The court and practice clusters have no edges between them in the map.

## Links

- [Technical architecture spike](../engineering/13-technical-architecture-spike.md)
- [Core domains](../engineering/core-domains.md)
- Issues: #293 (core domain boundaries)
