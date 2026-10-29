# Decision Log

Format: each entry records the decision, its date, its status (Proposed / Accepted / Superseded / Revisit), the evidence behind it, the alternatives considered, and the condition that would make us revisit it.
"Accepted" here means accepted for planning by the research lead. Every decision is still open to founder review. Items marked **⚖** need review by a qualified Indian advocate before launch.

---

### D-001 — Do not compete on legal-research content
- **Date:** 2026-10-17 · **Status:** Accepted
- **Decision:** We will not build or license a case-law corpus or a citator for the MVP. We link out to official sources and Indian Kanoon, and use the Indian Kanoon API only for lookups that verify citations.
- **Evidence:** The incumbents' moat is editorial content and citators: SCC Online, Manupatra, CaseMine, Lexis, and Legora's partnership with Manupatra ([03](research/raw/03-global-comparators.md) §1.10, [01](research/raw/01-indian-research-platforms.md) §10). Copying editorial content is barred by *EBC v. D.B. Modak* ([04](research/raw/04-regulatory-ethics.md) §6). Indian Kanoon Premium already costs ₹5,000/yr.
- **Alternatives:** Build a research corpus from open judgment datasets (Dattam Labs, CC-BY-4.0). Rejected for the MVP because it is costly to maintain, offers no differentiation and carries hallucination liability.
- **Revisit if:** Interviews show research is the top-paid pain for the segment *and* a licensed data partnership becomes available cheaply.

### D-002 — Wedge = the litigator's daily hearing diary, not AI chat
- **Date:** 2026-10-17 · **Status:** **Superseded in framing by D-016** (2026-10-17). The diary stays as the data substrate; the wedge and the pitch are now zero-entry convenience.
- **Decision:** The MVP is a mobile-first matter and hearing diary built around three moments: "what's on tomorrow", "what happened today" and "what do I owe whom". AI is embedded inside those moments, not offered as a standalone chatbot.
- **Evidence:** Next-date volatility (adjournments take a large share of court time; DAKSH; "tareekh pe tareekh"). The official eCourts app is rated 2.4★ on iOS, with complaints about lost cases and offline access being removed. The long tail of diary apps has no AI. Free ChatGPT is the real AI competitor ([03](research/raw/03-global-comparators.md) §3). A diary is used daily; research is episodic.
- **Alternatives:** Lead with an AI drafting assistant (crowded: Jhana, Draft Bot Pro, CaseMine AMICUS, Prism DocGen), an AI research tool (incumbent moats) or a CRM (regulatory risk).
- **Revisit if:** Fewer than 40% of interviewed juniors say hearing/date tracking is a top-3 weekly pain.

### D-003 — No scraping-at-scale; user-initiated court data lookups only
- **Date:** 2026-10-17 · **Status:** Accepted · **⚖**
- **Decision:** Case status is fetched only on an explicit user action, for that user's own matters, either on the device or through a rate-limited relay. We will not build a bulk crawler, will not automate captcha-solving server-side at scale, and will not republish court records. Manual entry and "paste from eCourts / order PDF" are first-class paths.
- **Evidence:** There is no official public API, and the portal sits behind a captcha. The legality of automated access and the eCourts terms are unverified. Party data is personal data under DPDP ([02](research/raw/02-indian-practice-management-and-legaltech.md) §1, [04](research/raw/04-regulatory-ethics.md) §6).
- **Alternatives:** A licensed reseller API (Surepass, eCourtsIndia; their sourcing is undisclosed). Bulk scraping in the style of competitors. Both are deferred until we have legal advice.
- **Revisit if:** NIC/eCommittee opens a sanctioned API or data-sharing route, or counsel clears a specific approach.

### D-004 — Verification-first AI: no free-form citations, ever
- **Date:** 2026-10-17 · **Status:** Accepted
- **Decision:** Every citation in AI output must resolve to a retrievable source document (official PDF, Indian Kanoon doc, or a user-uploaded file). If it cannot, the UI shows it as UNVERIFIED and blocks export unless the user takes an explicit override action, which is logged. Drafting templates contain no authorities unless the user inserts them.
- **Evidence:** The Supreme Court treats unverified AI citations as misconduct (*Pooja Ramesh Singh v. J&K Bank*, 2 Jul 2026, as reported). Stanford measured 17–34% hallucination in commercial legal RAG tools. There are ~1,600 hallucination cases worldwide.
- **Revisit if:** Never relaxed; only strengthened.

### D-005 — Lawyer memory is explicit, scoped, inspectable
- **Date:** 2026-10-17 · **Status:** Accepted
- **Decision:** Memory has three classes: (a) **Profile & style** (per user), (b) **Matter memory** (per matter, never crosses matters or clients), (c) **Playbooks/templates** (per user, later per chamber). Saves are confirmed by the user, memories are viewable, editable and deletable, the source is cited when a memory is used, and memory is never used to train models. It is stored as structured rows in our own database, not inside a vendor's memory service.
- **Evidence:** Harvey Memory design (Aug 2026), PersistBench leakage findings, and BCI Rules 17/24 together with BSA s.132 on confidentiality ([03](research/raw/03-global-comparators.md) §4, [04](research/raw/04-regulatory-ethics.md) §2).
- **Alternatives:** Mem0/Zep/Letta as hosted memory. Rejected for the MVP: client confidentiality, cost and vendor lock-in.

### D-006 — CRM/marketing restricted to existing-client relationship management
- **Date:** 2026-10-17 · **Status:** Accepted · **⚖**
- **Decision:** We will never build prospect outreach, lead generation, a public directory, ratings or testimonials, ad or SEO tooling, influencer tooling, or referral or commission flows. The future "CRM" covers only existing clients and professional contacts: intake of *inbound* enquiries, conflict checks, matter updates and fee reminders. Any public profile is limited to the Rule 36 Schedule fields, controlled by the advocate and hosted on the advocate's own domain, and only after counsel review.
- **Evidence:** BCI Rule 36. The Madras HC order of July 2024 against aggregators, now pending in the SC. BCI's 17 Mar 2025 release. State bar notices in 2025 ([04](research/raw/04-regulatory-ethics.md) §1, table §8).

### D-007 — Product is a tool for enrolled advocates; no consumer legal advice
- **Date:** 2026-10-17 · **Status:** Accepted · **⚖**
- **Decision:** Users are advocates, law-firm staff and law students. We build no public-facing "ask a lawyer AI". Client-portal features, when they exist, only relay what the advocate has chosen to send.
- **Evidence:** The unauthorised-practice-of-law question is unsettled in India; Rule 37 bars advocates from lending their name to such services; privilege does not attach to AI chats ([04](research/raw/04-regulatory-ethics.md) §4).

### D-008 — Cross-platform via one TypeScript codebase; desktop = web/PWA first
- **Date:** 2026-10-17 · **Status:** **Superseded by D-036** (Next.js web/PWA-first full-stack monorepo; native mobile deferred)
- **Decision:** Build on Expo (React Native) for Android, iOS and web. Desktop starts as an installable PWA served from the web build. A Tauri wrapper comes later, only if demand for offline desktop use is proven.
- **Evidence:** See [06](research/raw/06-tech-stack-and-costs.md) §1. Android has ~94% share in India; consumer PC shipments are only ~7M/yr nationally, so laptops can't be assumed ([05b](research/raw/05b-workflows-deep-dive.md) §3).
- **Update (2026-10-17, synthesis):** Status → **Accepted for Stage 0 spikes** (T5 perf test on a low-end Android device decides). iOS is TestFlight-only for the pilot.
- **Revisit if:** Native-feel tests on low-end Android fail, or the team's skills favour Flutter.

