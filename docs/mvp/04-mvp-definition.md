# 04 — MVP Definition: Scope, Exclusions, Build-vs-Buy, Costs, Roadmap

Version 0.1 · 2026-10-17 · Status: Proposed. Gated by Stage 0 validation ([07](../validation/07-validation-plan.md)) · Requirement IDs refer to the [PRD](../product/03-prd.md).

---

## 1. MVP in one sentence
**"Never miss a date, record any hearing in 60 seconds."** This is an Android-first (plus web) matter diary for young litigators in one court ecosystem. It has a reliable next date with provenance, a *Tomorrow* brief, voice-note and order-PDF digests, shareable client updates, basic explicit memory, three safe drafting templates, and a citation checker.

## 2. Design constraints
- **Team:** 1–2 builders (TypeScript full-stack) plus a part-time founder doing research and sales. Build time is ~12 weeks after Stage 0.
- **Budget:** infra and AI under **₹15,000 a month** through the pilot; one-off legal and security spend under ~₹4–5 lakh (estimate).
- **Risk:** nothing ships that touches Rule 36, consumer advice, or unverified citations.
- **Distribution:** one city and one court ecosystem (default: Delhi district courts + Delhi HC; A-14).

## 3. MVP scope (IN)

| # | Capability | PRD refs | Why it's in |
|---|---|---|---|
| 1 | Sign-in (Google / email magic link), onboarding: role, home courts, reminder time | FR-P*, UJ-1 | Activation in under 7 minutes |
| 2 | Matters: quick-add, full edit, timeline, court master list (launch city), custom forums | FR-M1–M3, M5 | Core object |
| 3 | **Canonical next date with provenance** + conflict banner + "needs attention" list | FR-H1, H5, H6 | The wedge (T2); trust |
| 4 | **Tomorrow / Today** views + evening push + morning summary + "no update after hearing" nudge | FR-H2, H3 | Daily habit loop |
| 5 | **Voice note → structured hearing update** (EN/HI/Hinglish), offline capture | FR-V1–V4 | Hearing recorded in 60 s; strongest differentiator in the AI matrix |
| 6 | **Order PDF digest** with page/quote anchors (share sheet in; text layer first, OCR fallback) | FR-D1–D3 | Second core AI job; cheap |
| 7 | Compliance deadlines from directions (user-confirmed) | FR-H7 | Falls out of 5 and 6 |
| 8 | **Client update draft → user shares via WhatsApp** (never auto-sent) | FR-CL1, CL2 | Daily pain for independents; compliant |
| 9 | **Explicit memory v0**: profile, preferences, matter facts; confirm-before-save; memory screen; matter-scoped retrieval | FR-ME1–ME6 | Seeds the moat (T4) |
| 10 | **3 system templates** (adjournment application; vakalatnama particulars sheet; legal notice skeleton) + user DOCX templates with {{fields}}; DOCX export; no model-generated authorities | FR-T1–T3, T5, T6 | Drafting is daily, and templates are safe |
| 11 | **Citation checker** (Indian Kanoon API resolve; ✔/✖/?) + draft consistency check | FR-T4, T8 | Directly addresses the 2026 SC misconduct risk; cheap |
| 12 | Fee log (agreed / received / outstanding per matter) | FR-CL3 | Cheap; validates billing interest before v1 invoices |
| 13 | **eCourts lookup, user-driven, in-app**: an in-app browser opens the official page, the *user* solves the captcha, and the app reads the result page on the device with consent, then parses the next date and orders list | FR-C1–C3 | Magic without server-side scraping (D-003). **Ships only if spike T1 + counsel ⚖ clear it**; otherwise manual + PDF only |
| 14 | Offline-first sync; app lock; encrypted local DB; export everything; delete account; AI audit log | FR-P2–P4, P8 | Trust and confidentiality basics |
| 15 | Subscription: founding-member annual plan via a **Razorpay payment link** (manual entitlement) during the pilot → Razorpay subscriptions / UPI Autopay at public beta | FR-P5 | Validate payment early without building billing |

## 4. Explicit exclusions (OUT) and why

