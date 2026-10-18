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
- **Date:** 2026-10-17 · **Status:** Accepted (pending validation H1–H3)
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
- **Date:** 2026-10-17 · **Status:** Proposed (confirm after tech research)
- **Decision:** Build on Expo (React Native) for Android, iOS and web. Desktop starts as an installable PWA served from the web build. A Tauri wrapper comes later, only if demand for offline desktop use is proven.
- **Evidence:** See [06](research/raw/06-tech-stack-and-costs.md) §1. Android has ~94% share in India; consumer PC shipments are only ~7M/yr nationally, so laptops can't be assumed ([05b](research/raw/05b-workflows-deep-dive.md) §3).
- **Update (2026-10-17, synthesis):** Status → **Accepted for Stage 0 spikes** (T5 perf test on a low-end Android device decides). iOS is TestFlight-only for the pilot.
- **Revisit if:** Native-feel tests on low-end Android fail, or the team's skills favour Flutter.

### D-009 — Data residency: primary data and logs in India
- **Date:** 2026-10-17 · **Status:** Accepted
- **Decision:** Host the primary database, object storage and logs in Indian regions. Use LLM providers only under no-training, zero- or short-retention terms, preferring India-region endpoints where they are available at acceptable cost. Publish a sub-processor list.
- **Evidence:** CERT-In requires 180-day logs kept within Indian jurisdiction. DPDP Rule 15 permits transfers unless restricted, but possible localisation for Significant Data Fiduciaries and the confidentiality optics favour India hosting ([04](research/raw/04-regulatory-ethics.md) §3).

### D-010 — Pricing hypothesis: freemium + low INR subscription, UPI-first
- **Date:** 2026-10-17 · **Status:** Proposed (validate via landing-page and pricing tests)
- **Decision:** Free tier for students and juniors (limited matters, limited AI). "Pro" plan to be tested at ₹199 / ₹299 / ₹499 per month, with annual discounts. A chamber plan comes later.
- **Update (2026-10-17, synthesis):** The unit-cost model ([MVP §6](docs/mvp/04-mvp-definition.md#6-expected-operating-costs)) gives ≈ ₹100 of variable cost per Pro user on the India-resident AI route. ₹199 leaves too thin a margin, so the test arms are now **₹299 / ₹399 / ₹499** per month (annual ₹2,999–3,999). Founding-member pre-order is ₹1,999/yr. Collection via web checkout (UPI Autopay / Razorpay) to avoid the 15% app-store fee where store policy allows.
- **Evidence:** Juniors earn under ₹10k/month (79% of those with under 2 years' practice, per the Vidhi survey cited in a PIL). Anchors: Indian Kanoon Premium ₹5,000/yr, CaseMine ₹12,999/yr, diary apps about ₹400/month ([05](research/raw/05-indian-lawyer-workflows-market.md) §2, [01](research/raw/01-indian-research-platforms.md) §10).

### D-011 — eCourts lookup is device-side and user-driven (if cleared)
- **Date:** 2026-10-17 · **Status:** Proposed · **⚖**
- **Decision:** The only automated court-data path in the MVP is an in-app browser to the official portal. The *user* solves the captcha, and the app parses the result page on the device, with consent. Results are proposals, never auto-confirmed. No server-side requests to eCourts.
- **Evidence:** D-003 risks; open-source SDKs show the pages are parseable ([02](research/raw/02-indian-practice-management-and-legaltech.md) §1).
- **Revisit if:** Spike T1 parse success < 90%, or counsel advises against it. Fallback: manual entry, PDF and voice only.

### D-012 — Launch in one court ecosystem (default: Delhi district courts + Delhi HC)
- **Date:** 2026-10-17 · **Status:** Proposed
- **Decision:** Stage 0 interviews and the pilot focus on one metro's district courts and High Court. Delhi is the default because of density, Hindi and English, eCourts coverage and the HC display board. Swap to Bengaluru or Mumbai if the founders' network is stronger there.
- **Evidence:** Local variation in cause-list formats, forums and language; chamber word-of-mouth is local [inference]. A-14.

### D-013 — Voice note + order digest are the two MVP AI jobs; drafting is template-bound
- **Date:** 2026-10-17 · **Status:** Accepted (pending H3/H4)
- **Decision:** The MVP's AI budget goes to (1) post-hearing voice → structured update and (2) order PDF → anchored digest. Drafting is limited to template narrative blocks, with no authorities. The citation checker and consistency check run deterministic-first.
- **Evidence:** AI opportunity matrix scores ([05](docs/strategy/05-competitor-and-ai-matrices.md) §B). Cost per action ≈ ₹0.9–5 ([04](docs/mvp/04-mvp-definition.md) §6.1).

### D-014 — Pilot billing via payment links, not in-app purchases
- **Date:** 2026-10-17 · **Status:** Accepted
- **Decision:** Founding-member plans are sold through a Razorpay payment link with manual or webhook entitlement. Subscriptions with UPI Autopay come at public beta, after a Play policy check (A-13).
- **Evidence:** Razorpay charges 2% + GST against Play's 15% ([06](research/raw/06-tech-stack-and-costs.md) §6). Validating WTP early (H7) matters more than billing automation.

### D-015 — Stage 0 gate before any production code
- **Date:** 2026-10-17 · **Status:** Accepted
- **Decision:** Only spikes T1–T5 and the repo scaffold are built before the end-of-week-4 gate. GO, GO-WITH-CHANGES or PIVOT is decided on the H1–H12 thresholds in [07](docs/validation/07-validation-plan.md).
- **Evidence:** There is no primary workflow or WTP evidence yet ([01](docs/strategy/01-research-report.md) §7).

