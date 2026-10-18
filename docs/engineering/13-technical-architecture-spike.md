# 13 — Technical Architecture Spike: CauseDeck Full-Stack Monorepo

Version 1.0 · 2026-10-18 · Status: **Accepted for build** (D-036 to D-041) · Owner: engineering
Inputs:
- [PRD v0.3](../product/03-prd.md)
- [System architecture](../product/10-lawyer-os-system-architecture.md)
- [Capture subsystem](../product/09-zero-entry-automation-design.md)
- [Launch markets](../strategy/11-launch-markets-madras-hc-bengaluru.md)
- [Risks](../risk/06-risk-register.md)

This spike turns the product specification into a buildable architecture. It is the contract that every implementation issue references. If an issue conflicts with this document, this document wins until it is amended by an ADR.

> **Scope (founder direction, 2026-10-18).** Build the **full product**, not only the MVP slice: every PRD requirement tagged M, v1 and v2 is in scope. The exception is anything gated by ⚖ legal review or by human-provided credentials. Those are built **behind feature flags** and tracked as `needs-human` items.
>
> **Permanent exclusions** (PRD §2.3) remain out:
> - public solicitation or marketing of lawyers;
> - autonomous advice;
> - unverified or generated citations;
> - any L5 action;
> - unauthorised scraping;
> - judge analytics;
> - training on customer data.

---

## 1. Stack decisions

| Concern | Decision | Notes |
|---|---|---|
| Monorepo | **pnpm workspaces + Turborepo**, TypeScript strict everywhere | Shared `tsconfig`, ESLint (flat config), Prettier; `turbo` pipelines for build, lint, typecheck, test |
| Web app (product) | **Next.js (latest stable, App Router, React Server Components)** in `apps/web` | Server Actions for mutations from the UI; Route Handlers for webhooks and uploads. Node runtime (not edge) so data stays in the India region |
| UI | **Tailwind CSS v4 + shadcn/ui (Radix primitives) + lucide-react**, `motion` for animation, `next-themes` (light/dark), Sonner toasts, cmdk command palette, TanStack Table, Recharts via shadcn charts, react-hook-form + zod | The design system lives in `packages/ui` (shadcn "registry-style" components + tokens). Storybook documents it |
| Marketing site | **Next.js static export** in `apps/site`, deployed to **Cloudflare Pages** | No tenant data; content via MDX. Runs through the `/design` pipeline for a distinctive visual direction |
| API service | **Hono on Node** in `apps/api`, OpenAPI via `@hono/zod-openapi` | Public, versioned REST (`/v1`) for webhooks (Razorpay, email inbound), future mobile and integrations. The web app calls domain services directly (no HTTP hop) |
| Background jobs | **pg-boss** (Postgres-backed queue) in `apps/worker` | OCR, STT, extraction, briefs, notifications, digests, imports, exports, retention. No Redis at bootstrap |
| Database | **PostgreSQL 17 + pgvector**, **Drizzle ORM** + drizzle-kit migrations | **Row-level security** keyed by `app.workspace_id` set per transaction; see §4 |
| Auth | **Better Auth** (Drizzle adapter): **Google OAuth**, email magic link, passkeys; **organization plugin = workspaces** with roles; session cookies; 2FA for owners | Credentials come from human-provided env (needs-human) |
| Object storage | **S3-compatible abstraction**: MinIO on the VPS (bootstrap) → AWS S3 `ap-south-1` (scale) | Per-workspace key prefixes, presigned URLs, envelope encryption (§6). Cloudflare R2 is **not** used for tenant documents (jurisdiction) |
| AI | **AI gateway package** with provider adapters: **Amazon Bedrock India profile (Claude)**, **Sarvam** (STT, OCR, Indic), **mock provider** for dev and CI | India-only mode on by default; per-workspace budgets; audit of every call |
| Search | Postgres full-text (tsvector, `simple` + language configs) + pgvector for matter-scoped semantic retrieval | No external search engine at bootstrap |
| Email | React Email templates; transport via **Amazon SES (ap-south-1)** (needs-human); console transport in dev | Magic links, digests, notifications |
| Push | Web Push (VAPID) via the PWA service worker | Self-managed keys |
| Payments | **Razorpay** Subscriptions + UPI Autopay; GST invoices | Webhooks verified in `apps/api` |
| Offline / PWA | Next.js PWA: service worker (Serwist), **Web Share Target** (Android share-sheet capture), IndexedDB (Dexie) cache for the 7-day court-day view and briefs, outbox for captures | PowerSync is a later scale option; not in bootstrap |
| i18n | `next-intl`; locales **en, ta, kn** (UI strings), content language tags on documents and drafts | Tamil and Kannada fonts: Noto Sans Tamil / Noto Sans Kannada, plus Inter / Geist for Latin |
| Observability | OpenTelemetry SDK (traces + metrics), pino structured logs, Sentry (errors; needs-human DSN), `/healthz` and `/readyz` on every service | Logs retained ≥ 180 days in India (CERT-In) |
| Testing | Vitest (unit + integration with Testcontainers Postgres), Playwright (e2e + visual regression + axe a11y), Storybook interaction tests, Lighthouse CI | Every UI issue ships stories plus screenshots |
| Feature flags | DB-backed flags (`packages/flags`) per workspace, plus env kill-switches | ⚖-gated features ship dark |