| Excluded | Why | Earliest |
|---|---|---|
| Legal research corpus, case search, AI research Q&A | Incumbent moat; costly; hallucination liability (D-001). Link out to Indian Kanoon instead | Not planned |
| Any marketing, lead-gen, directory, profile pages, social content tools | Rule 36 / BCI 2025 (D-006) | Never (profile page only after ⚖, v2+) |
| Client-facing portal or automated client messaging | Rule 36 optics; UPL; support load | v2 ⚖ |
| Invoices with GST/RCM, client-expense ledger | Needs CA review; low pain evidence so far | v1 |
| Limitation calculator | Rule table needs legal review; error-prone doctrine | v1 ⚖ |
| Chamber / team accounts, assignment, senior dashboard | Adds permissions complexity; validate the solo habit first | v2 |
| Live item-position alerts; cause-list PDF ingestion | Feasibility per court unknown; needs spike | v1 |
| Chat over matter documents; translation | Nice-to-have; adds cost | v1 |
| WhatsApp Business API reminders | Template approval, BSP cost and policy overhead; push is enough to start | v1 |
| Hindi UI (content is EN/HI from day 1) | Delhi pilot users are comfortable with an English UI [assumption A-15] | v1 |
| iOS public release (TestFlight for pilot only) | ~6% share; review overhead | Public beta, if demanded |
| Native desktop app | Web/PWA covers laptop drafting (A-16) | Later |
| Bulk court-data scraping, server-side captcha solving, reseller APIs | Legal and terms risk; cost unknown (D-003) | After ⚖ + pricing |
| Phone OTP login | DLT registration and SMS cost; SIM-swap risk | v1 if demanded |
| Outcome prediction, judge analytics | Reliability; profiling; optics | Never |

## 5. Build vs. buy

| Component | Decision | Choice (primary / fallback) | Rationale |
|---|---|---|---|
| Mobile + web client | **Build** | Expo (React Native) + react-native-web; PWA for desktop | One TypeScript codebase; largest ecosystem (raw/06 §1) |
| Local DB + sync | **Buy (exit to self-host)** | PowerSync Cloud (Free → Pro $49) / PowerSync Open Edition self-hosted | Relational, offline, SQLite on all platforms; escape hatch (V1) |
| Primary DB | **Buy (managed)** | Supabase Postgres in Mumbai (*confirm region*) / AWS RDS Mumbai | RLS, pgvector, auth, storage in one bill; plain Postgres for portability |
| Auth | **Buy** | Supabase Auth (Google, email magic link, passkeys later) | Commodity |
| Object storage | **Buy** | Supabase Storage (same region) / S3 ap-south-1 | Residency; one vendor during the MVP |
| Background jobs | **Build (thin)** | pg-boss on Postgres + a small Node worker (Mumbai VM or Supabase Edge Functions) | No extra vendor |
| LLM | **Buy via gateway** | Claude on Bedrock India profile (Haiku 4.5 for extraction, Sonnet 5 for drafting) / Sarvam-hosted open models / first-party Haiku 5.5 if the user opts out of India-only mode | Only documented in-India, ZDR route to frontier models (raw/06 §4) |
| Speech-to-text | **Buy** | Sarvam STT (₹0.49/min) / Whisper-class fallback | Indic + Hinglish |
| OCR | **Buy** | Sarvam Document AI (₹0.50/page) / vision LLM / Google Document AI | Hindi scans; Textract lacks Hindi |
| Citation resolution | **Buy** | Indian Kanoon API (₹0.02–0.50 per request; attribution required; A-17) / official eSCR and HC links | Cheapest real index |
| Court master data | **Build** | Curated JSON for the launch city | Small, high-value |
| eCourts lookup | **Build (device-side, user-driven)** | In-app browser + on-device parser ⚖ | Avoids server automation |
| Templates / DOCX | **Build on OSS** | docx / docxtemplater | Cheap, controllable |
| Memory | **Build** | Postgres tables + pgvector, RLS, matter_id filter | Confidentiality; no third-party memory SaaS (D-005) |
| Payments | **Buy** | Razorpay payment links → Subscriptions + UPI Autopay / Cashfree | 2% fee; UPI-native |
| Push notifications | **Buy** | Expo Notifications (FCM/APNs) | Free |
| Analytics | **Buy (privacy-safe)** | Self-hosted PostHog or Umami on a small Mumbai VM; no content events | Privacy |
| Error tracking | **Buy** | Sentry (free/dev tier) with PII scrubbing | — |
| Support | **Buy** | WhatsApp Business app (free) + simple help centre (static site) | Matches user habit |
| Legal docs (ToS, DPA, privacy) | **Buy (counsel)** | Indian tech-law counsel ⚖ | Non-negotiable |

