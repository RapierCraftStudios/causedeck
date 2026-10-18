# 04 — MVP Definition: The First Vertical Slice of Lawyer OS

Version 0.3 · 2026-10-17 · Status: Proposed, gated by Stage 0 ([07](../validation/07-validation-plan.md)).
References:
- Requirement IDs: [PRD v0.3](../product/03-prd.md)
- Architecture: [10](../product/10-lawyer-os-system-architecture.md)
- Capture and automation rules: [09](../product/09-zero-entry-automation-design.md)
- Courts: [11](../strategy/11-launch-markets-madras-hc-bengaluru.md)

> **This MVP is a vertical slice of Lawyer OS, not a data-entry product** (D-024).
> - It contains a thin but complete version of every OS layer: SaaS platform, court layer, matter graph, lawyer memory, document intelligence, and the prepare → execute → follow-up → continuity loop.
> - It covers two launch courts: the **Madras HC Principal Seat** and the **Karnataka HC Principal Bench (Bengaluru)**.
> - Everything left out is left out because of **sequencing**. The long-term vision is unchanged (D-034).

---

## 1. The slice in one sentence
**For an independent advocate or a young chamber at the Madras High Court or in Bengaluru's courts, Lawyer OS:**
- turns the court's own lists and orders, plus the lawyer's voice and documents, into a living map of every matter;
- prepares each appearance;
- runs the court day;
- keeps every obligation that a hearing creates;
- learns how this lawyer practises.

The lawyer stays the one who judges, advises, argues, files and sends.

## 2. Slice definition by layer