## 2. Repository layout

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
│   └── config/       # eslint, tsconfig, tailwind preset, env schema (t3-env style)
├── infra/
│   ├── docker/       # Dockerfiles (web, api, worker, admin), compose.dev.yml, compose.prod.yml
│   ├── caddy/        # Caddyfile (TLS, routing, security headers)
│   ├── terraform/    # Cloudflare (DNS, Pages, WAF, cache rules), VPS (DigitalOcean BLR1 / Lightsail Mumbai)
│   ├── scripts/      # deploy, migrate, backup (wal-g), restore drills
│   └── runbooks/     # CERT-In 6h, DPDP breach, restore, key rotation, court-day freeze
├── e2e/              # Playwright suites (product + site), visual baselines
├── .github/workflows/# ci.yml, deploy-staging.yml, deploy-prod.yml, site.yml, security.yml
├── docs/             # (existing) research, PRD, ADRs (docs/adr/)
└── turbo.json, pnpm-workspace.yaml, package.json
```

**Dependency rules** (enforced by eslint-plugin-boundaries):
- Apps may import packages. Packages never import apps.
- `core` depends on `db`, `auth`, `flags`, `storage`, `ai`, `adapters`, `intelligence`, `drafting`, `notifications`, `billing`, `validators`.
- `ui` depends on nothing domain-specific.

## 3. Runtime topology

### 3.1 Bootstrap (Stage A: launch to about 1,000 paid seats)
```
                        Cloudflare (DNS, WAF, CDN for static)
   causedeck.<tld> ───► Cloudflare Pages (apps/site, static)          [no tenant data]
   app.<tld> / api.<tld> ─► (DNS-only by default; see §3.3) ─► VPS in India (DigitalOcean BLR1 or Lightsail ap-south-1)
                                        │  Caddy (TLS, HTTP/3, security headers, rate limits)
                                        ├── web (Next.js, Node) ×2 containers
                                        ├── api (Hono) ×1
                                        ├── worker (pg-boss) ×2
                                        ├── admin (staff-only, IP-allowlisted / Cloudflare Access)
                                        ├── postgres 17 + pgvector (volume; WAL-G → object storage)
                                        └── minio (S3) (volume; nightly replicate to second India location)
   staging: a second smaller VPS with the same compose stack; preview data only