## 6. Expected operating costs

All figures are **estimates** built from the verified unit prices in [raw/06](../../research/raw/06-tech-stack-and-costs.md). FX is ₹90/USD. GST is excluded unless stated. Re-run them with pilot telemetry.

### 6.1 AI unit costs per action (India-resident route: Bedrock India, +10% regional premium assumed)
| Action | Model | Tokens (in / out) | Est. cost |
|---|---|---|---|
| Voice note structuring (1 min audio) | Sarvam STT + Haiku 4.5 | 1.5k / 0.5k | ₹0.49 + ₹0.40 ≈ **₹0.90** |
| Order digest (8 pages, text layer) | Haiku 4.5 | 8k / 0.8k | ≈ **₹1.20** |
| Order digest (8-page scan) | Sarvam OCR + Haiku 4.5 | — | ₹4.00 + ₹1.20 ≈ **₹5.20** |
| Client update | Haiku 4.5 | 2k / 0.3k | ≈ **₹0.35** |
| Template draft | Sonnet 5 | 6k / 1.5k | ≈ **₹2.70** |
| Citation check (per citation) | IK API search + doc | — | ≈ **₹0.70** |
| Memory extraction (batched, −50%) | Haiku 4.5 | 1k / 0.2k | ≈ **₹0.10** |

*If Haiku 5.5-class pricing ($0.10/$0.50) becomes available in-region, the Haiku-routed lines fall by about 90%.*

### 6.2 Per-user monthly variable cost
| Profile | Usage assumption | India-resident route | With Haiku 5.5-class |
|---|---|---|---|
| **Pro user** | 25 voice notes, 15 order digests (30% scanned), 8 drafts, 15 updates, 20 citation checks, memory | **≈ ₹100** | ≈ ₹55 |
| **Free user** | Capped at 10 AI actions | **≈ ₹8** (+ ~₹2 infra share) | ≈ ₹4 |
| Pilot user (unrestricted) | Heavy usage | ≈ ₹150 | ≈ ₹80 |

**Implication.** At **₹299/month** (≈ ₹247 net of 18% GST and ~2.4% gateway fees), contribution after ₹100 of variable AI cost is about ₹147 per Pro user, roughly 60% before fixed costs. At ₹399 it is about 70%, and at ₹499 about 76%. The PRD target of ₹60 per Pro user is a **6-month goal** that depends on model routing and price moves. The launch budget is ₹100. → **Price-test range: ₹299–499/month, ₹2,999–3,999/year.**

### 6.3 Fixed monthly costs
| Line | Pilot (≤ 100 users) | Beta (~1,000 free + 100 Pro) | Growth (~10,000 free + 1,000 Pro) |
|---|---|---|---|
| Supabase (Pro + compute) | ₹2,250 ($25) | ₹3,600 ($40) | ₹10,000–20,000 |
| PowerSync | ₹0 (Free) | ₹4,400 ($49) | ₹8,000–60,000 (self-host to cut) |
| Worker VM + analytics VM (Mumbai) | ₹1,500 | ₹2,500 | ₹8,000 |
| Storage / egress | ₹200 | ₹1,000 | ₹8,000 |
| Apple dev ($99/yr) + domain + email + Sentry | ₹1,200 | ₹2,000 | ₹6,000 |
| **Fixed subtotal** | **≈ ₹5,000** | **≈ ₹13,500** | **≈ ₹40,000–1,00,000** |
| Variable (from 6.2) | 30 pilot × ₹150 = ₹4,500 | 1,000×₹10 + 100×₹100 = ₹20,000 | 10,000×₹10 + 1,000×₹100 = ₹2,00,000 |
| **Total / month** | **≈ ₹10,000** | **≈ ₹33,500** | **≈ ₹2.4–3.0 lakh** |
| Revenue at ₹399 Pro (net ≈ ₹329) | ₹0 (pilot free) / founding members | ₹32,900 | ₹3.29 lakh |

