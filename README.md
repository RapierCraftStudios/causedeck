# CauseDeck — Research, Product & MVP Package

*Working title (D-035). Earlier documents call the product "Lawyer OS".*

A low-cost, bootstrapped legal operating system for Gen Z lawyers in India.
This repository holds the research and decision documents (written in Markdown so they can be reviewed in diffs) and the CauseDeck monorepo scaffold. Product code arrives issue by issue; see [Development](#development).

> Status (2026-10-17): package **v0.3**. Lawyer OS is an intelligent operating layer for Indian litigation practice, delivered as an India-hosted SaaS. The MVP is a vertical slice for the Madras HC and Bengaluru. Nothing here is legal advice. Items marked **⚖ Needs Indian legal review** must be checked by a qualified Indian advocate before we act on them.

## How to read this repo

| # | Deliverable | File |
|---|---|---|
| 0 | Executive summary (start here) | [docs/00-executive-summary.md](docs/00-executive-summary.md) |
| 1 | Research report (sources, confidence, unknowns) | [docs/strategy/01-research-report.md](docs/strategy/01-research-report.md) |
| 2 | Product thesis & segmentation | [docs/strategy/02-product-thesis-and-segmentation.md](docs/strategy/02-product-thesis-and-segmentation.md) |
| 3 | PRD | [docs/product/03-prd.md](docs/product/03-prd.md) |
| 4 | MVP definition, build-vs-buy, costs, roadmap | [docs/mvp/04-mvp-definition.md](docs/mvp/04-mvp-definition.md) |
| 5 | Competitor matrix & AI opportunity matrix | [docs/strategy/05-competitor-and-ai-matrices.md](docs/strategy/05-competitor-and-ai-matrices.md) |
| 6 | Risk register | [docs/risk/06-risk-register.md](docs/risk/06-risk-register.md) |
| 7 | Validation plan | [docs/validation/07-validation-plan.md](docs/validation/07-validation-plan.md) |
| 8 | Repo structure & implementation backlog | [docs/engineering/08-repo-structure-and-backlog.md](docs/engineering/08-repo-structure-and-backlog.md) |
| 9 | Capture & automation subsystem (ladder, approvals, recovery, audit, offline, privacy, cost) | [docs/product/09-zero-entry-automation-design.md](docs/product/09-zero-entry-automation-design.md) |
| 10 | System architecture: north star, matter graph, memory, court adapters, SaaS platform | [docs/product/10-lawyer-os-system-architecture.md](docs/product/10-lawyer-os-system-architecture.md) |
| 11 | Launch markets: Madras HC & Bengaluru | [docs/strategy/11-launch-markets-madras-hc-bengaluru.md](docs/strategy/11-launch-markets-madras-hc-bengaluru.md) |
| 12 | Naming | [docs/strategy/12-naming.md](docs/strategy/12-naming.md) |
| — | Decision log | [DECISIONS.md](DECISIONS.md) |
| — | Assumptions register (kept apart from verified facts) | [ASSUMPTIONS.md](ASSUMPTIONS.md) |
| — | Raw research notes with citations | [research/raw/](research/raw/) |

## Evidence conventions
- `[VERIFIED]`: taken from a primary or official source, with the URL cited.
- `[REPORTED]`: taken from press, secondary sources, reviews or forums.
- `[INFERENCE]`: our own reasoning. Treat it as a hypothesis.
- `[FOUNDER-REPORTED]` / `[FR]`: findings supplied by the founder. The underlying data is not yet in the repo ([research/raw/07](research/raw/07-founder-reported-findings-2026-10-17.md)).
- All web sources were accessed on **2026-10-17** unless a note says otherwise.

## Development

The product is a pnpm + Turborepo monorepo, specified by the [technical architecture spike](docs/engineering/13-technical-architecture-spike.md) (§1, §2, §10). Contribution rules are in [CONTRIBUTING.md](CONTRIBUTING.md).

### Prerequisites
- **Node.js 22 LTS** (`.nvmrc`; `nvm use` picks it up).
- **pnpm 10** (pinned in `package.json` `packageManager`; `corepack enable` installs it).
- **Docker** with Compose v2, for the local services (`pnpm run doctor` checks all of these).
- Git. `pnpm install` installs the Lefthook git hooks through the `prepare` script.

### Getting started
```sh
pnpm i          # install all workspaces (uses the committed pnpm-lock.yaml)
pnpm typecheck  # check that everything builds
pnpm run doctor # check prerequisites and free ports (plain `pnpm doctor` is a pnpm built-in)
pnpm dev        # start Postgres, MinIO and Mailpit, then the app dev servers
```

### Root scripts
| Script | What it does |
|---|---|
| `pnpm dev` | `pnpm stack:up`, then starts every workspace that defines a `dev` script (Turborepo, persistent, not cached). Until one exists it prints a message and exits cleanly. |
| `pnpm stack:up` | Starts the local Docker stack (Postgres 17 + pgvector, MinIO, Mailpit) from `infra/docker/compose.dev.yml`, waits until every service is healthy, creates the `causedeck-dev` bucket and prints the URLs. See [infra/docker/README.md](infra/docker/README.md). |
| `pnpm stack:down` | Stops the stack and keeps its data volumes. |
| `pnpm stack:reset` | Deletes the stack's volumes after typing `yes` (or `--yes`); `pnpm stack:up` then recreates everything. |
| `pnpm run doctor` | (`run` is required; `pnpm doctor` is pnpm's own built-in.) Checks Node 22, pnpm 10, the Docker daemon and that ports 5432/9000/9001/1025/8025 are free, with a fix for each failure. |
| `pnpm build` | `turbo run build`: builds the apps. Packages are just-in-time (their `exports` point at `src/*.ts`), so they have no build step. |
| `pnpm lint` | `turbo run lint`: ESLint 9 flat config with type-checked rules and dependency-boundary rules. |
| `pnpm typecheck` | `turbo run typecheck`: `tsc --noEmit` in every workspace. |
| `pnpm test` | `turbo run test`: Vitest in every workspace (`vitest.workspace.ts` also lets `pnpm exec vitest` run all of them from the root). |
| `pnpm format` | Prettier writes formatting fixes across the repo. |
| `pnpm format:check` | Prettier checks formatting without writing (used by CI). |
| `pnpm audit:prod` | `pnpm audit --prod --audit-level high`: fails on high or critical advisories in production dependencies. |
| `pnpm prepare` | `lefthook install`: installs the pre-commit (Prettier + ESLint on staged files) and commit-msg (commitlint) hooks. Runs automatically on install. |

Run any task for one workspace with a filter, for example `pnpm --filter @causedeck/core test`.

### Layout
Matches spike §2. Every workspace is named `@causedeck/<dir>`. CI workflows and `infra/scripts/` are described in [docs/engineering/ci.md](docs/engineering/ci.md); the local Docker stack is in [infra/docker/](infra/docker/README.md); the rest of `infra/` and real app code arrive in later issues.

```
causedeck/
├── apps/
│   ├── web/          # Next.js product app (app.causedeck.*) — PWA, RSC, server actions
│   ├── site/         # Next.js static marketing site (Cloudflare Pages)
│   ├── api/          # Hono REST API (/v1), webhooks, OpenAPI docs
│   ├── worker/       # pg-boss workers: intelligence, notifications, imports, retention
│   └── admin/        # internal ops console (adapter health, support sessions, flags) — Next.js, staff-only
├── packages/
│   ├── ui/           # design system: tokens, shadcn components, patterns, Storybook
│   ├── db/           # Drizzle schema, migrations, RLS policies, seeds, test utils
│   ├── auth/         # Better Auth config, roles/permissions, session helpers
│   ├── core/         # domain services: workspaces, matter graph, obligations, briefs, memory, audit
│   ├── adapters/     # court-adapter framework + adapters (madras-hc, karnataka-hc, generic-a0, nclt-blr)
│   ├── intelligence/ # document intelligence pipelines (classify, OCR, extract w/ anchors, transcribe, structure)
│   ├── ai/           # AI gateway: providers, routing, budgets, India-only mode, audit
│   ├── capture/      # capture inbox ingestion: files, ICS, email, WhatsApp export parser
│   ├── drafting/     # templates, DOCX/PDF export, consistency checker, citation checker
│   ├── billing/      # plans, entitlements, Razorpay, GST invoices
│   ├── notifications/# email (React Email), web push, in-app, digests
│   ├── storage/      # S3 abstraction, envelope encryption, presign
│   ├── flags/        # feature flags + access-mode registry enforcement
│   ├── i18n/         # message catalogs en/ta/kn, formatters (dates, ₹)
│   ├── observability/# logger, OTel, Sentry wiring
│   ├── validators/   # shared zod schemas (API + forms)
│   └── config/       # eslint, tsconfig, prettier (tailwind preset and env schema arrive later)
├── infra/            # scripts/ (CI and dev-stack helpers), docker/ (compose.dev.yml); caddy, terraform, runbooks later
├── e2e/              # Playwright suites (product + site), visual baselines
├── .github/          # CODEOWNERS, PR template, workflows, setup action, Dependabot
├── docs/             # research, PRD, ADRs (docs/adr/)
└── turbo.json, pnpm-workspace.yaml, package.json
```

**Dependency rules** (spike §2, enforced by `eslint-plugin-boundaries` in `packages/config/eslint/boundaries.js`):
- Apps may import packages. Packages never import apps.
- `core` may depend on `db`, `auth`, `flags`, `storage`, `ai`, `adapters`, `intelligence`, `drafting`, `notifications`, `billing`, `validators` (and `config`).
- `ui` is domain-free: it may import only `config` and `validators`.
- Import other workspaces by name (`@causedeck/<pkg>`), never their `src/` files.
