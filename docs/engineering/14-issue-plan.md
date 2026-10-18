# 14 — Issue Plan (generated from the technical spike, 2026-10-18)

Spike: [#1](https://github.com/RapierCraftStudios/causedeck/issues/1) · Board: [Projects #1](https://github.com/orgs/RapierCraftStudios/projects/1) · Contract: [13](13-technical-architecture-spike.md)

| Key | # | Title | Milestone | Priority | Depends on |
|---|---|---|---|---|---|
| F01 | [#2](https://github.com/RapierCraftStudios/causedeck/issues/2) | feat(repo): scaffold pnpm + Turborepo monorepo with shared TS/ESLint/Prettier config | Foundation | P1 | — |
| F02 | [#3](https://github.com/RapierCraftStudios/causedeck/issues/3) | feat(ci): GitHub Actions CI with turbo caching for lint, typecheck, test and build | Foundation | P1 | #2 |
| F03 | [#4](https://github.com/RapierCraftStudios/causedeck/issues/4) | feat(config): typed env schema package with mock-safe defaults and secret validation | Foundation | P1 | #2 |
| F04 | [#5](https://github.com/RapierCraftStudios/causedeck/issues/5) | feat(dev): Docker Compose dev stack (Postgres+pgvector, MinIO, Mailpit) and pnpm dev | Foundation | P1 | #2 |
| F05 | [#6](https://github.com/RapierCraftStudios/causedeck/issues/6) | feat(db): Drizzle setup, migration tooling, provenance column conventions, Testcontainers | Foundation | P1 | #4, #5 |
| F06 | [#7](https://github.com/RapierCraftStudios/causedeck/issues/7) | feat(ui): design tokens (OKLCH light/dark), type system and Indic fonts, Tailwind v4 preset | Foundation | P1 | #2 |
| F07 | [#8](https://github.com/RapierCraftStudios/causedeck/issues/8) | feat(ui): shadcn/ui component library in packages/ui with Storybook and visual regression | Foundation | P1 | #7 |
| F08 | [#9](https://github.com/RapierCraftStudios/causedeck/issues/9) | feat(ui): signature patterns (Provenance Chip, Proposal Card, Stage Badge, state screens) | Foundation | P1 | #8 |
| F09 | [#10](https://github.com/RapierCraftStudios/causedeck/issues/10) | feat(web): Next.js App Router scaffold with themes, i18n wiring, fonts, error boundaries | Foundation | P1 | #4, #8 |
| F10 | [#11](https://github.com/RapierCraftStudios/causedeck/issues/11) | feat(web): app shell with sidebar, workspace switcher, command palette and mobile nav | Foundation | P1 | #9, #10 |
| F11 | [#12](https://github.com/RapierCraftStudios/causedeck/issues/12) | feat(auth): Better Auth with Google OAuth, magic link, passkeys and sign-in UI | Foundation | P1 | #6, #10 |
| F12 | [#13](https://github.com/RapierCraftStudios/causedeck/issues/13) | feat(observability): pino logging, OpenTelemetry, Sentry wiring and health endpoints | Foundation | P1 | #4 |
| F13 | [#14](https://github.com/RapierCraftStudios/causedeck/issues/14) | feat(api): Hono API service with OpenAPI, auth middleware, versioning and error model | Foundation | P1 | #6, #12, #13 |
| F14 | [#15](https://github.com/RapierCraftStudios/causedeck/issues/15) | feat(worker): pg-boss worker scaffold with job registry, idempotency and dead-letter | Foundation | P1 | #6, #13 |
| F15 | [#16](https://github.com/RapierCraftStudios/causedeck/issues/16) | feat(e2e): Playwright harness with auth fixtures, seeded DB, axe and visual baselines | Foundation | P1 | #3, #12 |
| F16 | [#17](https://github.com/RapierCraftStudios/causedeck/issues/17) | docs(adr): ADRs 0001-0010 recording the technical spike decisions | Foundation | P2 | #2 |
| P01 | [#18](https://github.com/RapierCraftStudios/causedeck/issues/18) | feat(core): workspaces and membership (create, invite, accept, roles, switch) with UI | Platform & Tenancy | P1 | #11, #12 |
| P02 | [#19](https://github.com/RapierCraftStudios/causedeck/issues/19) | feat(db): row-level security, withWorkspace helper and cross-tenant CI test suite | Platform & Tenancy | P1 | #6, #18 |
| P03 | [#20](https://github.com/RapierCraftStudios/causedeck/issues/20) | feat(core): permission policy can() with clerk and per-matter restrictions | Platform & Tenancy | P1 | #19 |
| P04 | [#21](https://github.com/RapierCraftStudios/causedeck/issues/21) | feat(storage): S3 abstraction, presigned URLs, per-workspace envelope encryption | Platform & Tenancy | P1 | #6, #19 |
| P05 | [#22](https://github.com/RapierCraftStudios/causedeck/issues/22) | feat(flags): feature flags, kill-switches and access-mode registry enforcement | Platform & Tenancy | P1 | #19 |
| P06 | [#23](https://github.com/RapierCraftStudios/causedeck/issues/23) | feat(notifications): in-app center, React Email via SES/console, web push, preferences | Platform & Tenancy | P2 | #15, #18 |
| P07 | [#24](https://github.com/RapierCraftStudios/causedeck/issues/24) | feat(i18n): en/ta/kn catalogs, locale switcher, Indic rendering, date and INR formatters | Platform & Tenancy | P2 | #10 |
| P08 | [#25](https://github.com/RapierCraftStudios/causedeck/issues/25) | feat(web): workspace and account settings (members, roles, privacy, passkeys, 2FA) | Platform & Tenancy | P2 | #18, #20, #23 |
| P09 | [#26](https://github.com/RapierCraftStudios/causedeck/issues/26) | feat(core): audit log, security events and user-visible activity export | Platform & Tenancy | P2 | #19 |
| P10 | [#27](https://github.com/RapierCraftStudios/causedeck/issues/27) | feat(admin): staff admin console (adapter health, flags, consented support sessions) | Platform & Tenancy | P2 | #22, #26 |
| P11 | [#28](https://github.com/RapierCraftStudios/causedeck/issues/28) | feat(billing): plans, seat entitlements, Razorpay subscriptions, UPI Autopay, webhooks | Platform & Tenancy | P2 | #14, #18 |
| P12 | [#29](https://github.com/RapierCraftStudios/causedeck/issues/29) | feat(billing): GST-compliant SaaS invoices and billing management UI | Platform & Tenancy | P2 | #28 |
| P13 | [#30](https://github.com/RapierCraftStudios/causedeck/issues/30) | feat(core): usage metering and per-workspace AI budgets | Platform & Tenancy | P2 | #19 |
| P14 | [#31](https://github.com/RapierCraftStudios/causedeck/issues/31) | feat(core): workspace data export (ZIP) and deletion with crypto-erase (DPDP) | Platform & Tenancy | P2 | #21, #26 |
| C01 | [#32](https://github.com/RapierCraftStudios/causedeck/issues/32) | feat(db): matter-graph schema with provenance and invariants | Court Layer & Matter Graph | P1 | #19 |
| C02 | [#33](https://github.com/RapierCraftStudios/causedeck/issues/33) | feat(core): matter-graph services (merge/split, proceeding state machine, next date) | Court Layer & Matter Graph | P1 | #32 |
| C03 | [#34](https://github.com/RapierCraftStudios/causedeck/issues/34) | feat(court): forum catalogue for Madras HC, Karnataka HC, Chennai and Bengaluru forums | Court Layer & Matter Graph | P1 | #32 |
| C04 | [#35](https://github.com/RapierCraftStudios/causedeck/issues/35) | feat(adapters): court-adapter framework (versioned config, fixtures, health monitors) | Court Layer & Matter Graph | P1 | #34, #22 |
| C05 | [#36](https://github.com/RapierCraftStudios/causedeck/issues/36) | feat(adapters): Madras HC A1 adapter (cause lists, case types, SR/returns, orders) | Court Layer & Matter Graph | P1 | #35 |
| C06 | [#37](https://github.com/RapierCraftStudios/causedeck/issues/37) | feat(adapters): Karnataka HC A1 adapter (cause lists, stages, FR/objections, orders) | Court Layer & Matter Graph | P1 | #35 |
| C07 | [#38](https://github.com/RapierCraftStudios/causedeck/issues/38) | feat(adapters): NCLT Bengaluru adapter for table-format cause-list PDFs | Court Layer & Matter Graph | P3 | #35 |
| C08 | [#39](https://github.com/RapierCraftStudios/causedeck/issues/39) | feat(court): effective-dated bench rosters, roster PDF import and bench-change alerts | Court Layer & Matter Graph | P2 | #33, #34 |
| C09 | [#40](https://github.com/RapierCraftStudios/causedeck/issues/40) | feat(web): matters list and matter workspace UI (overview, proceedings, people, docs) | Court Layer & Matter Graph | P1 | #33, #11 |
| C10 | [#41](https://github.com/RapierCraftStudios/causedeck/issues/41) | feat(web): matter graph view and cross-proceeding timeline UI | Court Layer & Matter Graph | P2 | #40 |
| C11 | [#42](https://github.com/RapierCraftStudios/causedeck/issues/42) | feat(web): courts area with forums, halls, adapter status and official deep links | Court Layer & Matter Graph | P3 | #35, #11 |
| I01 | [#43](https://github.com/RapierCraftStudios/causedeck/issues/43) | feat(capture): capture inbox model and upload pipeline (allow-list, dedupe, scan hook) | Capture & Document Intelligence | P1 | #21, #32 |
| I02 | [#44](https://github.com/RapierCraftStudios/causedeck/issues/44) | feat(ai): AI gateway with Bedrock India, Sarvam and mock providers, budgets, audit | Capture & Document Intelligence | P1 | #30, #15 |
| I03 | [#45](https://github.com/RapierCraftStudios/causedeck/issues/45) | feat(intelligence): document pipeline (text layer, OCR, classification, page render) | Capture & Document Intelligence | P1 | #43, #44 |
| I04 | [#46](https://github.com/RapierCraftStudios/causedeck/issues/46) | feat(intelligence): anchored order extraction with date-presence validation | Capture & Document Intelligence | P1 | #45, #33 |
| I05 | [#47](https://github.com/RapierCraftStudios/causedeck/issues/47) | feat(core): automation engine L1-L4 with proposals, undo cascades and no-L5 check | Capture & Document Intelligence | P1 | #33, #26 |
| I06 | [#48](https://github.com/RapierCraftStudios/causedeck/issues/48) | feat(web): capture inbox UI (Needs you, Ready to send, Processing) with proposal cards | Capture & Document Intelligence | P1 | #47, #9 |
| I07 | [#49](https://github.com/RapierCraftStudios/causedeck/issues/49) | feat(web): activity feed with 7-day undo and end-of-day digest | Capture & Document Intelligence | P2 | #47, #23 |
| I08 | [#50](https://github.com/RapierCraftStudios/causedeck/issues/50) | feat(pwa): installable PWA, Web Share Target capture and offline outbox | Capture & Document Intelligence | P1 | #43, #10 |
| I09 | [#51](https://github.com/RapierCraftStudios/causedeck/issues/51) | feat(capture): offline voice recorder, Indic STT and structuring into hearing proposals | Capture & Document Intelligence | P1 | #44, #47, #50 |
| I10 | [#52](https://github.com/RapierCraftStudios/causedeck/issues/52) | feat(capture): camera and diary-photo capture to OCR-backed proposals | Capture & Document Intelligence | P2 | #45, #47 |
| I11 | [#53](https://github.com/RapierCraftStudios/causedeck/issues/53) | feat(capture): ICS calendar import and private ICS export feed | Capture & Document Intelligence | P2 | #33, #47 |
| I12 | [#54](https://github.com/RapierCraftStudios/causedeck/issues/54) | feat(capture): email forward-in intake parsing registry and AIMS cause-list emails | Capture & Document Intelligence | P2 | #43, #36, #47 |
| I13 | [#55](https://github.com/RapierCraftStudios/causedeck/issues/55) | feat(capture): WhatsApp chat-export importer for internal chats with exclusions | Capture & Document Intelligence | P3 | #43, #47 |
| I14 | [#56](https://github.com/RapierCraftStudios/causedeck/issues/56) | feat(adapters): A0 generic adapter with LLM-assisted anchored parsing and confirmation | Capture & Document Intelligence | P2 | #35, #46 |
| I15 | [#57](https://github.com/RapierCraftStudios/causedeck/issues/57) | feat(capture): bootstrap import of lists, orders and diary photos into a confirm grid | Capture & Document Intelligence | P1 | #46, #36, #37, #48 |
| E01 | [#58](https://github.com/RapierCraftStudios/causedeck/issues/58) | feat(core): court-day service (complex/hall/list/item, clashes, list diffs) | Prepare & Execute | P1 | #33, #36, #37 |
| E02 | [#59](https://github.com/RapierCraftStudios/causedeck/issues/59) | feat(web): Court-Day Board for today and tomorrow (hero surface) | Prepare & Execute | P1 | #58, #9 |
| E03 | [#60](https://github.com/RapierCraftStudios/causedeck/issues/60) | feat(core): preparation brief assembly with anchored context and readiness score | Prepare & Execute | P1 | #58, #46 |
| E04 | [#61](https://github.com/RapierCraftStudios/causedeck/issues/61) | feat(web): Brief Sheet UI with provenance chips and A4 print/PDF output | Prepare & Execute | P1 | #60, #59 |
| E05 | [#62](https://github.com/RapierCraftStudios/causedeck/issues/62) | feat(web): one-screen hearing outcome confirmation (next date, obligations, tasks) | Prepare & Execute | P1 | #51, #58 |
| E06 | [#63](https://github.com/RapierCraftStudios/causedeck/issues/63) | feat(core): chamber delegation of appearances with live outcomes for owners | Prepare & Execute | P2 | #58, #20 |
| E07 | [#64](https://github.com/RapierCraftStudios/causedeck/issues/64) | feat(notifications): court-day reminders (8 pm brief, 7 am diff, missing outcome) | Prepare & Execute | P2 | #58, #23 |
| E08 | [#65](https://github.com/RapierCraftStudios/causedeck/issues/65) | feat(pwa): 7-day offline cache for court-day view and briefs with sync safety | Prepare & Execute | P2 | #59, #61, #50 |
| E09 | [#66](https://github.com/RapierCraftStudios/causedeck/issues/66) | feat(web): week and month calendar view of listings and deadlines | Prepare & Execute | P3 | #58, #9 |
| M01 | [#67](https://github.com/RapierCraftStudios/causedeck/issues/67) | feat(core): obligation service with reconciliation, defects, SR/FR and certified copies | Follow-up, Continuity & Memory | P1 | #33, #46 |
| M02 | [#68](https://github.com/RapierCraftStudios/causedeck/issues/68) | feat(web): Obligation Queue UI with grouping, swipe actions and drafted next steps | Follow-up, Continuity & Memory | P1 | #67, #9 |
| M03 | [#69](https://github.com/RapierCraftStudios/causedeck/issues/69) | feat(core): outward update drafts in EN/TA/KN with edit diff and share-by-lawyer log | Follow-up, Continuity & Memory | P1 | #67, #44, #24 |
| M04 | [#70](https://github.com/RapierCraftStudios/causedeck/issues/70) | feat(core): stale-matter detection and needs-attention surfaces | Follow-up, Continuity & Memory | P2 | #67, #58 |
| M05 | [#71](https://github.com/RapierCraftStudios/causedeck/issues/71) | feat(web): handover notes and what-changed-since-last-viewed | Follow-up, Continuity & Memory | P2 | #67, #41 |
| M06 | [#72](https://github.com/RapierCraftStudios/causedeck/issues/72) | feat(core): lawyer memory engine M1-M7 with confirm-before-save and scope enforcement | Follow-up, Continuity & Memory | P1 | #47, #33 |
| M07 | [#73](https://github.com/RapierCraftStudios/causedeck/issues/73) | feat(web): memory screen, memory cards and monthly memory review | Follow-up, Continuity & Memory | P2 | #72, #9 |
| M08 | [#74](https://github.com/RapierCraftStudios/causedeck/issues/74) | feat(core): wire memory into briefs, drafts and recognition-based matching | Follow-up, Continuity & Memory | P2 | #72, #60, #69 |
| D01 | [#75](https://github.com/RapierCraftStudios/causedeck/issues/75) | feat(drafting): template engine with court format presets and DOCX/PDF export | Drafting, Citations & Research | P2 | #33 |
| D02 | [#76](https://github.com/RapierCraftStudios/causedeck/issues/76) | feat(drafting): system templates for Madras HC and Karnataka HC routine documents | Drafting, Citations & Research | P2 | #75 |
| D03 | [#77](https://github.com/RapierCraftStudios/causedeck/issues/77) | feat(drafting): citation checker with neutral-citation patterns and Indian Kanoon resolver | Drafting, Citations & Research | P1 | #75, #44 |
| D04 | [#78](https://github.com/RapierCraftStudios/causedeck/issues/78) | feat(drafting): consistency checker for names, case numbers, dates and annexures | Drafting, Citations & Research | P2 | #75 |
| D05 | [#79](https://github.com/RapierCraftStudios/causedeck/issues/79) | feat(web): drafting studio with facts panel, citation status, versions and export | Drafting, Citations & Research | P2 | #75, #77, #78, #9 |
| D06 | [#80](https://github.com/RapierCraftStudios/causedeck/issues/80) | feat(web): research link-outs with pre-filled queries and matter research notes | Drafting, Citations & Research | P3 | #40 |
| D07 | [#81](https://github.com/RapierCraftStudios/causedeck/issues/81) | feat(drafting): playbooks, precedent bank and user-approved style learning (M5) | Drafting, Citations & Research | P3 | #72, #75 |
| B01 | [#82](https://github.com/RapierCraftStudios/causedeck/issues/82) | feat(core): client contacts for existing clients with language preference | Business & Practice | P2 | #33 |
| B02 | [#83](https://github.com/RapierCraftStudios/causedeck/issues/83) | feat(billing): fees, GST/RCM invoices and client-expense ledger (legal-gated flag) | Business & Practice | P3 | #82, #22 |
| B03 | [#84](https://github.com/RapierCraftStudios/causedeck/issues/84) | feat(core): limitation tracker driven by counsel rule tables (legal-gated flag) | Business & Practice | P3 | #67, #22 |
| B04 | [#85](https://github.com/RapierCraftStudios/causedeck/issues/85) | feat(web): practice insights dashboard (Prepared & Kept, obligations, preparedness) | Business & Practice | P2 | #60, #67, #86 |
| B05 | [#86](https://github.com/RapierCraftStudios/causedeck/issues/86) | feat(core): proof-of-value instrumentation (preparedness tap, load pulse, context test) | Business & Practice | P2 | #62 |
| B06 | [#87](https://github.com/RapierCraftStudios/causedeck/issues/87) | feat(core): inbound enquiry log with conflict check, no auto-reply (legal-gated flag) | Business & Practice | P3 | #82, #22 |
| B07 | [#88](https://github.com/RapierCraftStudios/causedeck/issues/88) | feat(web): advocate-authored expiring client status links (legal-gated flag) | Business & Practice | P3 | #69, #22 |
| L01 | [#89](https://github.com/RapierCraftStudios/causedeck/issues/89) | feat(site): marketing site scaffold (static export, MDX, SEO) for Cloudflare Pages | Site, Onboarding & Launch | P2 | #8 |
| L02 | [#90](https://github.com/RapierCraftStudios/causedeck/issues/90) | feat(site): landing page via ForgeDock /design pipeline | Site, Onboarding & Launch | P2 | #89 |
| L03 | [#91](https://github.com/RapierCraftStudios/causedeck/issues/91) | feat(site): pricing, security/privacy, about and changelog pages with Rule-36-safe copy | Site, Onboarding & Launch | P2 | #90 |
| L04 | [#92](https://github.com/RapierCraftStudios/causedeck/issues/92) | feat(web): solo and chamber onboarding wizards ending in the first court-day view | Site, Onboarding & Launch | P1 | #57, #59, #18 |
| L05 | [#93](https://github.com/RapierCraftStudios/causedeck/issues/93) | feat(db): synthetic court-faithful demo seed (Chennai solo, Bengaluru chamber), demo mode | Site, Onboarding & Launch | P1 | #36, #37, #67, #60 |
| L06 | [#94](https://github.com/RapierCraftStudios/causedeck/issues/94) | feat(web): in-app help center, contextual tips and keyboard shortcut sheet | Site, Onboarding & Launch | P3 | #11 |
| L07 | [#95](https://github.com/RapierCraftStudios/causedeck/issues/95) | feat(site): legal pages scaffold (ToS, Privacy, DPA, sub-processors, AI disclosure) | Site, Onboarding & Launch | P2 | #89 |
| L08 | [#96](https://github.com/RapierCraftStudios/causedeck/issues/96) | feat(infra): public status page with adapter health feed | Site, Onboarding & Launch | P3 | #27 |
| X01 | [#97](https://github.com/RapierCraftStudios/causedeck/issues/97) | feat(infra): production Dockerfiles (multi-stage, non-root) and compose.prod | Production Infra & Scale | P1 | #14, #15, #10 |
| X02 | [#98](https://github.com/RapierCraftStudios/causedeck/issues/98) | feat(infra): Caddy config with TLS, HTTP/3, CSP and security headers, rate limits | Production Infra & Scale | P1 | #97 |
| X03 | [#99](https://github.com/RapierCraftStudios/causedeck/issues/99) | feat(infra): Terraform for Cloudflare (DNS, Pages, CDN, WAF) and India VPS | Production Infra & Scale | P1 | #97 |
| X04 | [#100](https://github.com/RapierCraftStudios/causedeck/issues/100) | feat(ci): staging/prod deploy pipelines with health-gated rollout and court-day freeze | Production Infra & Scale | P1 | #97, #98, #3 |
| X05 | [#101](https://github.com/RapierCraftStudios/causedeck/issues/101) | feat(infra): WAL-G Postgres backups, MinIO replication and automated restore drills | Production Infra & Scale | P1 | #97 |
| X06 | [#102](https://github.com/RapierCraftStudios/causedeck/issues/102) | feat(infra): monitoring, alerting and 180-day India log retention | Production Infra & Scale | P2 | #13, #97 |
| X07 | [#103](https://github.com/RapierCraftStudios/causedeck/issues/103) | docs(runbooks): CERT-In 6h incident, DPDP breach, key rotation, restore and on-call | Production Infra & Scale | P2 | #101, #102 |
| X08 | [#104](https://github.com/RapierCraftStudios/causedeck/issues/104) | feat(security): dependency, secret and SAST scanning, ZAP baseline, CSP reporting | Production Infra & Scale | P2 | #98, #3 |
| X09 | [#105](https://github.com/RapierCraftStudios/causedeck/issues/105) | feat(perf): k6 load tests on seeded data, perf budgets and Lighthouse CI | Production Infra & Scale | P2 | #100, #93 |
| X10 | [#106](https://github.com/RapierCraftStudios/causedeck/issues/106) | docs(infra): Stage B/C scale-out runbook and IaC modules (RDS, S3, multi-node LB) | Production Infra & Scale | P3 | #99, #101 |
| H01 | [#107](https://github.com/RapierCraftStudios/causedeck/issues/107) | chore(human): register domain and set up Cloudflare account and API token | needs-human | P1 | — |
| H02 | [#108](https://github.com/RapierCraftStudios/causedeck/issues/108) | chore(human): provision India VPS for prod and staging with SSH deploy keys | needs-human | P1 | — |
| H03 | [#109](https://github.com/RapierCraftStudios/causedeck/issues/109) | chore(human): create Google OAuth client credentials | needs-human | P1 | — |
| H04 | [#110](https://github.com/RapierCraftStudios/causedeck/issues/110) | chore(human): Amazon SES (ap-south-1) domain verification and inbound email route | needs-human | P2 | — |
| H05 | [#111](https://github.com/RapierCraftStudios/causedeck/issues/111) | chore(human): Razorpay account, plans, API keys and webhook secret | needs-human | P2 | — |
| H06 | [#112](https://github.com/RapierCraftStudios/causedeck/issues/112) | chore(human): AWS Bedrock India model access and IAM credentials | needs-human | P1 | — |
| H07 | [#113](https://github.com/RapierCraftStudios/causedeck/issues/113) | chore(human): Sarvam API key for Indic STT and OCR | needs-human | P2 | — |
| H08 | [#114](https://github.com/RapierCraftStudios/causedeck/issues/114) | chore(human): Indian Kanoon API token and commercial-use confirmation | needs-human | P2 | — |
| H09 | [#115](https://github.com/RapierCraftStudios/causedeck/issues/115) | chore(human): Sentry project and DSN | needs-human | P3 | — |
| H10 | [#116](https://github.com/RapierCraftStudios/causedeck/issues/116) | chore(human): GitHub environments and secrets for staging and prod | needs-human | P1 | — |
| H11 | [#117](https://github.com/RapierCraftStudios/causedeck/issues/117) | chore(human): counsel deliverables (ToS, Privacy, DPA, AI disclosure, public wording) | needs-human | P1 | — |
| H12 | [#118](https://github.com/RapierCraftStudios/causedeck/issues/118) | chore(human): counsel access-mode memo and letters to Madras HC and Karnataka HC Registries | needs-human | P1 | — |
| H13 | [#119](https://github.com/RapierCraftStudios/causedeck/issues/119) | chore(human): collect lawyer-supplied court fixtures (30+ lists, 50+ orders per HC) | needs-human | P1 | — |
| H14 | [#120](https://github.com/RapierCraftStudios/causedeck/issues/120) | chore(human): counsel limitation rule tables and GST/RCM review to unlock gated flags | needs-human | P2 | — |