```
- **Cost target:** about ₹6–12k per month of infrastructure for staging and prod combined, plus AI usage ([04 §13](../mvp/04-mvp-definition.md)).
- **Deploys:** GitHub Actions builds images and pushes them to GHCR. Then an SSH deploy runs `docker compose pull && migrate && up -d`, followed by health-gated rollout and automatic rollback.
- **Court-day change freeze:** deploys are blocked 18:00–23:00 and 07:00–10:30 IST (a workflow guard).

### 3.2 Scale path (designed in from day one)
| Stage | Trigger | Change |
|---|---|---|
| A: single VPS | Launch | As above |
| B: split state | p95 latency > 400 ms, DB CPU > 60%, or > 1k seats | Postgres → **AWS RDS (ap-south-1)** with PITR and a Hyderabad read replica; MinIO → **S3 ap-south-1**; 2+ app VPS behind a Cloudflare Load Balancer (or AWS ALB); workers on their own node |
| C: orchestrated | > 10k seats or several teams | Containers on **ECS Fargate (ap-south-1)** or k3s; autoscaled workers per queue; Redis (ElastiCache) for rate limits and cache; OpenSearch only if Postgres full-text search proves insufficient; PowerSync for richer offline |

**Day-one rules that keep the scale path open:**
- Stateless app containers.
- All state in Postgres and S3.
- 12-factor env configuration.
- Idempotent jobs.
- Migrations that are backward-compatible (expand → migrate → contract).
- No local disk writes outside volumes.
- Every service exposes health and readiness endpoints.

### 3.3 Cloudflare and data residency
- Marketing site: Cloudflare Pages, with full CDN.
- **App and API:** **DNS-only** by default, so TLS terminates on the India VPS (Caddy) and matter data never transits Cloudflare edges outside India.
- Static assets (`/_next/static`, fonts, images) are served from `static.<tld>`, proxied and cached through Cloudflare. They contain no tenant data.
- WAF and bot protection on the app go through Cloudflare **only** if the founder accepts the residency trade-off (D-037). Until then, Caddy rate limits and fail2ban provide protection.

## 4. Data architecture

### 4.1 Tenancy and RLS
- Every tenant table has `workspace_id uuid not null`.
- RLS policy: `workspace_id = current_setting('app.workspace_id')::uuid`. The `withWorkspace(tx, wsId)` helper in `packages/db` sets the GUC (`SET LOCAL`) at the start of every transaction.
- The app database role is **not** the owner, so RLS is enforced. Migrations run as the owner role.
- Role-based permissions (owner, advocate, junior, clerk, viewer) are enforced in `packages/core` policy functions. Clerk denials on strategy and memory are *also* enforced through column-scoped views.
- **Cross-tenant test suite** (CI-blocking) covers SQL, server actions, API, storage presign, vector search, and a user who belongs to two workspaces.

### 4.2 Core schema (Drizzle; superset of [10 §2](../product/10-lawyer-os-system-architecture.md#2-the-matter-graph))
**Identity and workspaces:**
- `user`, `session`, `account`, `verification`, `passkey` (Better Auth tables)
- `workspace`, `member` (role), `invitation`
- `workspace_settings`, `feature_flag`

**Court layer:**
- `forum` (court, establishment, seat, side, language profile, `adapter_id`)
- `court_hall`
- `bench`, `bench_roster` (effective-dated)
- `adapter_version`
- `access_mode_registry`

**Matter graph:**
- `matter`
- `proceeding` (case type, number, year, SR/FR/diary no., CNR, state machine, parent/connected/appeal links)
- `listing`
- `hearing`, `appearance`
- `order`
- `obligation`
- `task`

**People:**
- `person` (aliases)
- `organisation`
- `role_edge` (represents / appears_for / instructed_by / assigned_to / opposes)

**Documents:**
- `document` (kind, language, version chain, storage key, sha256, text status)
- `document_page`
- `anchor` (document/page/quote, transcript span, list row)

**Capture and automation:**
- `capture` (inbox item: channel, status, raw ref, TTL)
- `extraction`, `proposal` (L2), `activity` (L3 with undo payload)
- `outward_draft` (L4: drafted → edited diff → shared-by-lawyer log)

**Memory:**
- `memory_item` (M1–M7 scope, key, value, source anchor, status)
- `memory_embedding`

**Drafting:**
- `template`, `draft`, `draft_version`
- `authority` (citation string, resolution, status)

**Business:**
- `client_contact` (existing clients only)
- `fee_agreement`, `invoice`, `invoice_line`, `payment`, `client_ledger_entry` (v1, ⚖)
- `limitation_rule` (counsel-provided), `limitation_computation`

**Platform:**
- `subscription`, `entitlement`, `usage_counter`
- `notification`, `notification_pref`, `push_subscription`
- `ai_call` (audit), `audit_event` (security audit)
- `support_session`
- `export_job`, `deletion_job`

**Invariants** (enforced through DB constraints plus core-service tests):
- **Provenance on every fact:** `source_type`, `source_ref`, `anchor_id` or manual, `confidence`, `confirmation_state`.
- **One canonical next date per proceeding:** a partial unique index on `listing(proceeding_id) where canonical`.
- **Obligations close only with a reason.**
- **No cross-workspace foreign keys.**

### 4.3 Migrations and seed data
- drizzle-kit migrations, reviewed SQL, expand/contract discipline.
- **Synthetic, court-faithful demo seed:** two workspaces (a Chennai solo and a Bengaluru chamber) with realistic Madras HC and Karnataka HC nomenclature, lists, orders, obligations and memory, all with **fictional parties**. It powers the demo, Storybook fixtures and e2e tests.

## 5. Domain services (`packages/core`)
Each service is a typed module with zod-validated inputs. It is called by server actions, the API and workers.

| Service | Responsibilities |
|---|---|
| Workspaces & members | Create, invite, roles, offboarding (reassign + revoke) |
| Matter graph | CRUD; merge and split; proceeding state machine (`filed → sr_fr → defects → re_presented → numbered → disposed`); timeline query |
| Listings & court day | Canonical next date; conflict cards; court-day query (complex → hall → list → item); clash detection; list diffs |
| Hearings | Capture → proposals → confirm; delegation |
| Orders & obligations | Directions → obligations; reconciliation (every direction is either an obligation or N/A with a reason); queue queries; reminders |
| Briefs | Assemble the per-listing brief (stage, last order, open obligations, carry list, synopsis, last hearing, court notes, anchored context); readiness score |
| Continuity | Handover note; what-changed since last viewed |
| Memory | Proposals; confirm, save, edit, delete; scope enforcement in SQL; monthly review; tenure metrics |
| Automation engine | L1–L4 levels per approval matrix ([09 §4](../product/09-zero-entry-automation-design.md#4-the-automation-ladder--approval-boundaries)); undo cascades; **no L5 action types exist** (static check) |
| Outward drafts | Client, senior and counsel updates; edit diff; "shared by lawyer" log. **No send path** |
| Audit | `audit_event` and `ai_call` writers; user-visible activity feed and exports |

## 6. Security and privacy architecture
- **Encryption:** TLS everywhere. Postgres volume encryption on the VPS disk (provider-level), and RDS encryption at Stage B. **Envelope encryption** for documents and memory values: a per-workspace data key (DEK) wrapped by a master key (KEK) held in env and a secret manager at bootstrap, moving to KMS at Stage B. Deleting a workspace destroys its DEK (crypto-erase).
- **AuthZ:** a central `can(user, action, resource)` policy; RLS as a backstop; clerk restrictions.
- **Sessions:** httpOnly, Secure and SameSite=Lax cookies; CSRF protection on server actions; 2FA for owners.
- **Security headers (Caddy):** HSTS, CSP (nonces for Next.js), Referrer-Policy, Permissions-Policy, COOP and CORP.
- **Uploads:**
  - MIME sniffing and allow-list (PDF, images, DOCX, audio, `.ics`, `.txt`/`.zip` for WhatsApp exports);
  - size caps;
  - ClamAV scan in a worker (Stage A optional, Stage B required);
  - PDFs are rendered to images for preview in a worker; uploaded PDF JavaScript never runs.
- **Prompt-injection posture:** AI has no tools and no outbound actions. Outputs are schema-validated. Documents are treated as data.
- **Support sessions:** user-granted, time-boxed and audited. Staff see no content by default.
- **Compliance artefacts:**
  - CERT-In 6-hour runbook;
  - 180-day log retention in India;
  - NTP time sync;
  - DPDP breach runbook;
  - DPA and sub-processor list (needs-human: counsel).

## 7. Design system and UI direction ("insanely beautiful" is a requirement, not a hope)
- **Character:** calm, precise, editorial-grade legal software. Dense information that still breathes. A dark mode that is first-class, not an afterthought.
- **Typography:**
  - UI: Geist or Inter (variable);
  - headings and brief text: an editorial serif (e.g. Newsreader or Source Serif 4);
  - Tamil and Kannada: Noto Sans fallbacks;
  - tabular numerals for items, dates and ₹ amounts.
- **Tokens** (`packages/ui/tokens`):
  - semantic colour roles (surface, elevated, ink, muted, accent, success, warning, danger, info) in OKLCH;
  - a 4 px spacing scale;
  - radius scale;
  - shadows / elevation;
  - motion durations and easings;
  - z-index.

  Light and dark themes, both meeting WCAG AA contrast (AAA for body text where feasible).
- **Signature patterns:**
  - the **Court-Day Board** (halls as columns or a timeline, with item chips and stage badges);
  - the **Brief Sheet** (a printable, A4-faithful brief with anchor links);
  - the **Provenance Chip** (hover or tap to see the source quote and page);
  - **Proposal Cards** (L2 confirm, edit, dismiss, with keyboard shortcuts);
  - the **Activity Feed** with undo;
  - the **Obligation Queue** (grouped, swipe actions on mobile);
  - the **Matter Graph View** (proceedings tree plus timeline);
  - the **Command Palette** (⌘K);
  - **Memory Cards**.
- **Motion:** purposeful 150–250 ms transitions, layout animations for queue changes, reduced-motion support.
- **Every surface defines** its empty, loading (skeleton), error, offline and permission-denied states.
- **Responsive targets:** 360 px Android phone first, then 768 px tablet and 1280 px+ desktop.
- **Quality gates:**
  - Storybook story for every component;
  - Playwright visual baselines (light and dark, 3 viewports);
  - axe zero serious violations;
  - Lighthouse ≥ 95 performance and accessibility on key pages;
  - ForgeDock `/design` pipeline for the marketing site and the hero product surfaces (Court-Day Board, Brief Sheet, onboarding).

## 8. Route map (apps/web)
**Public and auth:**
- `/sign-in` (Google, magic link, passkey)
- `/invite/[token]`
- `/onboarding` (solo / chamber wizard; court picker; import)

**Workspace-scoped (`/w/[slug]/…`):**
- `today`, `tomorrow`, `calendar` (court-day board)
- `inbox` (capture: Needs you, Ready to send, Processing)
- `matters`, `matters/[id]` (overview, proceedings, timeline, documents, obligations, memory, drafts, people)
- `briefs/[listingId]` (Brief Sheet; printable)
- `obligations` (queue)
- `drafts`, `drafts/[id]` (studio)
- `memory` (review)
- `people` (clients, counsel)
- `courts` (forums, halls, rosters, adapter status)
- `activity` (feed + undo)
- `billing`, `invoices` (⚖ flag)
- `limitation` (⚖ flag)
- `insights` (practice analytics)

**Workspace settings** (`/w/[slug]/settings/…`):
- `profile`, `members`, `roles`, `notifications`, `integrations` (email intake, ICS feed), `privacy` (India-only AI, sensitive matters, retention), `export`, `danger` (delete)

**Account and PWA:**
- `/account` (passkeys, 2FA, sessions, connected accounts)
- `/share-target` (PWA share endpoint)
- `/offline`

## 9. Credentials and human inputs (all tracked as `needs-human`)
- Domain registration plus a Cloudflare account and API token.
- An India VPS (DigitalOcean BLR1 or Lightsail ap-south-1): prod and staging.
- Google OAuth client (web).
- Amazon SES (ap-south-1) domain verification and SMTP or API keys.
- Razorpay keys and webhook secret.
- AWS Bedrock India model access plus an IAM user.
- Sarvam API key.
- Indian Kanoon API token.
- Sentry DSN.
- GitHub environments and secrets (staging and prod).
- VAPID keys (generated).
- Counsel deliverables: ToS, privacy policy and DPA text; access-mode memo; client-content guidance; limitation rule tables; GST/RCM review.
- Court fixtures from lawyers.
- Letters to the Registries.

**Code never blocks on credentials.** Every integration has a mock or console provider and an env schema that boots in dev and CI without secrets.

## 10. Quality bars (apply to every issue)
- TypeScript strict; no `any` in exported APIs.
- Unit, integration and e2e coverage for every acceptance criterion.
- Cross-tenant suite green.
- Lighthouse budgets.
- Bundle budget: initial JS ≤ 180 KB gzip on the court-day route.
- p95 server action < 300 ms on seeded data.
- i18n keys present in `en`, with `ta`/`kn` keys at least stubbed, then translated in the i18n issue.
- Docs: an ADR for each new architectural decision, plus updated Storybook.

## 11. Milestones (build order)
| # | Milestone (branch `milestone/<slug>`) | Delivers |
|---|---|---|
| 1 | Foundation (`foundation`) | Monorepo, tooling, CI, env, DB baseline, design system, app shell, auth, observability, dev Docker |
| 2 | Platform & Tenancy (`platform`) | Workspaces, roles, RLS suite, storage, flags, notifications, i18n, settings, audit, admin console, billing |
| 3 | Court Layer & Matter Graph (`court-graph`) | Forum catalogue, adapter framework, Madras HC and Karnataka HC A1 adapters, A0 generic, NCLT, access-mode registry, matter-graph services and UI |
| 4 | Capture & Document Intelligence (`capture-intel`) | Capture inbox, PWA share target, voice recorder, ICS, email forward-in, WhatsApp export import, AI gateway, OCR, STT, extraction, proposals and automation engine, activity and undo |
| 5 | Prepare & Execute (`prepare-execute`) | Court-Day Board, list diffs, briefs, timeline, hearing capture, delegation, reminders, offline cache |
| 6 | Follow-up, Continuity & Memory (`followup-memory`) | Obligation queue, defects and copies, outward drafts, stale detection, handover, what-changed, memory engine and review |
| 7 | Drafting, Citations & Research (`drafting`) | Template engine, DOCX/PDF, drafting studio, consistency and citation checkers, research link-outs and notes, playbooks |
| 8 | Business & Practice (`business`) | Clients, fees and invoices (⚖ flag), limitation (⚖ flag), insights, DPDP export/delete tooling |
| 9 | Site, Onboarding & Launch (`launch`) | Marketing site (/design), onboarding wizards, help centre, demo seed, legal pages, status page |
| 10 | Production Infra & Scale (`infra-scale`) | Terraform (Cloudflare and VPS), prod images, Caddy, deploy pipelines with freeze guard, backups and DR drills, monitoring and alerts, load tests, hardening, Stage B runbook |

Each milestone ships to `staging` through `/milestone ship`. Milestones run in order. Within a milestone, issues are orchestrated in parallel along their `Depends on` DAG.
