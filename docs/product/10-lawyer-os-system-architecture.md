# 10 — Lawyer OS System Architecture: North Star, Matter Graph, Memory, Court Adapters, SaaS Platform

Version 0.3 · 2026-10-17 · Status: Proposed (D-024 to D-033) · Supersedes the product framing in [09](09-zero-entry-automation-design.md); 09 is now the spec for the capture and automation *subsystem* inside this architecture.
Related: [Thesis](../strategy/02-product-thesis-and-segmentation.md) · [PRD](03-prd.md) · [MVP](../mvp/04-mvp-definition.md) · [Launch markets](../strategy/11-launch-markets-madras-hc-bengaluru.md) · [Risks](../risk/06-risk-register.md)

> **Founder correction (2026-10-17).** Lawyer OS is **not** a data-entry tool or a chamber-admin utility. It is an **intelligent operating layer for how lawyers practise in Indian courts**. It is delivered as a **secure, multi-tenant, India-region SaaS** for advocates and chambers. The MVP is the smallest marketable **vertical slice** of that system. It must already contain a coherent matter graph, lawyer memory, courtroom workflow, document intelligence, and a prepare → execute → follow-up loop. It must feel like the beginning of the complete product.

Evidence tags: `[V]` verified · `[R]` reported · `[I]` inference · `[FR]` founder-reported. ⚖ = needs Indian legal review.

---

## 1. The full Lawyer OS: north star

### 1.1 North-star statement
> **Every Indian advocate walks into every hearing prepared, leaves with every obligation captured, and never loses the thread of a matter. Their practice's knowledge compounds instead of living in diaries, WhatsApp threads and memory.**

### 1.2 North-star metric (full OS)
**Prepared & Kept rate.** This is the share of a lawyer's listed appearances in a week where both of these hold:
- (a) a current preparation brief existed before the hearing. "Current" means the last order, open directions and documents are linked, and the lawyer opened or confirmed it.
- (b) every obligation arising from the hearing was captured, owned and either met or consciously rescheduled by its due date.