### D-009 — Data residency: primary data and logs in India
- **Date:** 2026-10-17 · **Status:** Accepted
- **Decision:** Host the primary database, object storage and logs in Indian regions. Use LLM providers only under no-training, zero- or short-retention terms, preferring India-region endpoints where they are available at acceptable cost. Publish a sub-processor list.
- **Evidence:** CERT-In requires 180-day logs kept within Indian jurisdiction. DPDP Rule 15 permits transfers unless restricted, but possible localisation for Significant Data Fiduciaries and the confidentiality optics favour India hosting ([04](research/raw/04-regulatory-ethics.md) §3).

### D-010 — Pricing hypothesis: freemium + low INR subscription, UPI-first
- **Date:** 2026-10-17 · **Status:** **Price arms superseded by D-021**; freemium + UPI-first still stands
- **Decision:** Free tier for students and juniors (limited matters, limited AI). "Pro" plan to be tested at ₹199 / ₹299 / ₹499 per month, with annual discounts. A chamber plan comes later.
- **Update (2026-10-17, synthesis):** The unit-cost model ([MVP §6](docs/mvp/04-mvp-definition.md#6-expected-operating-costs)) gives ≈ ₹100 of variable cost per Pro user on the India-resident AI route. ₹199 leaves too thin a margin, so the test arms are now **₹299 / ₹399 / ₹499** per month (annual ₹2,999–3,999). Founding-member pre-order is ₹1,999/yr. Collection via web checkout (UPI Autopay / Razorpay) to avoid the 15% app-store fee where store policy allows.
- **Evidence:** Juniors earn under ₹10k/month (79% of those with under 2 years' practice, per the Vidhi survey cited in a PIL). Anchors: Indian Kanoon Premium ₹5,000/yr, CaseMine ₹12,999/yr, diary apps about ₹400/month ([05](research/raw/05-indian-lawyer-workflows-market.md) §2, [01](research/raw/01-indian-research-platforms.md) §10).

### D-011 — eCourts lookup is device-side and user-driven (if cleared)
- **Date:** 2026-10-17 · **Status:** Proposed · **⚖**
- **Decision:** The only automated court-data path in the MVP is an in-app browser to the official portal. The *user* solves the captcha, and the app parses the result page on the device, with consent. Results are proposals, never auto-confirmed. No server-side requests to eCourts.
- **Evidence:** D-003 risks; open-source SDKs show the pages are parseable ([02](research/raw/02-indian-practice-management-and-legaltech.md) §1).
- **Revisit if:** Spike T1 parse success < 90%, or counsel advises against it. Fallback: manual entry, PDF and voice only.

### D-012 — Launch in one court ecosystem (default: Delhi district courts + Delhi HC)
- **Date:** 2026-10-17 · **Status:** **Superseded by D-025** (Madras HC + Bengaluru)
- **Decision:** Stage 0 interviews and the pilot focus on one metro's district courts and High Court. Delhi is the default because of density, Hindi and English, eCourts coverage and the HC display board. Swap to Bengaluru or Mumbai if the founders' network is stronger there.
- **Evidence:** Local variation in cause-list formats, forums and language; chamber word-of-mouth is local [inference]. A-14.

### D-013 — Voice note + order digest are the two MVP AI jobs; drafting is template-bound
- **Date:** 2026-10-17 · **Status:** **Superseded by D-020** (the MVP AI work is now the full capture→extract pipeline across channels; drafting is reduced to updates plus one template)
- **Decision:** The MVP's AI budget goes to (1) post-hearing voice → structured update and (2) order PDF → anchored digest. Drafting is limited to template narrative blocks, with no authorities. The citation checker and consistency check run deterministic-first.
- **Evidence:** AI opportunity matrix scores ([05](docs/strategy/05-competitor-and-ai-matrices.md) §B). Cost per action ≈ ₹0.9–5 ([04](docs/mvp/04-mvp-definition.md) §6.1).

### D-014 — Pilot billing via payment links, not in-app purchases
- **Date:** 2026-10-17 · **Status:** Accepted
- **Decision:** Founding-member plans are sold through a Razorpay payment link with manual or webhook entitlement. Subscriptions with UPI Autopay come at public beta, after a Play policy check (A-13).
- **Evidence:** Razorpay charges 2% + GST against Play's 15% ([06](research/raw/06-tech-stack-and-costs.md) §6). Validating WTP early (H7) matters more than billing automation.

### D-015 — Stage 0 gate before any production code
- **Date:** 2026-10-17 · **Status:** **Superseded by D-041** (founder directs a full build in parallel with validation)
- **Decision:** Only spikes T1–T5 and the repo scaffold are built before the end-of-week-4 gate. GO, GO-WITH-CHANGES or PIVOT is decided on the H1–H12 thresholds in [07](docs/validation/07-validation-plan.md).
- **Update (2026-10-17, v0.2):** The gate moves to **end of week 5** so it covers E1 (baseline) → E2 (3-week concierge) → paid continuation. Spikes T6 (cause-list parse) and T7 (share intent) are added. The gate uses the v0.2 hypotheses (H-TIME1, H-ENTRY, H-CONV, H-WTP2 primary).
- **Evidence:** There is no primary workflow or WTP evidence yet ([01](docs/strategy/01-research-report.md) §7).


---

## v0.2 decisions — Zero-entry / quality-of-life reframing (founder direction, 2026-10-17)

### D-016 — The willingness-to-pay driver is quality of life and convenience (zero-entry)
- **Date:** 2026-10-17 · **Status:** **Superseded in framing by D-024 and D-030.** Convenience and low-entry capture remain a design principle of the capture subsystem ([09](docs/product/09-zero-entry-automation-design.md)). They are not the product's identity or the primary proof of value.
- **Decision:** We position and price Lawyer OS as the tool that **removes non-courtroom admin**: capture what already arrives (voice, WhatsApp forwards, PDFs, cause lists, emails, existing documents), and automatically produce matters, dates, tasks, people, fees, drafts, client updates, daily briefs and follow-ups. Data, AI and memory are the machinery, not the pitch. The lawyer stays the decision-maker and the advocate in court.
- **Evidence:**
  - free "good-enough" data (eCourts, Indian Kanoon) and AI (ChatGPT) already exist [R];
  - the munshi role is unaffordable for juniors (₹15–30k/month, vendor claim) [R];
  - we have no primary time-use evidence yet, which is why E1/E2 come first.
- **Supersedes:** the framing in D-002. D-001 and D-003–D-009 stand unchanged.
- **Revisit if:** H-CONV fails (convenience is not the #1 value in MaxDiff), or H-TIME1 < 20 min saved per court day.
- **Design:** [09](docs/product/09-zero-entry-automation-design.md).

### D-017 — Automation ladder and approval boundaries (L0–L5; L5 prohibited)
- **Date:** 2026-10-17 · **Status:** Accepted · **⚖** (boundary list for counsel review)
- **Decision:** Every automated action has a level:
  - L1 capture;
  - L2 propose (date-critical, financial and identity data);
  - L3 auto-apply internal reversible changes with undo (attachments, list fills, undated tasks);
  - L4 prepare outward actions that the lawyer sends, signs or exports.
  - **L5 (autonomous outward or legal action) has no code path:** no auto-sending to clients or third parties, no filing, advice, engagement acceptance, commitments, payments or generated authorities.
  - A corroborated auto-confirm of dates is reserved for a v1 experiment (D-022).
- **Evidence:** BCI Rules 17/24/36/37 [V]; SC 2026 misconduct rulings on AI citations [R]; risk A1 (wrong date).
- **Spec:** [09 §4](docs/product/09-zero-entry-automation-design.md#4-the-automation-ladder--approval-boundaries).

### D-018 — Capture channel priorities
- **Date:** 2026-10-17 · **Status:** Accepted · **⚖** (WhatsApp bot, client-forward consent)
- **Decision:**
  - **MVP:** Android share sheet (from WhatsApp, Gmail, Files, browser, UPI apps), in-app voice, camera, shared cause-list PDFs, bootstrap import (≤ 200 files), ICS calendar out.
  - **MVP-late:** email forward-in address; ⚖-gated device-side fetch of public cause lists.
  - **v1:** opt-in WhatsApp bot number (Meta processing disclosed), calendar read.
  - **Never:** SMS, notification or contact-book reading, or silent background capture.
- **Evidence:**
  - the share sheet needs no third-party processor and is user-initiated [I];
  - WhatsApp Cloud API routes content via Meta infrastructure, likely outside India [I: verify];
  - Gmail restricted scopes require a security assessment [I: verify];
  - Play restricts SMS permissions [I: verify].
- **Revisit if:** H-TAPS fails because share-sheet friction is too high. Then accelerate the WhatsApp bot after counsel review.

### D-019 — Cause-list auto-matching moves into the MVP, deterministic and on the device
- **Date:** 2026-10-17 · **Status:** Accepted (pending spike T6) · **⚖** (device fetch only)
- **Decision:** Shared cause-list PDFs are parsed and matched **on the device** by exact identifiers (case no., CNR), then fuzzy party/advocate matching. Item, courtroom and bench fill at L3; new listings are proposed at L2. Unmatched rows are discarded and never stored. One-tap device-side fetch of *public* lists ships only after counsel review of each court's terms.
- **Evidence:** cause lists are the daily information source [R]; this step has the biggest re-entry and missed-listing risk [I]; deterministic parsing keeps cost at ~₹0.50/list ([09 §9](docs/product/09-zero-entry-automation-design.md#9-cost-implications-of-zero-entry)).

### D-020 — The smallest loop: "Forward it, forget it" (hearing-day loop)
- **Date:** 2026-10-17 · **Status:** **Superseded by D-024 / D-034.** The MVP is the full prepare → execute → follow-up → continuity loop, as a vertical slice.
- **Decision:** Both the concierge pilot and the MVP centre on one loop:

  > cause list → auto-matched 8 pm brief → voice note or order after the hearing → one-tap next date + auto tasks + drafted client/senior updates → follow-up queue.

  Everything else (templates, fees, email, research link-outs) is secondary and is added only after the loop shows ≥ 45 min saved per court day. The loop is run **by hand first** (E2) before any code.
- **Supersedes:** D-013.

### D-021 — Price arms revised to ₹399 / ₹699 / ₹999 per month, framed against time saved
- **Date:** 2026-10-17 · **Status:** **Superseded by D-031** (SaaS packaging: Junior / Advocate / Chamber)
- **Decision:** Full zero-entry costs ≈ ₹173 per Pro user per month on the India-resident route ([04 §7](docs/mvp/04-mvp-definition.md#7-expected-operating-costs)). The value anchor is hours saved and munshi cost, not diary apps. So we test ₹399 / ₹699 / ₹999 a month (annual ≈ 2 months free), with a founding-member pre-order at ₹3,999/yr. The free tier is capped at 40 automated captures a month; manual use stays unlimited.
- **Supersedes:** the price arms in D-010.
- **Revisit if:** fewer than 25% of activated S2 pay ≥ ₹699 in E2. Then fall back to ₹399 or a chamber-paid model.

### D-022 — Corroborated auto-confirm of next dates is a v1 opt-in experiment, off by default
- **Date:** 2026-10-17 · **Status:** Accepted
- **Decision:** In the MVP, next dates always need one confirmation. In v1, users may opt in to auto-confirm when two independent sources agree (e.g. order text plus the following cause list). This ships only if the pilot shows zero cases where both sources were wrong, with a badge, undo and notification.
- **Evidence:** risk A1 (score 15); the zero-entry goal pulls towards fewer taps.

### D-023 — Time saved is a first-class, user-visible product metric
- **Date:** 2026-10-17 · **Status:** **Amended by D-030.** Time saved stays visible to users, but the North Star is now the Prepared & Kept rate.
- **Decision:** The product computes a calibrated "time back" estimate per capture type and shows a weekly summary. The North Star becomes Weekly Hours Given Back, paired with Weekly Zero-Entry Hearings as the trust counter-metric ([PRD §10](docs/product/03-prd.md#10-success-metrics)).
- **Evidence:** convenience is the WTP driver (D-016), so the user must *see* the value; the calibration comes from the E1/E2 time logs.

---

## v0.3 decisions — Lawyer OS as an intelligent operating layer, vertical-slice MVP, Madras HC + Bengaluru, SaaS (founder corrections, 2026-10-17)

> **Context.** Founder-reported findings F1–F4 ([raw/07](research/raw/07-founder-reported-findings-2026-10-17.md)) led to a chamber "court-day autopilot" draft. The founder rejected it, so it was never adopted. The founder then directed three things: (1) keep Lawyer OS as a genuine, expandable OS; (2) launch in Madras HC and Bengaluru; (3) deliver it as a multi-tenant SaaS.

### D-024 — Lawyer OS is an intelligent operating layer; the MVP is its smallest marketable vertical slice
- **Date:** 2026-10-17 · **Status:** Accepted (founder direction)
- **Decision:** The product is an operating layer for Indian litigation practice: court layer, matter graph, lawyer memory, document intelligence, and prepare / execute / follow-up / continuity engines ([10](docs/product/10-lawyer-os-system-architecture.md)). The MVP must contain a thin but coherent version of **every** layer for two launch courts. It is **not** a data-entry tool, a chamber-admin utility, or an extraction demo.
- **Supersedes:** the framing in D-016 and D-020, and the unadopted chamber-autopilot draft.
- **Revisit if:** the Stage 0 concierge pilot shows lawyers value only one engine in isolation. Even then, the slice would be re-cut, not the identity.

### D-025 — Launch markets: Madras High Court (Chennai) and the Bengaluru court ecosystem
- **Date:** 2026-10-17 · **Status:** Accepted (founder direction) · **Specifics:** [11](docs/strategy/11-launch-markets-madras-hc-bengaluru.md)
- **Decision:**
  - **A1 adapters:** Madras HC Principal Seat (Chennai) and Karnataka HC Principal Bench (Bengaluru).
  - **A0 support (forum model + generic parsing):** Chennai and Bengaluru city civil, sessions, magistrate, family and commercial courts, plus tribunals (e.g. NCLT, DRT, consumer commissions).
  - **Later:** the Madurai Bench and the Karnataka HC Dharwad and Kalaburagi benches.
- **Supersedes:** D-012 (Delhi).

### D-026 — The matter graph is the core data model
- **Date:** 2026-10-17 · **Status:** Accepted
- **Decision:** The core model is Matter → Proceedings (main, IAs, connected matters, appeals; SR/unnumbered stage) → Listings → Hearings/Appearances → Orders → Obligations → Tasks. Documents, people and role edges sit around it. Provenance applies to every node, with one canonical next date per proceeding and obligations that are never silently closed ([10 §2](docs/product/10-lawyer-os-system-architecture.md#2-the-matter-graph)).
- **Why:** Indian litigation structure (connected matters, IAs, appearance roles, appeals chains) makes flat "case records" inadequate for preparation and continuity.

### D-027 — Lawyer memory model M1–M7, with no bench profiling
- **Date:** 2026-10-17 · **Status:** Accepted · **⚖** (court notes)
- **Decision:** Memory layers are:
  - M1 practice profile;
  - M2 working preferences;
  - M3 matter memory;
  - M4 private court and forum notes;
  - M5 playbooks;
  - M6 relationship memory (existing clients only);
  - M7 recognition memory.

  D-005 rules apply. Judge analytics and AI-generated profiles of individual judges are prohibited. M4 holds only the lawyer's own practical notes, private by default and never aggregated across workspaces.
- **Extends:** D-005.

### D-028 — Extensible court-adapter strategy with maturity levels and an access-mode registry
- **Date:** 2026-10-17 · **Status:** Accepted · **⚖** (access modes)
- **Decision:**
  - Each forum gets a versioned adapter: config plus small parsers, golden fixtures and health monitors, deployed server-side without app releases.
  - Maturity levels: A0 known forum, A1 document-assisted (user-supplied lists and orders), A2 device-retrieved public documents (only after counsel review), A3 official or licensed feed.
  - Every adapter records its permitted access mode. There is no server-side scraping without authorisation.
- **Evidence:** F3 (court-specific parsing) [FR]; no official eCourts API [R]; portal terms unknown [R].
- **Extends:** D-003, D-011, D-019.

### D-029 — Input policy: lawyer-owned first; email and WhatsApp exports only where privacy allows
- **Date:** 2026-10-17 · **Status:** Accepted · **⚖**
- **Decision:**
  - **MVP inputs:** the lawyer's voice notes; order and judgment PDFs; cause-list PDFs; the lawyer's own documents (pleadings, drafts); calendar (ICS import and export); diary photos; manual correction.
  - **Opt-in and privacy-gated:**
    - email forward-in for registry and e-filing mail;
    - **WhatsApp "Export chat" files from internal chats** (chamber or clerk groups), parsed for listings, tasks and documents, with a pre-import preview and per-message exclusion.
  - Client chats are **excluded by default**. They need an explicit per-chat choice, a sensitive-matter check and counsel-approved guidance.
  - Never: SMS, notification or contact-book reading.
- **Evidence:** F2 (confidentiality reluctance) [FR]; BCI Rules 17/24 [V]; DPDP [R].
- **Amends:** D-018.

### D-030 — Proof of value = better preparation, fewer missed obligations, lower cognitive load, continuity
- **Date:** 2026-10-17 · **Status:** Accepted
- **Decision:** The North Star is the **Prepared & Kept rate**: the share of appearances with a current brief before the hearing **and** all resulting obligations captured and kept. Supporting metrics are preparation completeness, missed-obligation rate, cognitive load (short NASA-TLX-style self-rating), continuity (time to get up to speed or hand over a matter), and trust (correction rate). Minutes of entry saved are secondary.
- **Evidence:** F1 (solos report < 30 min/day saved) [FR].
- **Amends:** D-023.

### D-031 — SaaS packaging: Junior (free), Advocate, Chamber (per seat)
- **Date:** 2026-10-17 · **Status:** Proposed (validate in E2 and E3)
- **Decision:**
  - **Junior:** free, ≤ 15 active matters, fair-use AI.
  - **Advocate:** test ₹499 / ₹799 / ₹1,199 per month.
  - **Chamber:** test ₹499 / ₹649 / ₹899 per seat per month, plus a ₹199 clerk seat, minimum 3 seats.
  - Annual ≈ 2 months free. Prices ex-GST; we charge 18% GST.
  - The junior's free workspace travels with them, which creates the conversion loop to the Advocate plan.
- **Evidence:** ≈ ₹175 variable cost per active seat ([09 §9](docs/product/09-zero-entry-automation-design.md#9-cost-implications-of-zero-entry)); F4 (chamber aggregation) [FR].
- **Supersedes:** D-021.

### D-032 — Delivery model: hosted multi-tenant SaaS only; the "Lawyer as a Service" naming rule
- **Date:** 2026-10-17 · **Status:** Accepted (founder direction) · **⚖** (public wording)
- **Decision:**
  - Lawyer OS is a cloud service we operate: hosting, updates, adapters, security, support. There are no on-premises or self-hosted customer deployments in the MVP or v1. A dedicated hosted tenant may come later.
  - "Lawyer as a Service" means **the lawyer's operating system delivered as a service**, never legal services, advice, representation, or any offering to the public.
  - Public materials say "cloud software for advocates" and avoid the bare phrase.
- **Spec:** [10 §6](docs/product/10-lawyer-os-system-architecture.md#6-saas-platform-lawyer-os-as-a-hosted-multi-tenant-service).

### D-033 — Tenant isolation and India-region hosting
- **Date:** 2026-10-17 · **Status:** Accepted
- **Decision:**
  - The workspace is the tenant. Postgres RLS on every row; sync rules derived from the same policy.
  - Per-workspace envelope keys in India-region KMS, so a deleted workspace can be crypto-erased.
  - Workspace-filtered retrieval; no cross-tenant AI caches.
  - Primary hosting in Mumbai with disaster recovery in Hyderabad; backups and logs stay in India.
  - Clerk role restricted from strategy notes and matter memory.
  - Automated cross-tenant tests in CI.
- **Extends:** D-009.

### D-034 — Sequencing exclusions are deferrals, not abandonment
- **Date:** 2026-10-17 · **Status:** Accepted
- **Decision:** The MVP defers the following, which stay on the OS roadmap ([04 §5](docs/mvp/04-mvp-definition.md)):
  - licensed research integration;
  - full drafting studio and Word add-in;
  - fees and billing;
  - limitation engine;
  - live display-board tracking;
  - device-retrieved and official court feeds;
  - Madurai, Dharwad and Kalaburagi benches and other states;
  - native desktop;
  - client status links;
  - intake and conflict check;
  - practice analytics.

  **Permanently excluded:** public solicitation and marketing of lawyers, autonomous legal advice, unverified citations, unsupervised filing, unauthorised court scraping, judge analytics.

---

### D-035 — Working title: CauseDeck
- **Date:** 2026-10-18 · **Status:** Accepted (founder), *working title*
- **Decision:** The product's working title is **CauseDeck**. It replaces "Lawyer OS" in new material. Repo: `RapierCraftStudios/causedeck` (private; moved from RapierCraft on 2026-10-18 so the ForgeDock app installation covers it). Earlier documents keep "Lawyer OS" as a historical name.
- **Why:**
  - It follows the founder's two-short-words house style (UltraNews, AlterLab, ForgeDock).
  - It is court-native: the cause list is a litigator's daily deck.
  - It reads as a command deck for the whole practice, i.e. an operating layer, not a diary (consistent with D-024).
  - In the 2026-10-18 screen, causedeck.com, .app and .in showed no DNS records and no product conflict was found ([12](docs/strategy/12-naming.md)).
- **Before it becomes final:**
  - an IP India trademark search (classes 9, 42, 45);
  - domain registration;
  - checks on handles (Play Store, social);
  - a gut-check with 10 lawyers in Chennai and Bengaluru.

---

## v1.0 build decisions (founder direction, 2026-10-18) — see [13 Technical spike](docs/engineering/13-technical-architecture-spike.md)

### D-036 — Full-stack TypeScript monorepo, with a Next.js web/PWA product app
- **Date:** 2026-10-18 · **Status:** Accepted
- **Decision:**
  - Monorepo: pnpm + Turborepo.
  - `apps/web`: Next.js App Router, Node runtime. An installable PWA with a Web Share Target, which covers Android share-sheet capture.
  - `apps/site`: Next.js static export on Cloudflare Pages.
  - `apps/api`: Hono, with OpenAPI.
  - `apps/worker`: pg-boss.
  - `apps/admin`.
  - Shared packages as listed in spike §2.
  - Native mobile (Expo) is deferred, and the PWA is the mobile client.
- **Supersedes:** D-008.

### D-037 — Bootstrap deployment on an India VPS behind Cloudflare, with a designed scale path
- **Date:** 2026-10-18 · **Status:** Accepted
- **Decision:**
  - **Stage A:**
    - a single India VPS (DigitalOcean BLR1 or Lightsail ap-south-1) running Docker Compose, Caddy, Postgres + pgvector and MinIO;
    - a second VPS for staging;
    - the marketing site and static assets via Cloudflare Pages / CDN.
  - **App and API DNS-only by default**, so TLS terminates in India and matter data never transits non-India edges (D-009, D-033).
  - **Stage B:** RDS and S3 in ap-south-1, multiple app nodes.
  - **Stage C:** ECS or k3s with autoscaled workers.
  - The day-one rules in spike §3.2 keep the path open.

**Amendment 2026-10-27 (founder: "go with OVH Mumbai").** The original entry above is unchanged. This amendment replaces its provider choice and its AWS-by-default scale path. It is recorded for #882 and cross-referenced from [ADR 0053](docs/adr/0053-stage-b-c-scale-path.md).
- **Why:** measured against the goal of very low cost before and after scaling, DigitalOcean/Lightsail for Stage A and AWS RDS/S3/ALB/ECS for Stages B and C are too expensive. Managed AWS services cost 5-10x rented servers at steady load. OVH VPS in Mumbai (`YNM`) keeps India residency (D-009).
- **Stage A:** OVH Mumbai VPS, running the same Docker Compose, Caddy, Postgres + pgvector and MinIO stack. Prod runs on a **VPS-3** (6 vCPU / 12 GB / 100 GB). Staging runs on its **own VPS-1** (2 vCPU / 4 GB / 40 GB). They are on **separate hosts** so staging failures and access cannot reach prod data.
- **Stage B:** Postgres on its own OVH Mumbai box (VPS-4 or a dedicated server) with a **streaming replica** and **PgBouncer**, plus **2+ stateless app VPS** behind a Cloudflare Load Balancer or DNS. The Stage B triggers are unchanged (p95 > 400 ms, DB CPU > 60%, or > 1k seats).
- **Stage C:** more nodes under **k3s or Docker Swarm**.
- **AWS:** RDS, S3 and ECS Fargate are optional and no longer the default path. The Terraform modules for them stay as an escape hatch (ADR 0053).
- **D-009 restated, unchanged:** primary DB, documents and logs stay in India. MinIO runs on the Mumbai host. Off-host backups go to **AWS S3 ap-south-2 (Hyderabad)**, because OVH Public Cloud has no Mumbai object storage.
- **Cloudflare:** app and API stay **DNS-only by default** (D-037, #788). Nothing in this amendment changes that. A Cloudflare Load Balancer, if used for Stage B, is optional and needs the recorded residency approval (ADR 0053); DNS-based balancing is the default.
- **Cost target:** OVH India public catalogue, 2026-10-27, ex-GST, 12-month term: VPS-1 ₹420/mo, VPS-3 ₹1,160/mo. Stage A prod + staging is about ₹1,580/mo ex-GST (about ₹1,865 with 18% GST), plus S3 backups and AI usage.
- **Trade-offs accepted:**
  - **Shared vCores:** VPS vCPUs are shared, so sustained CPU and noisy neighbours can vary. The Stage B triggers are the guard.
  - **Traffic quota:** the Asia-Pacific VPS quota is 500 GB/month on VPS-1 and about 1 TB/month on VPS-3, then throttled to 10 Mbps.
  - **12-month term:** the listed price needs a 12-month commitment.
- **Related:** #108 (order the VPS, human), #106 (scale-out runbook), #808 (migration rehearsal), D-009, ADR 0006, ADR 0053.

### D-038 — Auth: Better Auth with Google OAuth, magic link, passkeys, and organisations as workspaces
- **Date:** 2026-10-18 · **Status:** Accepted
- **Decision:** Better Auth (Drizzle adapter). Its organization plugin maps to workspaces and roles. Owners get 2FA. Google client credentials are `needs-human`.

### D-039 — Design system: Tailwind v4 + shadcn/ui in `packages/ui`, Storybook, visual regression, `/design` for hero surfaces
- **Date:** 2026-10-18 · **Status:** Accepted
- **Decision:** Tokens use OKLCH colour with light and dark themes. Fonts are an editorial serif plus Geist/Inter, with Noto Tamil/Kannada. Signature patterns are listed in spike §7. Quality gates are: Storybook for every component, Playwright visual baselines, axe, and Lighthouse ≥ 95. The marketing site and the hero product surfaces go through the ForgeDock `/design` pipeline.

### D-040 — Credentials and legal inputs are `needs-human`; code never blocks on them
- **Date:** 2026-10-18 · **Status:** Accepted
- **Decision:** Every external integration ships with a mock or console provider and a typed env schema, so the build works without secrets. Human items (accounts, keys, counsel deliverables, court fixtures, Registry letters) are separate `needs-human` issues. ⚖-gated features (fees/invoices, limitation, inbound enquiries, client status links, A2 retrieval) are built behind feature flags and ship dark.

### D-041 — Build the full product now, in parallel with validation
- **Date:** 2026-10-18 · **Status:** Accepted (founder direction)
- **Decision:** The founder directs that the full product is built, i.e. every PRD requirement tagged M, v1 and v2. The work runs as 10 milestones of ForgeDock-orchestrated issues, decomposed from the technical spike. Stage 0 validation ([07](docs/validation/07-validation-plan.md)) continues in parallel. Its findings come in as new issues or changes to the spike through ADRs.
- **Supersedes:** D-015.
- **Unchanged:** the permanent exclusions.

### D-042 — The court-day change freeze applies to production only
- **Date:** 2026-10-18 · **Status:** Accepted (founder)
- **Decision:** The 18:00–23:00 and 07:00–10:30 IST freeze (spike §3.1, D-037) applies to **production** deploys. Shipping a milestone into `staging` during the build phase is not frozen. Revisit when staging hosts real pilot users.

### D-045 — Sweet-spot CI: one heavy ship gate, slow suites report nightly
- **Date:** 2026-10-19 · **Status:** Accepted (founder: "sweet spot CI, not luxury"). Supersedes the Full tier of D-044.
- **Decision:** Lane PRs run the fast tier only. Ship PRs (into `staging`/`main`) add `e2e` (2 shards) as the single heavy gate. `lighthouse` and Storybook `visual` move to nightly + manual + `full-ci` label, with `continue-on-error` (report-only). Pushes to `staging` no longer re-run e2e. The milestone chain stops regenerating visual baselines on each ship.
- **Why:** Lighthouse and the ~4,500-screenshot visual suite cost about 40–60 runner-minutes per ship and caused most red ship PRs without catching product defects.
- **Revisit:** Once real pilot users are on staging, make `lighthouse` blocking again on `main` only.

### D-046 — The e2e ship gate runs one project; the full matrix is nightly and report-only
- **Date:** 2026-10-21 · **Status:** Accepted (founder: one real gate on ship PRs, heavy coverage nightly). Refines D-045.
- **Decision:** `E2E_SCOPE=ship` (ship PRs, pushes to `main`, `full-ci` label) runs every non-visual spec on `chromium-1280-light`, the `@smoke` subset on `chromium-360-light`, and the `@smoke` subset on `webkit-360`, split over the same 2 shards (`e2e (N/2)`). `E2E_SCOPE=full` (nightly schedule, manual dispatch; the default when run locally) keeps the 6-project matrix (360/768/1280 x light/dark) plus the `*.visual.spec.ts` specs, with a 90-minute timeout and `continue-on-error`, so it reports and never blocks.
- **Why:** The 6x matrix repeated the same functional assertions at every width and theme (about 1,650 browser tests per run, 2 workers per shard), so it needed more than the 45-minute timeout and both recent runs (ship PR #342, staging dispatch) were cancelled: the gate never completed. Layout and theme coverage is what the visual and axe specs and the nightly matrix are for. The ship scope is about 340 tests, about 20 minutes.
- **Revisit:** If a width- or theme-specific regression reaches `main` that the ship scope missed, add that spec's tag to the 360 smoke subset rather than widening the matrix.

### D-047 — Fast lane gate: turbo cache in Actions, test shards, changed-file lint
- **Date:** 2026-10-21 · **Status:** Accepted (founder: "the most I can get out of CI without wasting my pipeline's time")
- **Decision:** Lane PR CI takes about 6 minutes instead of about 16 with the same coverage and the same required checks (`lint`, `typecheck`, `test`, `build`, `tenancy`). (1) Turborepo's remote cache is served from the GitHub Actions cache by `rharkor/caching-for-turbo` (SHA-pinned), with no paid service; the `test` task declares the repo-wide files that tests read as inputs, so a cached pass is trustworthy. (2) `test` is a five-shard matrix (db+auth, core, web, admin+api+worker, rest) plus an aggregating job named `test` that fails unless every shard passed. (3) On pull requests, Prettier checks only the changed files and the docs checks run only when their inputs change; ESLint uses a content cache on lane PRs only. Pushes, merge groups and ship PRs keep the full checks. `tenancy`, the bundle budget and the D-044/D-045 tiers are unchanged.
- **Evidence:** 23 lane PR runs: `test` 15.2 min median (p90 17.2), `lint` 8.8 (p90 10.7), workflow wall time 15.6. `test` was one runner running about 11 Vitest suites 3 at a time; `lint` ran `prettier --check .` over the whole repo plus an uncached ESLint. No turbo cache was shared between runs (`TURBO_TOKEN` and `TURBO_TEAM` are empty).
- **Alternatives:** Vercel remote cache (paid, rejected by the "no paid service" constraint); per-package `test` inputs (fragile: several suites scan other packages, `docs/` or the migrations); a larger runner (paid); caching ESLint results on ship PRs (typed rules can go stale when a type changes in an unchanged file).
- **Revisit:** If the 10 GB Actions cache budget evicts useful entries, if cold runs on a fresh lane stay slow (the GitHub cache only reads the PR's own ref, its base branch and the default branch), or if a shard becomes the long pole: rebalance `infra/scripts/ci-test-shard.mjs`.

### D-048 — Legal data infrastructure: court data, notices and news through a governed fetch layer
- **Date:** 2026-10-23 · **Status:** Accepted for direction (founder: "we want to be a superior replacement for eCourtsIndia and all modern and future age requirements for legal infra in india"); every new source and access mode stays **Proposed** until its ⚖ review clears · **⚖**
- **Decision:** CauseDeck adds a legal data layer next to the practice OS: case status, cause lists, orders and judgments, official notices, and legal news, served in the app and later through a developer API. Sources come in this order of preference:
  1. **Official and licensed** (A3): data-sharing from NIC/eCommittee and the High Court Registries (the Madras HC AIMS email push is the model), and licensed feeds. causedeck#118 starts this.
  2. **Lawful public retrieval** (A2) of pages that need no captcha, one source at a time after its terms and counsel review. Fetching goes through one governed fetch layer, built on the AlterLab API, never through ad hoc scrapers.
  3. **Contributed data**: lists, orders and statuses that lawyers already share (A1), reused across workspaces only with opt-in consent and under the DPDP posture below.
  4. **Delegated lookups** for portals behind a captcha (amended 2026-10-23, founder: "we need to solve those captchas, we are a convenience business too"). CauseDeck performs a signed-in advocate's own lookup on their behalf and solves the captcha automatically: on the device first, with a server fallback through the fetch layer (AlterLab `captcha` tier). It runs only for that advocate's own matters, on demand or on a watch, at a low fixed rate per advocate. **Solving at scale** (coverage for all users, or the API) is planned but stays off until counsel clears it (#118).
- **The fetch layer** (one package, every external read goes through it):
  - a **source registry**, extending the access-mode registry of D-028: per source, the access mode, terms status, counsel status, rate limit, retention, residency, a kill switch and an AlterLab tier cap;
  - AlterLab calls with `proxyCountry: 'IN'`, `failFast: true`, a per-source `maxTier` and `maxCostDollars`. **The `captcha` tier is off by default for every court and government source** and is allowed only for a delegated lookup (one advocate, their own matter, within the per-advocate rate), enforced in code and tested. Bulk use of the `captcha` tier needs a per-source counsel clearance in the registry;
  - provenance on every fetched fact (URL, time, content hash, source version), shown in the product like every other fact (D-026);
  - cost metered into usage and budgets.
- **Notices and news**:
  - **Official notices** (circulars, practice directions, roster and bench notifications, holiday lists, registry notices, Bar Council and Gazette notices) are ingested from registered sources, typed, matched to the lawyer's forums and matters, and alerted through `packages/notifications`.
  - **Legal news** is headlines, links and short summaries from sources that offer feeds or licences. No full-text republication of copyrighted reporting.
- **Corpus:** raw judgments and orders from public sources are stored with provenance for citation verification (D-004) and later research. No editorial content, headnotes or citator (*EBC v. D.B. Modak*). **Amends D-001.**
- **Bright lines, never relaxed:**
  - no captcha solving except delegated lookups for a signed-in advocate's own matters, at a low fixed rate; no solving at scale before counsel clears it;
  - no covert bulk crawling;
  - no framing of court pages;
  - no use of a source before its registry row says it is cleared.
- **DPDP posture** ⚖: party names in court records are personal data. Purpose limitation (the lawyer's own matters, and the court's public listing), retention limits per source, erasure on request where the law allows, no resale of personal data, and a published policy on republishing before any API exposes court data. The written posture, with its ⚖ items for counsel, is [docs/legal/court-data-posture.md](docs/legal/court-data-posture.md).
- **Amends:** D-001 (corpus), D-003 (bulk access replaced by the tiered, governed model above; captcha rule replaced by delegated lookups; covert-crawl prohibition kept), D-011 (the user no longer solves the captcha: delegated, automated lookups), D-028 (access-mode registry generalised to a source registry).
- **Evidence:** No official eCourts API [R]. Portal terms are silent or contradictory and forbid framing [V] ([11](docs/strategy/11-launch-markets-madras-hc-bengaluru.md)). The Karnataka HC cause list is a public page with no captcha [V]. Madras HC Registry email push (Notification 230/2026) [V]. Aggregators' sourcing is undisclosed (D-003). AlterLab exposes tier caps, fail-fast, an India proxy and cost caps (`alterlab` SDK 2.4.0).
- **Alternatives:** Buy a licensed reseller API (Surepass, eCourtsIndia): kept as a fallback, but sourcing is opaque and it is no moat. Competitor-style bulk scraping with captcha solving: deferred until the counsel opinion (#118), for legal, DPDP and trust risk. User-solved captchas only (the original D-011): rejected as too much friction for a convenience product.
- **Revisit if:** counsel advises against a source or mode; an official API appears (move that source to A3); a Registry objects (kill switch, then remove).

### D-049 — Vision: "Zerodha for law" in posture, "Bloomberg for law" in data
- **Date:** 2026-10-23 · **Status:** Accepted (founder: "what if that is a vision?")
- **Decision:** CauseDeck aims to be the operating system and data layer that every Indian advocate and legal institution runs on: **priced like Zerodha, as dependable as Bloomberg.**
  - **Public posture (Zerodha):** simple, self-serve, cheap, India-scale; no dark patterns; profitable per user; trust is the brand; education drives growth; an open developer API builds an ecosystem.
  - **Data ambition (Bloomberg):** the most reliable and complete legal data layer in India (case status, cause lists, display boards, orders and judgments, notices, news), inside the workflow advocates use all day, with a network that compounds (shared matters, referrals, contributed public documents). The premium price is only for institutions and the API.
- **How the roadmap maps:**

  | Element | CauseDeck |
  | --- | --- |
  | Daily workflow (Kite / the Terminal) | The practice OS (milestones 3–7) |
  | Market data | Court Data Network (D-048) |
  | News | Notices and news feeds |
  | Free entry point (zero brokerage) | Free court-day alerts, zero-entry onboarding |
  | Developer API (Kite Connect) | Public API |
  | Institutional product | B2B portfolio tracking for banks, NBFCs and ARCs |
  | Network | Referrals, shared briefs, contributed public documents |
  | Education (Varsity) | The practice education program |
- **Official rails are the strategic priority.** Zerodha exists because exchanges sell official feeds, and Bloomberg's premium is data that doesn't break. Delegated captcha lookups (D-048) give convenience now, but the durable layer must sit on official or licensed feeds (A3) from NIC/eCommittee and the High Court Registries. That makes official data partnerships a named workstream with an owner.
- **Guardrails the vision keeps:** no judge ratings, rankings, outcome predictions or profiling (D-050: judge-level data is internal for data building, and factual bench facts reach users only after counsel); user-facing analytics are court and process analytics (listing delays, adjournment rates, disposal times by forum and case type); no L5 autonomous action (D-017); verified citations only (D-004); India residency (D-009); the D-048 bright lines and DPDP posture.
- **Moat:** data inside the daily workflow, plus a network. Data alone commoditises to other aggregators, and workflow alone to other practice tools.
- **Evidence:** Roadmap, decisions D-026, D-028, D-030 and D-048; milestones Court Data Network and Instant GTM & Adoption.
- **Alternatives:** A data-only aggregator (an eCourtsIndia-style API business): rejected, it's commoditised and fragile without official rails. A workflow-only practice tool: rejected, it's easy to copy and has no compounding data.
- **Revisit if:** official rails stay closed after sustained outreach (the data ambition then rests on delegated and contributed data, at lower reliability), or unit economics at the Zerodha price point don't hold.

### D-050 — Judge-level data: internal for data building; factual bench facts for users only after counsel
- **Date:** 2026-10-23 · **Status:** Accepted (founder: "judge analytics and internal tools for data building is needed"; chose "internal + factual, then counsel") · **⚖**
- **Decision:**
  - **Internal (now):** CauseDeck may hold judge-level and bench-level data (who sat where and when, listing pace, items heard, disposal counts per bench and period) in internal, staff-only stores, used for data building and quality: display-board call-time estimates, roster reconciliation, coverage and adapter health. No user-facing surface reads it.
  - **User-facing factual bench facts (after counsel):** neutral, verifiable facts per bench, such as who sat, the dates and halls, listing pace, and the number of items heard and disposed. They ship behind the flag `bench_facts`, off until the counsel opinion clears them (#118).
  - **Still prohibited, at any stage:** ratings, rankings or comparisons of judges; outcome tendencies or predictions ("this judge grants X% of bail pleas"); AI-generated profiles of judges; sentiment about judges; any content that could scandalise or lower the authority of a court.
  - M4 court notes stay the lawyer's own and private, never aggregated (D-027 unchanged on that point).
- **Why:** call-time estimates, roster accuracy and coverage need bench-level facts; factual bench information also helps advocates plan. Ratings, predictions and profiling carry contempt-of-court risk (scandalising the court), would damage the Registry relationships the data layer depends on (D-049 official rails), and many jurisdictions restrict them (France prohibited judge analytics in 2019).
- **Amends:** D-027 (the judge-analytics prohibition narrowed to ratings, predictions and profiling), D-049 (guardrail wording), PRD ME-6 and PX-9, ADR 0017 (bench data use).
- **Revisit if:** counsel advises against even factual bench facts (keep them internal only), or a court or Registry objects (switch off `bench_facts`).

### D-051 — Timestamp-named migrations, and lane checks that run on any lane host
- **Date:** 2026-10-24 · **Status:** Accepted (founder: "yes do 1 and 2")
- **Decision:**
  - New drizzle migrations are named by timestamp (`migrations.prefix: 'timestamp'` in `packages/db/drizzle.config.ts`), not by the next index. Migrations up to `0082` keep their names; the journal orders execution, and timestamp names sort after them.
  - The lane-local checks live in the repo (`scripts/lane-check.sh`), so ForgeDock lanes on remote compute (computeshare, `legion`) run the same targeted format, lint, typecheck and test before they push. Lanes verify locally (`verify.mode: local`); CI remains the gate.
- **Why:** on 2026-10-23/24 about 12 parallel lanes in Court Data Network kept taking the same next migration number (#52, #56, #484, #493, #497, #514, #519, #586, #499). Each collision parked a lane and needed a renumber and a re-review. Separately, lanes ran without dependencies and with CI-only verification, so they pushed code they had never compiled, and two CI fix rounds were not enough. Timestamps remove the collision class entirely; local verification on remote compute removes most of the CI fix rounds.
- **Revisit if:** two lanes ever produce the same timestamp (switch to a unique suffix), or remote lanes can't install dependencies (fall back to `verify.mode: ci`).

### D-052 — Core may use the governed fetch layer directly
- **Date:** 2026-10-24 · **Status:** Accepted (founder: "Allow it, record it")
- **Decision:** `@causedeck/core` may import `@causedeck/fetch` (`CORE_DEPENDENCIES` in `packages/config/eslint/boundaries.js`). The invariant that matters is unchanged: every external host is reached only through the governed fetch layer, with source policy, tiers, rate limits, kill switch and fetch log, and `no-restricted-syntax` still bans a direct `fetch` of an external host anywhere. Fetchers that the worker already injects (`setCauseListFetcherFactory`, `setBoardFetcherFactory`, `setNoticeFetcherFactory`, `setStatusFetcherFactory`) stay as they are.
- **Why:** three features call out from core: data-ops Slack alerts (#515), the news digest (#481) and customer webhooks (#626, with an SSRF-safe `deliverWebhook`). The spike (§2) kept core free of `@causedeck/fetch`, and lanes started adding the dependency piecemeal (it was listed twice) to make lint pass. Injection through the worker for every sender adds wiring without adding safety, because the fetch layer itself is the governance boundary.
- **Amends:** spike §2 (core dependencies).
- **Revisit if:** core starts making external calls outside `@causedeck/fetch`, or the fetch layer grows code that should not run in request paths.

### D-053 — Data posture: coverage first; an anonymised shared corpus; sources not shown
- **Date:** 2026-10-27 · **Status:** Proposed (founder: "Dont worry too much about lawful its like a grey area right Scraping and everything Point is for us low cost high value for the user"; on names: "the name of the case I think is Supposed to be public … most cases and case laws Are basically ruled on facts … We necessarily dont even need to worry about the names") · **⚖** for the record, not a gate
- **Decision:**
  1. **Retrieval posture.** Scraping public court and government pages and solving captchas is treated as a business risk the founder accepts, not as something blocked until counsel replies.
     - Public pages with no captcha may be fetched once a source is registered.
     - Captchas may be solved on the server, for delegated lookups and for coverage of the courts we serve. Bulk coverage (#492) is unparked.
     - Captchas are solved with our own solver where possible (eCourts uses simple image captchas). The paid AlterLab `captcha` tier is the fallback.
     - Every source still goes through the governed fetch layer, with per-host rate and concurrency budgets, off-peak scheduling, caching and a kill switch. Overloading a court server gets us blocked and loses the source.
     - Counsel (#118) and the Registry and official partnerships (#513) continue in parallel as upside, not as blockers.
  2. **Anonymised shared corpus.** Judgments and orders in the shared corpus are served with party details replaced by role placeholders that stay consistent within a judgment ("the Appellant", "Accused 1", "the Complainant's wife").
     - **Replaced:** parties, witnesses, relatives, addresses, phone numbers, Aadhaar/PAN, bank and vehicle numbers, and medical details.
     - **Kept:** judges, advocates, courts, institutions and government bodies, statutes, dates and amounts.
     - **Case title:** kept as published, because with the citation and case number it identifies the case. The stable key is the citation or case number, not the title.
     - **Title masking:** titles are masked for sensitive categories (POCSO, sexual offences, juvenile, matrimonial and family, in-camera, acquittals of individuals) and on a court order or request. Reported or frequently cited landmark judgments stay searchable by title.
     - **No name search** over judgment text. The raw text is kept for staff and for citation verification internals only. The placeholder mapping is not stored. Masking requests are handled within 72 hours.
     - The lawyer's own matters keep real names inside their workspace (unchanged).
  3. **Editorial rule narrowed.** No corpus field may hold content from an editorial source (SCC Online, Manupatra, other publishers' headnotes or citators). Our own machine-generated segment roles, tags, statute and citation references and outcomes are allowed (*EBC v. D.B. Modak* protects editorial additions, not original analysis).
  4. **Sources are not shown to users.** The app and the developer API (#487) show each record's official identity only: court, case number, neutral or court citation, date, and a link to the official court copy where one exists. They do not show which portal, aggregator, dataset or fetch route the record came from.
     - Citations to the document itself stay everywhere: which order or judgment, its date, page and paragraph (D-004). Users can always check a line against the document; they are not told how we obtained it.
     - Provenance (`provenance`, `source_id`, fetch logs) stays internal, for staff, audits, masking requests and re-fetches.
     - Licences that require attribution are met once, on a public "Data sources and licences" page and in the API terms. CC-BY-4.0 allows attribution "in any reasonable manner", so per-record credits are not needed (the Dattam Labs datasets, #890).
     - A source whose terms demand visible per-record attribution is not served to users unless we accept that term for that source.
     - Never claim a record came from the court when it did not. "Official copy" links point only at the court's own document.
- **Bright lines, unchanged and never relaxed:** statutory identity bans (POCSO s.23, BNS s.72, JJ Act s.74, in-camera and matrimonial) are filtered at ingest; court-ordered masking is honoured; no judge ratings, predictions or profiles (D-050); no framing of court pages.
- **Why:** coverage at low cost is the product (D-049). Competitors already work this way, and no Indian ruling has addressed scraping public court portals. Precedent value lies in facts and reasoning, not party identity. Removing identities from the shared corpus shrinks right-to-be-forgotten exposure (the Delhi HC in May 2026 and the Karnataka HC in August 2026 directed name masking and name-search removal at Indian Kanoon) and DPDP scope, and makes the corpus safe to embed, search and serve through the API. Research: [docs/strategy/13](docs/strategy/13-legal-data-competitive-research.md).
- **Amends:** D-048 (the bright lines on captcha solving at scale and covert bulk crawling; the corpus rule on editorial content; DPDP posture for the shared corpus), D-001 (corpus content), #484 (static editorial test), #118 (its acceptance criterion "no server-side automation and no captcha circumvention" becomes "assess"), #487 (public API responses drop `provenance.source_id` and `source_license`; follow-up #912).
- **Architecture:** [ADR 0051](docs/adr/0051-corpus-storage-enrichment-and-retrieval.md).
- **Revisit if:** a court, Registry or NIC objects to or blocks our traffic (kill switch for that host, then review); counsel advises a specific mode is unlawful; the redaction evaluation shows the placeholders lose legal meaning.