| OS layer | Full vision ([10 §1.4](../product/10-lawyer-os-system-architecture.md#14-long-term-module-map-mvp-slice-highlighted)) | **MVP slice** | Key reqs |
|---|---|---|---|
| SaaS platform | Multi-tenant, SSO, BYOK, dedicated tenants, API | Solo and Chamber workspaces; roles incl. restricted clerk; RLS + per-workspace keys; Mumbai/Hyderabad hosting; subscriptions; OTA updates; support; 7-day offline cache | PL-1–PL-8 |
| Court layer | Adapters for all forums; official feeds | **A1:** Madras HC (Principal Seat), Karnataka HC (Bengaluru). **A0:** Chennai and Bengaluru district courts, tribunals, commissions (generic parse + confirm). Access-mode registry | CL-1–CL-7; CL-8 (late) |
| Matter graph | Full litigation graph incl. fees and engagements | Matter → proceedings (main, misc./IAs, connected, appeal links; SR/FR stage) → listings → hearings/appearances → orders → obligations → tasks; documents; people & roles; provenance | MG-1–MG-6 |
| Lawyer memory | M1–M7 incl. precedent bank, style | M1 profile, M2 preferences, M3 matter memory, M4 private court notes, M6 relationship (existing clients), M7 recognition; confirm-before-save; monthly review | ME-1–ME4 |
| Document intelligence | OCR, extraction, translation, chat, bundles | Text-first + OCR (EN/TA/KN); classification; anchored order extraction; matter-scoped context retrieval | DI-1–DI-4 |
| Prepare | Briefs, research integration, argument notes | **Preparation brief per listing** + matter timeline + research link-outs | PR-1–PR-4 |
| Execute | Court-day ops, live tracking, dispatch | **Court-day view** (complex → hall → item), list diffs, **voice hearing capture**, chamber delegation, reminders | EX-1–EX-5 |
| Follow-up | Obligations, limitation, filings, comms, fees | **Obligation and deadline queue**, defects/returns/SR tracking, certified copies, drafted next steps, **client/senior/briefing-counsel update drafts (EN/TA/KN)**, stale-matter detection | FU-1–FU-5 |
| Continuity | Handover, delegation, analytics | **Handover note**, "what changed", member offboarding, junior's personal workspace | CO-1–CO-4 |
| Drafting | Studio, Word add-in, style | 2 templates per launch court (mention/adjournment memo; client covering letter), consistency check, **citation checker** | DR-1–DR-4 |
| Trust | Full governance | L1–L4 automation only (no L5); activity feed with Undo; AI audit; outward-action log | TR-1–TR-4 |

## 3. Inputs (low-entry, lawyer-owned first; D-029)

| Input | How | MVP |
|---|---|---|
| **Cause lists** | Madras HC Registry email push via AIMS (forwarded or sent to a private intake address); Karnataka HC list HTML/PDF shared by the lawyer; any shared PDF | ● |
| **Orders & judgments** | Shared PDFs (JUDIS daily orders, KHC orders, district orders) | ● |
| **Voice notes** | In-app, after hearings (EN/TA/KN/mixed) | ● |
| **Own documents** | Pleadings, drafts, annexures; bulk web import (≤ 200 files) | ● |
| **Calendar** | `.ics` import; private ICS export feed | ● |
| **Diary / notebook photos** | Camera → OCR → proposals | ● |
| **Email** | Forward-in address for registry, e-filing and briefing-counsel mail (sender allow-list) | ◐ late |
| **WhatsApp exports** | "Export chat" files of **internal** chamber or clerk groups only; preview + per-message exclusion | ◐ late |
| Client WhatsApp chats | Excluded by default; explicit per-item choice under counsel-approved guidance | ○ |
| **Manual correction** | Everywhere | ● |

## 4. Outputs that change the lawyer's day

| Output | What it contains | When |
|---|---|---|
| **Court-day operating view** | Complex → hall → list → item, stage, bench; clashes; who appears (chamber); carry lists; deep links to official status pages | 8 pm (eve), 7 am diff, live through the day |
| **Preparation brief** (per listing) | Stage; last order (2–3 lines, page link); open obligations and status; documents to carry; matter synopsis (M3); last-hearing note; private court notes (M4); "readiness" check | With the court-day view; kept current for likely-reached matters (Karnataka 1-day notice) |
| **Matter timeline** | Across proceedings: filings, SR/FR → numbered, listings, hearings, orders, obligations, communications | On demand |
| **Action & deadline queue** | Obligations by due date and owner, each with source line and a drafted next step | Daily, plus reminders |
| **Document context** | Anchored passages from the matter's documents, surfaced inside briefs and obligations | On demand |
| **Update drafts** | Client (in the client's language), senior, briefing counsel; the lawyer edits and sends | After hearings and orders |
| **Handover note** | Synopsis, stage, last orders, open obligations, upcoming listings, key documents, open questions | One tap |
| **Memory that compounds** | Proposals the lawyer confirms; a monthly "what I've learned" review; fewer corrections over time | Continuous |

## 5. What is automated, confirmed, or human
The full matrix is in [10 §4](../product/10-lawyer-os-system-architecture.md#4-automation-confirmation-and-human-judgement). In summary:
- **Automated (L1/L3, reversible, internal):**
  - list parsing and matching to known proceedings;
  - hall, item, stage and bench fills;
  - order attachment and extraction;
  - transcription;
  - undated tasks;
  - brief assembly;
  - stale-matter detection;
  - clash detection.
- **Confirmed (L2/L4):**
  - new proceedings and matters;
  - next dates;
  - obligations with dates;
  - matter-memory updates;
  - delegation;
  - every outward draft (client, senior, counsel);
  - every export.
- **Human only:**
  - legal judgement and strategy;
  - advice;
  - advocacy;
  - choosing and verifying authorities;
  - accepting engagements and making commitments;
  - filing and signing;
  - sending any communication.
- **No L5 code path exists.**

## 6. Excluded from the MVP (sequencing only; all remain on the roadmap; D-034)

| Deferred | Why later | Target |
|---|---|---|
| Licensed research integration, argument notes | Needs content partnerships; D-001 | v2 |
| Drafting studio, template library, style learning, Word add-in | The slice proves the loop first | v1–v2 |
| Fees, invoices (GST/RCM), client-money ledger | CA and ⚖ review | v1 |
| Limitation engine | Counsel-reviewed rule tables | v1 ⚖ |
| Live display-board tracking | Permission + stage-legend learning | v1 ⚖ |
| A2 device retrieval (Karnataka HC public list), A3 feeds | Written authorisation pending | v1+ ⚖ |
| Madurai Bench, Dharwad/Kalaburagi, other states | Separate adapters | v2 |
| NCLT Bengaluru A1 | After HC adapters stabilise | MVP-late / v1 |
| Tamil and Kannada **UI** (content is already EN/TA/KN) | Localisation effort | v1 |
| Calendar OAuth; opt-in WhatsApp bot | Privacy and verification overhead | v1 ⚖ |
| Client status links; intake and conflict check | ⚖ | v2 |
| Native desktop; SSO; BYOK; dedicated tenant | Platform maturity | v1–v2 |
| Practice analytics | Needs data volume | v2 |

**Permanently out (not sequencing):**
- public solicitation or marketing;
- autonomous advice;
- unverified citations;
- unsupervised filing;
- unauthorised scraping;
- judge analytics.

## 7. Pricing & packaging (SaaS; D-031; test in E2 and E3)

| Plan | Who | Includes | Test price (ex-GST) |
|---|---|---|---|
| **Junior** | Students, juniors' personal practice | ≤ 15 active matters; court-day view; briefs; capture (fair use); memory M1–M3 | Free |
| **Advocate** | Independent advocates | Unlimited matters; both A1 adapters + A0; full capture and document intelligence; briefs; queue; drafts; handover; memory | **₹499 / ₹799 / ₹1,199 per month**; annual ≈ 2 months free; founding pre-order ₹7,999/yr |
| **Chamber** | 3–15 seats | Shared workspace; delegation; chamber court-day view; roles incl. **clerk seat ₹199**; shared memory (opt-in); assisted onboarding; priority support | **₹499 / ₹649 / ₹899 per seat per month** (min 3) |

**Economics** (estimates):
- **Variable cost:** ≈ ₹175 per active seat per month on the India-resident AI route; deterministic-first parsing keeps list processing ≈ ₹0.50 per list.
- **Free workspace:** ≤ ₹10 per month (capped).
- **Margins:**
  - ₹799 Advocate: net ≈ ₹658, about 73% margin.
  - ₹649 seat: net ≈ ₹535, about 67% margin.
  - Clerk seats are near break-even. They are justified because they drive chamber adoption.
- **Billing:** Razorpay subscriptions with UPI Autopay; 18% GST invoices with GSTIN capture.

## 8. Distribution (merit-led and compliant)
1. **Court-by-court density.**
   - Each A1 adapter makes the next advocate at that court productive on day one.
   - Demos run in bar-association libraries and chambers (with permission).
   - Chennai: **AIMS-onboarding help sessions** ("get your court's cause list by email, then let Lawyer OS prepare you").
2. **Chamber → junior loop.** Chamber seats put juniors on the OS. Their free personal workspace travels with them into independent practice, where it converts to the Advocate plan.
3. **Artefacts that travel inside the profession.** Handover notes and court-day views are shared *within* workspaces. Optional, off-by-default "Prepared with Lawyer OS" footers appear on internal exports only, never on client-facing or court documents.
4. **Alumni and education channels.** Law-school alumni networks (NLSIU, TNNLU, Chennai and Bengaluru colleges); CLE-style talks on safe AI use after the 2026 SC citation rulings (education, not solicitation).
5. **Referral credit.** Software credit for referring another workspace. Never tied to legal fees (D-006, L3 risk).
6. **Never:** marketing advocates' services, directories, lead-gen, or influencer promotion of lawyers.

## 9. The marketable demo
**Format:** 7 minutes, live on a phone plus a laptop. It uses a **synthetic but court-faithful** dataset: real nomenclature and list and order layouts, with fictional parties. There is a Chennai version and a Bengaluru version.

| Min | Beat | Shows |
|---|---|---|
| 0:00 | "Here is tonight's Madras HC cause list as it arrived from the Registry email." Forward it | Court layer (A1), sanctioned input |
| 0:45 | The court-day view appears, grouped by hall and item, with a clash flagged across two halls | Execute |
| 1:30 | Open a WP listed "for admission" with two WMPs and a connected matter. **Brief:** last interim order (tap to the page), counter not yet filed (due Friday), carry list, the lawyer's own note on this hall | Matter graph + Prepare + Memory (M3/M4) |
| 2:45 | "Court is done." Voice note in Tamil-English: "Notice ordered, counter in four weeks, list after that." Proposals appear; one tap confirms the date and obligations | Execute + Follow-up |
| 3:45 | Share the order PDF. Directions are extracted with anchors; one direction the voice note missed is flagged | Document intelligence, conflict handling |
| 4:30 | **Ready to send:** client update in Tamil and a note to briefing counsel, both drafted. The lawyer edits and sends from their own WhatsApp | Follow-up (L4) |
| 5:15 | Action queue: a defect cure on an SR matter due tomorrow, a certified copy pending | Kept obligations |
| 5:45 | **Handover note** for a matter going to a junior; "what changed" for a matter untouched for 5 weeks | Continuity |
| 6:15 | Memory proposal: "You always carry the vakalat copy for first listings. Save?" Then the activity feed with Undo, and India hosting and roles | Memory, trust, SaaS |
| 6:45 | Close: "Every layer you saw gets deeper: research integration, drafting studio, limitation, billing, more courts" | Expandable OS |

**Success criterion for the demo (H-DEMO):** ≥ 40% of viewers request a pilot.

## 10. The two-week concierge pilot
Full protocol: [07 E2](../validation/07-validation-plan.md#e2--two-week-concierge-pilot-of-the-whole-os-loop-weeks-23-optional-extension-to-week-5).

**Cohort:** 2 cities × (5 independents + 2 chambers).

**Day 0:** consent and onboarding. AIMS registration and case tagging (Madras). Lists and orders shared (Bengaluru). We build the matter graph and send a confirm grid.

**Days 1–12, every OS engine runs by hand with AI assistance:**
- evening court-day view and briefs;
- morning diffs;
- voice → outcome cards;
- order → obligations;
- daily queue and update drafts;
- memory proposals on Day 5 and Day 10;
- handover drill on Day 11.

**Days 13–14:** Practice Report (preparedness, obligations, load, continuity), then a paid-continuation offer.

## 11. Proof-of-value metrics (D-030)
- **North star: the Prepared & Kept rate.**
- **Supporting metrics:**
  - brief completeness;
  - brief opened before the hearing;
  - self-rated preparedness;
  - missed-obligation rate;
  - capture completeness;
  - cognitive-load score;
  - time-to-context;
  - handover success;
  - correction rate by tenure;
  - L3 undo rate;
  - paid continuation;
  - chamber seat expansion.
- **Secondary:** typed-field share and minutes saved.
- Targets are in [PRD §10](../product/03-prd.md#10-success-metrics).

## 12. Build vs buy (SaaS)

| Component | Decision | Choice |
|---|---|---|
| Clients | Build | Expo (Android/iOS) + web/PWA; share intent; offline SQLite cache |
| Sync | Buy (exit to self-host) | PowerSync |
| DB, auth, storage | Buy | Postgres in Mumbai (Supabase or AWS RDS); DR in Hyderabad; KMS per-workspace keys |
| **Court adapters** | **Build** (core IP) | Config + parsers + fixtures + health monitors; server-side deploy |
| **Matter graph & memory** | **Build** (core IP) | Postgres + pgvector; RLS; provenance tables |
| Document intelligence / speech | Buy via gateway | Bedrock India (Claude), Sarvam (Tamil/Kannada OCR and STT); deterministic parsers first |
| Citation resolution | Buy | Indian Kanoon API + official neutral-citation links |
| Email intake | Buy / self-host | India-region inbound mail (verify provider region) |
| Billing | Buy | Razorpay subscriptions + GST invoicing |
| Support & status | Buy | WhatsApp Business app, status page, help centre |
| Legal | Buy | Counsel: ToS, DPA, access-mode memo, client-content guidance, public wording ⚖ |

## 13. Operating costs (estimates; FX ₹90/USD; ex-GST)

| Line | Pilot (≤ 30 seats) | Beta (≈ 300 paid seats + 1,000 free) | Growth (≈ 3,000 paid seats + 10,000 free) |
|---|---|---|---|
| Fixed (DB + DR, sync, VMs, mail, storage, KMS, monitoring, store accounts) | ≈ ₹10,000 | ≈ ₹25,000 | ≈ ₹1–1.5 lakh |
| Variable (₹175 per paid seat; ₹10 per free) | ≈ ₹7,500 (pilot heavy use ≈ ₹250/seat) | ≈ ₹62,500 | ≈ ₹6.25 lakh |
| Adapter maintenance (engineering time, not cash) | — | ~20% of one engineer | ~1 engineer |
| **Total cash / month** | **≈ ₹17,500** | **≈ ₹0.9 lakh** | **≈ ₹7.3–7.8 lakh** |
| Revenue at a blended ₹600 net per seat | — | ≈ ₹1.8 lakh | ≈ ₹18 lakh |

**One-off costs:**
- counsel: ₹2.5–4 lakh (adds the access-mode memo, client-content guidance and public wording);
- pentest including multi-tenant isolation: ₹1.5–2.5 lakh;
- ISO 27001 gap assessment (v1): ₹1–2 lakh.

## 14. Roadmap (OS-first)

| Stage | Window | Goal | Gate |
|---|---|---|---|
| **0: Validate the loop** | Weeks 0–5 | E1 baseline audit → E2 two-week concierge OS pilot (both cities) → paid continuation; E3 demo + MaxDiff; E5 adapter spikes; letters to the Registries ⚖ | H-PREP, H-OBLIG, H-VALUE + (H-WTP-S or H-WTP-C) + H-ADAPT (≥ 1 court) |
| **1: Build the slice** | Weeks 6–19 | Milestones M1–M5 ([08](../engineering/08-repo-structure-and-backlog.md)) | All MVP Musts; adapter accuracy; isolation tests; pentest; counsel sign-off |
| **2: Paid launch, two cities** | Months 5–8 | Pilot workspaces migrate; open self-serve (Advocate) + assisted chambers | Prepared & Kept ≥ target; paid continuation ≥ 40%; seat expansion ≥ 1.3× |
| **3: v1 — Deepen the OS** | Months 8–14 | Drafting studio v1, limitation (⚖), fees/invoices (⚖), live tracking (⚖), A2 retrieval (if authorised), NCLT A1, roster import, Tamil/Kannada UI, SSO, ISO gap | Gross margin ≥ 65%; L3 undo ≤ 3%; correction rate falling by tenure |
| **4: v2 — Expand the OS** | Months 14–24 | Madurai, Dharwad, Kalaburagi; licensed research integration; client status links and intake (⚖); practice analytics; dedicated tenant / BYOK; next states via adapter process | Adapter add-time ≤ 4 weeks per court |

## 15. What would change this slice (not the identity)
| Signal | Response |
|---|---|
| H-PREP passes but H-OBLIG fails | Lead with preparation briefs; rework obligation capture |
| H-OBLIG passes but H-PREP fails | Lead with the obligation queue; slim the briefs |
| One city's adapter fails T6 | Launch the other city first |
| Chambers convert, solos don't | Chamber-first go-to-market; Advocate plan priced as an upgrade path |
| SaaS trust objections (H-SAAS fails) | Bring forward dedicated tenant / BYOK; publish a security whitepaper earlier |