Supporting value metrics (see [PRD §10](03-prd.md#10-success-metrics)):
- preparation completeness;
- missed-obligation rate;
- cognitive-load score;
- matter-continuity time (minutes to get up to speed on a matter or hand it over);
- correction rate (trust).

Minutes of data entry avoided is a **secondary** metric.

### 1.3 The OS in layers

```
┌───────────────────────────────────────────────────────────────────────────────┐
│ SURFACES   Mobile (Android-first, iOS) · Web · Desktop (PWA → native later)    │
│            Court-day view · Matter workspace · Brief · Action queue · Inbox    │
├───────────────────────────────────────────────────────────────────────────────┤
│ WORKFLOW   PREPARE (briefs, document context, bench/court notes)               │
│ ENGINES    EXECUTE (court-day operating view, item tracking, hearing capture)  │
│            FOLLOW-UP (obligations, deadlines, filings/defects, client drafts)  │
│            CONTINUITY (matter history, handover, chamber delegation)           │
├───────────────────────────────────────────────────────────────────────────────┤
│ INTELLIGENCE  Document intelligence (OCR, classify, extract w/ anchors,        │
│ SERVICES      summarise, translate) · Speech · Matching · Drafting assist ·    │
│               Citation verification · Memory proposals                         │
├───────────────────────────────────────────────────────────────────────────────┤
│ KNOWLEDGE   MATTER GRAPH (facts, provenance)  +  LAWYER MEMORY (learned,       │
│             scoped, inspectable)                                               │
├───────────────────────────────────────────────────────────────────────────────┤
│ COURT LAYER  Court adapters (forum model, nomenclature, cause lists, orders,   │
│              stages, calendars, language) · access-mode registry (⚖)           │
├───────────────────────────────────────────────────────────────────────────────┤
│ CAPTURE     Voice · Orders/PDFs · Cause lists · Calendar · Email/WhatsApp      │
│             exports (privacy-gated) · Share sheet · Manual correction          │
├───────────────────────────────────────────────────────────────────────────────┤
│ TRUST       Approval boundaries (L1–L4; no L5) · Provenance · Audit ·          │
│             Privacy & tenancy · Professional-conduct guardrails                │
├───────────────────────────────────────────────────────────────────────────────┤
│ SAAS PLATFORM  Multi-tenant hosting (India regions) · Identity & workspaces ·  │
│             Subscriptions & entitlements · Updates · Support · Observability   │
└───────────────────────────────────────────────────────────────────────────────┘
```

### 1.4 Long-term module map (MVP slice highlighted)
| Module | Full-OS scope | MVP slice (v0.3) |
|---|---|---|
| Court layer | Adapters for every HC, district establishment, tribunal and commission; official or licensed feeds | **Madras HC (Chennai) + Karnataka HC (Bengaluru)** adapters at A1; district courts at A0 (see §5) |
| Matter graph | Full litigation graph incl. appeals chains, connected matters, engagements, fees | **Core graph** (§2) without fees and engagements |
| Lawyer memory | Personal, chamber and matter memory; precedent bank; style | **Profile, working preferences, matter memory, court notes** (§3) |
| Prepare | Briefs, research integration (licensed), argument notes, bundles | **Preparation brief** with document context; no research corpus |
| Execute | Court-day view, live item tracking, hearing capture, chamber dispatch | **Court-day view + hearing capture**; live boards later ⚖ |
| Follow-up | Obligations, limitation, filings/defects, certified copies, client comms, fees | **Action and deadline queue**, defects and copies tracking, **client-update drafts** |
| Continuity | Handover, chamber delegation, practice analytics | **Matter timeline + handover note**; delegation for chamber plan |
| Drafting studio | Templates, style learning, Word add-in, consistency, citation checks | **Client updates + 2 templates + citation checker** |
| Client relationship (existing clients only) | Intake, conflict check, engagement, billing, status links (⚖) | Contacts and preferred language only |
| Platform | Multi-tenant SaaS, chamber admin, integrations, API | **Solo + chamber workspaces, subscriptions, support** |

**Never in any version:** public solicitation or marketing of lawyers, lead-gen, directories, autonomous legal advice, unverified citations, unsupervised filing, unauthorised court scraping (D-006, D-007, D-004, D-017, D-003).

---

## 2. The matter graph

### 2.1 Why a graph
Indian litigation is not "one case = one record". A single brief can include:
- a main petition plus interlocutory applications (e.g. W.P. with W.M.P.s at Madras HC, or I.A.s);
- an unnumbered stage before numbering (SR / diary numbers);
- connected or tagged matters heard together;
- an appeals chain (O.S. → A.S. → S.A.; W.P. → W.A.);
- multiple counsel and appearance roles, and orders spawning obligations with owners.

The OS models these relationships explicitly, so that preparation, follow-up and continuity are computed rather than remembered.

### 2.2 Core entities (MVP marked ●, later ○)
| Entity | Key fields | Notes |
|---|---|---|
| ● **Workspace** | id, type (solo / chamber), plan, region | The SaaS tenant (§6) |
| ● **Member** | user_id, workspace_id, role (owner / advocate / junior / clerk / viewer) | One user can belong to several workspaces (e.g. a junior in a senior's chamber plus their own practice) |
| ● **Matter** | title, practice area, client(s), status, opened_at, synopsis (memory-backed), owner, team | The *brief*: the unit the lawyer thinks in |
| ● **Proceeding** | forum_id, case_type, number, year, SR/diary no., CNR, filing date, stage, status, parent/child links | One case number in one forum. A matter has 1..n proceedings (main + IAs + appeals) |
| ● **Forum** | court, establishment, seat/bench (e.g. Madras HC Principal Seat / Madurai Bench), jurisdiction side (Original / Appellate), language profile, adapter_id | From the court layer |
| ● **CourtHall & Bench** | hall no., judge(s), roster period, portfolio | Roster changes affect listings |
| ● **Listing** | proceeding_id, date, list type (daily / advance / supplementary / special), stage heading (e.g. "For Admission", "For Orders", "Part Heard", "Fresh"), item no., hall, bench, source anchor | Created by the cause-list adapter or manually |
| ● **Hearing / Appearance** | listing_id, appeared_by (member / proxy / senior), capacity (AoR / arguing counsel / for X), outcome, adjournment reason, next date (proposed / confirmed), stage after | Captured mainly by voice |
| ● **Order** | document_id, date, bench, type (interim / final / procedural), neutral citation, operative directions[], next date | From document intelligence |
| ● **Obligation** | source (order direction / rule / registry defect / client / internal), description, due date, basis, owner, status, linked task(s) | Central to "fewer missed obligations" |
| ● **Task** | title, due, owner, status, fulfils obligation? | Work items |
| ● **Document** | kind (pleading, IA, annexure, order, judgment, cause list, correspondence, note, draft), language, version chain, source, text, anchors | Document intelligence output |
| ● **Person / Organisation** | name, aliases, roles; contacts only for existing clients and professional contacts | Parties (incl. "State rep. by Secretary…"), opposite counsel, government pleaders, clerks |
| ● **Role edge** | represents, appears_for, instructed_by (briefing counsel / AoR), assigned_to, opposes | Appearance realities |
| ● **Communication** | draft / sent-by-lawyer log, audience (client / senior / briefing counsel), language, linked hearing | Drafts only; the lawyer sends |
| ● **Authority** | citation string, resolved source, verification status, used_in documents | Citation-verification records |
| ○ Engagement / Fee | terms, invoices, receipts, client-money ledger | v1 (CA and ⚖ review) |
| ○ Filing | e-filing ref, defects, returns, cure deadlines | Tracked as obligations in the MVP; a dedicated entity in v1 |
| ○ Argument / Issue note | lawyer-authored issues, propositions linked to authorities | v1 drafting studio |

### 2.3 Graph invariants
1. **Provenance on every node and edge:** source (document + page/quote, voice transcript span, cause-list row, calendar event, manual), captured_at, confidence, confirmation state (proposed / confirmed / auto-applied / corrected).
2. **One canonical next date per proceeding.** It can change only by confirmation, or by a v1 opt-in corroborated rule (D-022).
3. **Obligations are never silently closed.** Closing one requires a task completion, a lawyer action, or an explicit "not applicable" with a reason.
4. **Workspace boundary:** no edge may cross workspaces. Shared matters (e.g. a junior's work in a senior's chamber) live in the chamber workspace, and the junior sees them through membership.
5. **Derived views only:** timeline, court-day view, briefs and queues are queries over the graph, not separate data.

---

## 3. Lawyer memory model

**The graph holds facts about matters. Memory holds what the OS learns about *how this lawyer practises*.** Memory is what makes the system more useful over time.

| Layer | Scope | Examples | How it's learned | Used for |
|---|---|---|---|---|
| **M1 Practice profile** | User | Enrolment no., bar council, courts, practice areas, chambers, languages | Onboarding + confirmed proposals | Defaults, filters, adapter selection |
| **M2 Working preferences** | User (per workspace) | Brief format, reminder times, client-update tone and language, how they sign, which items they always carry | Observed edits → proposed rules ("You always add 'carry vakalat copy' for first hearings. Save?") | Brief and draft generation |
| **M3 Matter memory** | Matter | Synopsis, key facts and dates, client instructions, strategy notes, what the bench said last time, open questions | Hearing captures + order digests → proposed synopsis updates; lawyer-authored notes | Preparation briefs, handover, continuity |
| **M4 Court & forum notes** | User (private), optionally chamber | Practical notes on halls and registry practice ("Hall 12 takes fresh admissions after lunch"; "registry returns for index format") | Lawyer-authored or confirmed proposals | Court-day view tips, follow-up rules |
| **M5 Playbooks & precedent bank** | User / chamber | Own templates, standard prayers, preferred formats per court, reusable passages from the lawyer's past drafts | Uploads + confirmed extraction | Drafting |
| **M6 Relationship memory** (existing clients and professional contacts only) | Workspace | Client prefers Tamil or Kannada updates; briefing counsel wants a WhatsApp summary after each hearing | Confirmed proposals | Communication drafts |
| **M7 Recognition memory** | User / workspace | Party-name aliases, the lawyer's shorthand for matters, case-number formats the lawyer writes by hand | Corrections to matching | Better matching and fewer confirmations over time |

**Rules (extending D-005):**
- Confirm before save, visible, editable and deletable. Memory is cited when it influences output and never used for training.
- Matter memory never crosses matters. Chamber-shared memory must be explicitly marked by the owner.
- **No bench profiling or judge analytics.** M4 holds only the lawyer's own practical notes. They are private by default, never aggregated across workspaces, and never AI-generated about individual judges ⚖.
- Memory review: a monthly "what I've learned about your practice" screen to prune stale items.
- **"More useful over time"** is measured by falling confirmation and correction rates by tenure, rising brief-open rates, and how often the lawyer accepts a brief unedited.

---

## 4. Automation, confirmation, and human judgement

The [automation ladder and approval matrix in 09 §4](09-zero-entry-automation-design.md#4-the-automation-ladder--approval-boundaries) apply unchanged: L1 capture, L2 propose, L3 auto-apply internal and reversible, L4 prepare outward for human send. **L5 has no code path.** Mapped to OS functions:

| Function | Automated (L1/L3) | Requires confirmation (L2/L4) | Must remain human |
|---|---|---|---|
| Court data | Parse user-supplied or permitted cause lists; fill item, hall, stage and bench for matched proceedings; attach orders | New proceedings from list rows; next dates; roster or bench changes affecting a matter | Deciding to appear, seek adjournment, mention or withdraw |
| Documents | OCR, classification, language detection, anchored extraction, de-duplication, version chains | Next dates, directions-as-obligations, deadlines, matter assignment when ambiguous | Legal interpretation of an order; whether to comply, appeal or seek modification |
| Preparation | Assemble the brief (last order, open obligations, documents, memory, court notes) | Synopsis updates to matter memory | Legal strategy, arguments, choice of authorities |
| Court day | Build the court-day view, clash detection, carry list, delegation suggestions | Delegation (chamber), item-tracking alerts (opt-in) | Advocacy |
| Hearing capture | Transcribe and structure voice notes; create undated tasks | Outcome, next date, obligations with dates | What was said and argued; professional record |
| Follow-up | Obligation queue, reminders, defect and copy tracking, stale-matter detection | Drafted client, senior and briefing-counsel updates (lawyer sends) | Advice to clients; commitments; fee terms |
| Drafting | Template fill from the graph; consistency check; citation resolution | Every export | Signing, verifying, filing; choosing and verifying authorities |
| Memory | Propose memories | Save memories | Deciding what the practice "knows" |

---

## 5. Court-adapter strategy (extensible)

### 5.1 Adapter interface
Each court or forum is supported by an adapter. Adapters are **mostly configuration plus small parsers**, versioned and hot-deployable server-side, so a format change never needs an app release (§6.6).

```
CourtAdapter {
  id, version, forum_ids[]
  access_modes: { cause_list, orders, status, display_board } →
       one of [user_supplied | device_user_triggered | official_feed | licensed | none]   (⚖ registry)
  nomenclature: case types, number/year formats, SR/diary formats, IA/connected-matter markers,
                Original vs Appellate side, neutral-citation pattern
  listing: list types (daily/advance/supplementary/special), stage headings → normalised stages,
           item-number rules, hall/bench headers, advocate-name columns
  order_parser: header fields (bench, date, case nos.), operative-part cues, next-date phrases (EN + regional),
                direction patterns ("counter in 4 weeks", "list after 2 weeks", "post for orders")
  calendar: working days, vacations/vacation benches, timings
  language_profile: primary (EN at HCs; Tamil / Kannada in subordinate courts), OCR/STT model choice
  links: deep-link builders to official status/order pages (no scraping)
  fixtures: golden documents + expected parses (CI)
  health: parse-yield monitors, last-verified date
}
```

### 5.2 Adapter maturity levels
| Level | Capability | MVP target |
|---|---|---|
| **A0 Known forum** | Forum, halls and nomenclature known; manual + voice + order parsing via the generic parser with confirmation | Bengaluru district and specialised forums; Chennai district courts |
| **A1 Document-assisted** | Court-specific parsing of **user-supplied** cause lists and orders; stage normalisation; high-precision matching | **Madras HC (Principal Seat), Karnataka HC (Bengaluru)** |
| **A2 Device-retrieved** | One-tap, user-triggered, on-device retrieval of *public* lists and orders, where terms permit ⚖ | Post-counsel review only |
| **A3 Official / licensed feed** | Sanctioned API or licensed data | Partnership track (v2+) |

### 5.3 Extensibility process ("adding a court")
1. Collect 30+ public sample lists and orders (fixtures).
2. Write the config: case types, stage headings, header regexes, language.
3. Add a parser only where config can't cover the format.
4. Golden tests in CI.
5. Record the access-mode registry entry with counsel's note.
6. Ship server-side; clients pick it up on the next sync.

**Generic fallback:** an LLM-assisted parse with mandatory anchors plus confirmation, for any forum without a dedicated adapter, so the OS works everywhere at A0.

### 5.4 Data-integrity posture for unreliable court data
- Court data always arrives as a *proposal with source and timestamp*, never as truth.
- Conflicting sources (voice vs order vs list) raise a conflict card.
- Parse-yield anomalies (zero matches, missing headings) trigger an in-app "couldn't read today's list for Hall X" banner with a link to the official page.

---

## 6. SaaS platform: Lawyer OS as a hosted, multi-tenant service

### 6.1 What "Lawyer as a Service" means here (and does not mean)
- **Means:** *Lawyer OS delivered as a service.* It is cloud software operated by us and subscribed to by advocates and chambers. It includes hosting, updates, court-adapter maintenance, security, backups and support. The lawyer's operating system is a service; **the lawyering is not**.
- **Does not mean:** legal services, legal advice, representation, a lawyer marketplace, lawyer-for-hire, or anything offered to the public or to litigants. We never hold out that the platform or its staff practise law. The platform never advises, represents, files, or communicates with clients or courts on anyone's behalf.
- **Naming rule:** in public materials, use "**Lawyer OS, cloud software for advocates**" or "**practice OS as a service**". Avoid the bare phrase "Lawyer as a Service", which a reader could take as an offer of legal services to the public. That would raise Rule 36 and unauthorised-practice concerns for any advocate associated with it (⚖, D-032).

### 6.2 Delivery model
- **Hosted SaaS only.** No on-premises or self-hosted customer deployments in the MVP or v1. One codebase and one operations team, with continuous updates. A **dedicated-tenant option**, still hosted by us in India, may come for large chambers later (v2+). Bring-your-own-key encryption is on the roadmap.
- Clients: Android and iOS apps (Expo), web app and installable PWA. A desktop shell comes later.

### 6.3 Tenancy & isolation
| Control | Design |
|---|---|
| Tenant unit | **Workspace** (solo practice or chamber). Users can belong to several, with a hard switch between them (no blended views by default) |
| Data isolation | Shared Postgres with `workspace_id` on every row and **row-level security** enforced in the database. PowerSync sync rules are derived from the same policy. Object storage has per-workspace prefixes with short-lived signed URLs. Search and vector indexes are always filtered by workspace in SQL |
| Encryption | TLS 1.2+. AES-256 at rest. **Per-workspace envelope keys** (KMS, India region) for documents and memory, so a workspace can be crypto-erased on deletion. BYOK later |
| AI isolation | The gateway carries tenant context. Retrieval is built per request from the workspace's own data. No cross-tenant caches of content, no shared fine-tunes, no training on customer data |
| Roles inside a workspace | Owner, Advocate, Junior, Clerk and Viewer roles. **Clerk** sees listings, tasks and documents but not strategy notes or matter memory by default. Per-matter restrictions for sensitive matters |
| Isolation assurance | Automated cross-tenant tests in CI (SQL, REST, sync, storage, vector search); pentest before launch and annually; tenant-isolation section in the security whitepaper |
| Noisy neighbours | Per-workspace AI and compute budgets; job-queue fairness |

### 6.4 India-region data posture
- **Primary:** AWS ap-south-1 (Mumbai), or Supabase in the same region (to confirm). **DR:** ap-south-2 (Hyderabad). Backups, logs and analytics are stored in India.
- **AI inference:** Bedrock India cross-region profile (Mumbai/Hyderabad), zero retention by default `[V]`. Any non-India processor is off by default and listed (India-only AI mode).
- **Sub-processor list, DPA, and roles:** the advocate or chamber is the Data Fiduciary for client and matter data; Lawyer OS is the Data Processor. For account and billing data, Lawyer OS is the fiduciary (⚖).
- **CERT-In:** 6-hour incident reporting, 180-day logs in India `[V]`. **DPDP:** breach runbook and 72-hour report, processor contracts, deletion SLAs, ahead of May 2027 `[R]`.

### 6.5 Subscription economics (SaaS)
| Plan | For | Includes | Test price (ex-GST) |
|---|---|---|---|
| **Junior** (free) | Students and juniors' personal workspaces | Up to 15 active matters; court-day view; hearing capture with a fair-use cap; memory M1–M3 | ₹0 |
| **Advocate** | Independent advocates | Unlimited matters; full capture and document intelligence; briefs; obligation queue; client drafts; both launch-court adapters | **₹499 / ₹799 / ₹1,199 per month** (annual ≈ 2 months free) |
| **Chamber** | 3–15 seats | Shared workspace, delegation, chamber court-day view, roles (incl. clerk), chamber memory, admin, priority support | **₹499 / ₹649 / ₹899 per seat per month**; clerk seat ₹199; minimum 3 seats |
| Dedicated (later) | Large chambers or firms | Dedicated hosted tenant, SSO, BYOK | Quote |

- **Unit costs:** ≈ ₹175 per active seat per month at full capture on the India-resident AI route; ≈ ₹10 per free workspace (capped) ([09 §9](09-zero-entry-automation-design.md#9-cost-implications-of-zero-entry)).
- **Gross margin target:** ≥ 70% at ₹649+ per seat.
- **Billing:** Razorpay Subscriptions with UPI Autopay and cards (e-mandate ≤ ₹15,000 without per-charge authentication `[R]`). We charge **18% GST** on our SaaS invoices, with chamber GSTIN capture for input credit. Dunning, grace periods, seat proration, annual plans and in-app entitlement checks are built in.
- **Distribution economics:** the free Junior workspace travels with the junior when they become independent, which creates a conversion loop to Advocate. Seniors pay for chamber seats.

### 6.6 Onboarding, updates, support
- **Onboarding:**
  - **Self-serve:** a solo advocate signs up, picks courts, then shares recent cause lists and orders, or imports a calendar or diary photos, and gets a confirm grid.
  - **Assisted, for chambers:** a 45-minute call or visit. We set up the workspace, invite members, assign roles, run a bulk import, and do a first court-day walkthrough.
  - Target: first court-day view within 24 h; full matter graph within 7 days.
- **Updates:**
  - Server continuous delivery with feature flags and staged rollouts.
  - Mobile over-the-air JS updates (Expo EAS Update) for non-native changes, plus store releases for native changes.
  - **Court adapters ship server-side as versioned config and parsers, with no app update needed.**
  - Backward-compatible sync schema so offline clients keep working; a public changelog.
- **Support:**
  - In-app help and a WhatsApp support line staffed on court days, 8–10:30 am and 6–9:30 pm IST.
  - A status page with an adapter-health section ("Madras HC list parsing: OK").
  - Support never sees tenant content by default. A **support session** requires a user-granted, time-boxed, audited consent.
  - SLAs: Advocate first response within 1 business day; Chamber within 4 court-day hours.
- **Offline behaviour (graceful):**
  - The court-day view, briefs and matter files for the next 7 days are cached on the device, encrypted.
  - Capture queues offline, and confirmations sync later.
  - Conflict handling follows [09 §7](09-zero-entry-automation-design.md#7-offline-behaviour-android-first-low-connectivity).
  - The service stays the system of record; offline support is a resilience feature, not a deployment mode.

### 6.7 Security & compliance roadmap
| Stage | Commitments |
|---|---|
| MVP | RLS isolation tests, per-workspace keys, MASVS-L1, pentest, CERT-In runbook, DPA and sub-processor list, India hosting, audit logs, 2FA for admins, passkeys or Google sign-in |
| v1 | DPDP readiness complete (before May 2027), ISO 27001 gap assessment, SSO for chambers, customer-visible audit export, annual pentest |
| v2 | ISO 27001 certification (or SOC 2 Type I), BYOK, dedicated tenant, data-retention policies per workspace |

### 6.8 Technical architecture (hosted)
```
 Clients (Android/iOS Expo, Web/PWA)  ── SQLite cache + PowerSync client (offline)
          │ HTTPS (TLS) · auth tokens scoped to workspace
          ▼
 Edge/API (Node/TS, Mumbai) ─ auth (Supabase Auth/OIDC), workspaces & roles, uploads (signed URLs),
          │                    entitlements, billing webhooks (Razorpay), support-session broker
          ├── PowerSync service (sync rules from RLS policy)
          ├── Postgres (Mumbai; PITR; DR replica Hyderabad) — matter graph, memory, audit; RLS
          ├── Object storage (Mumbai; per-workspace prefixes; KMS envelope keys)
          ├── Job queue (pg-boss) → Workers: document intelligence, speech, matching, briefs, notifications
          ├── Court-adapter service (versioned config + parsers; fixtures; health monitors)
          └── AI gateway (routing, budgets, India-only mode, audit) → Bedrock India · Sarvam · IK API
 Observability: logs/metrics in India (180d+), error tracking w/ PII scrub, adapter-health & automation dashboards
```