**Read-out.**
- Free users dominate cost at scale. Free-tier AI caps and Haiku-class routing are existential, not optional.
- Break-even on infra needs roughly a **10% free→Pro mix at ≥ ₹399**, or AI unit costs falling (Haiku 5.5-class in-region).
- Founders' salaries are excluded; this is a bootstrap model.

### 6.4 One-off costs (estimates; get quotes)
| Item | Estimate |
|---|---|
| Indian tech/professional-ethics counsel: ToS, DPA, privacy policy, Rule 36 checklist, eCourts lookup opinion | ₹1.5–3 lakh |
| External pentest (mobile + API) before paid launch | ₹1–2 lakh |
| CA review of fee log and future invoices | ₹15–30k |
| Google Play ($25) + Apple ($99/yr) | ~₹11k |
| Pilot incentives (interview honoraria, 20 × ₹500–1,000) | ₹10–20k |

## 7. Staged roadmap

| Stage | Window | Goal | Key outputs | Gate to proceed (kill or pivot if not met) |
|---|---|---|---|---|
| **0 — Validate** | Weeks 0–4 | Prove pain, habit and willingness to pay | 20 interviews; landing page + pricing fake door; clickable prototype tests (8); 200-order gold set; counsel engaged; spikes T1–T3 | H1 ≥ 40% name dates/hearings a top-3 pain; H5 ≥ 6/8 complete core tasks; H6 ≥ 3% pricing-page CTA → waitlist with ≥ 30% picking a paid plan; extraction prototype ≥ 95% next-date accuracy |
| **1 — MVP build** | Weeks 5–16 | Ship scope §3 to a closed pilot | M1–M4 (see [08](../engineering/08-repo-structure-and-backlog.md)) | All MVP Musts done; gold set ≥ 98%; pentest high and critical fixed; counsel sign-off |
| **2 — Pilot → public beta** | Months 5–7 | Habit and first revenue in one city | 30-user pilot (3 weeks) → open Android beta + web; founding-member plan; student ambassador programme (⚖ terms) | Week-4 retention ≥ 45% of activated; Sean Ellis ≥ 40%; ≥ 50 paying users |
| **3 — v1** | Months 8–12 | Depth for independents; second city | Hindi UI; invoices (GST/RCM, CA-reviewed); certified-copy + limitation tracker (⚖); conflict check; chat-with-matter; cause-list ingestion; item-position spike → feature; WhatsApp self-reminders | 300+ paying; gross margin ≥ 65%; second-city activation ≥ 35% |
| **4 — v2: Chamber + compliant client tools** | Months 12–18 | Expand to seniors and chambers | Chamber plan (assignment, senior dashboard, shared playbooks); advocate-authored client status links (⚖); inbound enquiry log + conflict check (⚖); iOS GA; Tauri desktop if demanded; 1–2 regional languages | Chamber ARPU ≥ 3× Pro; zero Rule-36 complaints |
| **5 — Platform** | 18+ months | Durable business | Licensed court-data partnership or official API; e-filing hand-off helpers; more states; style learning; firm-level memory; **compliant CRM** = relationship management for existing clients and professional network only | Decided on evidence at that point |

## 8. What would make us change this MVP
- **H1 fails** (dates aren't a top pain): pivot the wedge to drafting and memory (templates, consistency checks, own-document chat) for independents. The diary becomes secondary.
- **WTP fails** (< ₹199): go chamber-first (seniors pay) or partner with a bar association or law school for institutional licences.
- **The eCourts lookup is legally blocked:** stay with manual entry, PDF and voice. That is still differentiated through the voice and digest pipeline.
- **The AI accuracy gate fails:** ship the diary with AI as "suggestions only" and invest in the gold set and evals.
