# 0001. Monorepo with pnpm workspaces and Turborepo

## Status

Accepted

## Date

2026-10-18

## Context

CauseDeck is built as one TypeScript product: a Next.js web and PWA app, a static marketing site, a Hono API, pg-boss workers, an admin console, and about seventeen shared packages. Many autonomous agents build it in parallel, each working on one issue, and every change must pass lint, typecheck, test and build. The spike fixes this in [§1 Stack decisions](../engineering/13-technical-architecture-spike.md#1-stack-decisions) (Monorepo row) and [§2 Repository layout](../engineering/13-technical-architecture-spike.md#2-repository-layout). It derives from D-036 in [DECISIONS.md](../../DECISIONS.md).

## Decision drivers

- Domain types, zod schemas and the design system are shared across every app.
- CI has to be fast and change-aware, because many small PRs land each day.
- One toolchain configuration, so that agents work the same way in every package.
- Package boundaries are enforced (apps import packages; packages never import apps).

## Considered options

| Option                              | Verdict  | Reason                                                                                                                          |
| ----------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------- |
| pnpm workspaces + Turborepo         | Chosen   | Strict, content-addressed installs with catalogs; task caching and `--filter=...[base]` affected runs with little configuration |
| Nx                                  | Rejected | It is capable, but it brings generators, a plugin layer and project graph conventions that the team does not need               |
| npm or Yarn workspaces + Lerna      | Rejected | No task caching of comparable quality, and hoisting hides undeclared dependencies                                               |
| Polyrepo (one repo per app/package) | Rejected | Cross-repo version bumps for every shared type change, which is slow for parallel agent work                                    |

## Decision

- The repository is a pnpm workspace (`apps/*`, `packages/*`, `e2e`). Shared dependency versions come from the pnpm catalog.
- Turborepo runs the `build`, `lint`, `typecheck` and `test` pipelines with local cache and an optional remote cache. CI runs only the packages affected since the base branch, plus their dependents.
- TypeScript is strict everywhere. Shared `tsconfig`, ESLint (flat config) and Prettier configuration live in `packages/config`.
- Dependency rules (spike §2) are enforced by `eslint-plugin-boundaries`: apps may import packages, packages never import apps, and `ui` depends on nothing domain-specific.

## Consequences

- Positive: one install and one lockfile. Atomic cross-package changes. Cached and filtered CI.
- Positive: agents find every package in a predictable layout.
- Negative: one large repository, so CI must stay change-aware to stay fast.
- Negative: Turborepo and pnpm become critical tooling that has to be kept up to date (Dependabot groups the catalog).

## Revisit when

- Several teams own separate deployables and need independent release cadences (spike §3.2 Stage C: > 10k seats or several teams).
- CI time on affected runs consistently exceeds the 15-minute job timeout despite caching.

## Links

- [Spike §1](../engineering/13-technical-architecture-spike.md#1-stack-decisions), [§2](../engineering/13-technical-architecture-spike.md#2-repository-layout)
- [CI](../engineering/ci.md)
- [DECISIONS.md](../../DECISIONS.md) D-036
