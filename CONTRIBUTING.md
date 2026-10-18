# Contributing to CauseDeck

Setup, scripts and the repository layout are in the [README](README.md#development).

## Branches

- Each milestone has a long-lived branch named `milestone/<slug>` (for example `milestone/foundation`;
  see spike §11 for the list). Milestones ship to `staging`, then `main`.
- Work on a short-lived branch cut from the milestone branch (for example `feat/issue-2-monorepo`) and
  open the pull request against that milestone branch.

## Commit messages

Commits follow [Conventional Commits](https://www.conventionalcommits.org/). The `commit-msg` hook
runs commitlint (`@commitlint/config-conventional`) and rejects anything else.

```text
feat(repo): scaffold pnpm workspace     ✔
fix(core): handle empty hearing list    ✔
fixed stuff                             ✘
```

Types: `feat`, `fix`, `docs`, `chore`, `refactor`, `perf`, `test`, `build`, `ci`, `style`, `revert`.
Use the workspace or area as the scope (`web`, `core`, `db`, `repo`, ...).

## Pre-commit checks

The `pre-commit` hook runs `prettier --check` and `eslint` on staged files. Fix problems with
`pnpm format` and `pnpm lint`; do not bypass the hooks.

## Architecture rules

ESLint enforces the dependency rules from spike §2 (`packages/config/eslint/boundaries.js`):

- Apps may import packages. Packages never import apps.
- `core` may depend on `db`, `auth`, `flags`, `storage`, `ai`, `adapters`, `intelligence`, `drafting`,
  `notifications`, `billing` and `validators`.
- `ui` depends on nothing domain-specific (only `config` and `validators`).
- Import workspaces by name (`@causedeck/<pkg>`), never through `src/` deep paths.

## Quality bars (spike §10, apply to every issue)

- TypeScript strict; no `any` in exported APIs.
- Unit, integration and e2e coverage for every acceptance criterion.
- Cross-tenant suite green.
- Lighthouse budgets.
- Bundle budget: initial JS ≤ 180 KB gzip on the court-day route.
- p95 server action < 300 ms on seeded data.
- i18n keys present in `en`, with `ta`/`kn` keys at least stubbed, then translated in the i18n issue.
- Docs: an ADR for each new architectural decision, plus updated Storybook.
