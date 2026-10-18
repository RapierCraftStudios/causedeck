# 06 — Risk Register

Version 0.1 · 2026-10-17 · Owner: founder(s) · Review cadence: every two weeks until launch, then monthly. Evidence: [research/raw/04](../../research/raw/04-regulatory-ethics.md), [02](../../research/raw/02-indian-practice-management-and-legaltech.md), [03](../../research/raw/03-global-comparators.md), [06](../../research/raw/06-tech-stack-and-costs.md).

**Scoring.** Likelihood (L) and Impact (I) are each rated 1–5. Score = L × I. A score of 15 or more is **High**, 8–14 is **Medium**, and 7 or less is **Low**.
⚖ = needs qualified Indian legal (or tax) review before launch. *Verified* marks a risk grounded in a sourced rule or event; *Inferred* marks our own assessment.

---

## 1. Legal & professional-ethics risks

| ID | Risk | Basis | L | I | Score | Mitigation | Trigger / KRI | Owner |
|---|---|---|---|---|---|---|---|---|
| L1 | A product feature is treated as helping advocates **solicit or advertise** (Rule 36), exposing users to s.35 proceedings and the product to reputational and legal action ⚖ | *Verified*: Rule 36 text; Madras HC (3 Jul 2024) directions against aggregators; BCI release of 17 Mar 2025; Delhi, P&H and Karnataka bar notices in 2025 | 3 | 5 | **15 High** | D-006 permanent exclusions: no directory, ratings, prospect outreach, ads, SEO or influencer tooling. Every growth or CRM feature goes through a pre-launch "Rule 36 checklist" signed off by counsel. Our own marketing targets lawyers as software buyers, never the public. | Any feature request that touches non-clients; any user complaint or bar-council query | Founder + counsel |
| L2 | **Our own go-to-market** recruits lawyers as paid promoters or "legal influencers", or runs testimonials that look like advertising of their services | *Verified*: BCI 2025 release on influencer and celebrity endorsement | 3 | 4 | **12 Med** | Ambassadors are law *students* and *users*, rewarded with product credit, not cash per referral. Testimonials talk about the software only, with no case outcomes and no "best lawyer" claims. Counsel reviews the ambassador terms. | Campaign drafts | Founder |
| L3 | Referral, lead-sharing or commission flows are construed as fee-sharing or touting ⚖ | *Verified* Rules 36/37/20 text; *Inferred* application (no express fee-sharing rule found) | 2 | 5 | **10 Med** | No marketplace, no lead routing, no revenue share tied to legal fees. Referral credits apply only to software subscriptions. | Any partnership proposal involving legal-service revenue | Founder |
| L4 | **AI-fabricated or misgrounded citation** reaches a court filing through our product, leading to user misconduct exposure and brand damage | *Verified*: SC, *Pooja Ramesh Singh v. J&K Bank* (2 Jul 2026, reported) treats it as misconduct; Bombay HC costs (Jan 2026); Stanford 17–34% error rates | 3 | 5 | **15 High** | D-004: templates carry no authorities; citation verifier; UNVERIFIED badge blocks export without a logged override; generated-vs-verified audit log; "AI-assisted, verify before filing" footer in exports (removable only with acknowledgement). | Rate of verifier misses; any user report | Tech lead |
| L5 | Product drifts into **unauthorised practice of law / consumer legal advice** (e.g. clients chatting with an AI) ⚖ | *Verified*: Rule 37 text; *Inferred*: UPL unsettled; no Indian authority found | 2 | 4 | **8 Med** | D-007: only advocates and students as users. Client-facing surfaces are send-only and authored by the advocate. No public chatbot. | Feature scoping | Founder |
| L6 | **Scraping / automated access to eCourts** breaches the portal's terms or the IT Act, or the portal blocks us ⚖ | *Verified*: captcha-gated portal, no public API; terms not retrieved; *Inferred* risk | 3 | 4 | **12 Med** | D-003: user-initiated lookups only, rate-limited; manual entry and paste-from-PDF paths; no republishing. Get legal advice before any server-side automation. Evaluate licensed APIs. | Portal changes; legal notice; error-rate spike | Tech lead + counsel |
| L7 | Reuse of **editorial content** (headnotes, summaries) from commercial publishers | *Verified*: *EBC v. D.B. Modak* (2008) | 1 | 4 | **4 Low** | Use only raw judgment text and official sources; link out; never ingest publisher headnotes. | Content ingestion review | Tech lead |
| L8 | **GST / invoicing errors** in the billing module (RCM vs forward charge) cause user tax problems ⚖ | *Verified-secondary*: Notification 13/2017 RCM for business-entity recipients | 2 | 3 | **6 Low** | Invoice module waits for v1 and a CA review. Legends are configurable. Show a disclaimer. | — | Founder + CA |
| L9 | **BCI AI norms** (committee directed July 2026) impose disclosure or usage obligations we haven't built for | *Verified-secondary*: SC direction to BCI | 3 | 3 | **9 Med** | Build AI-use logs and per-document "AI-assisted" disclosures now. Watch BCI and state-bar releases monthly. Keep features configurable. | BCI publication | Founder |
| L10 | Our own **terms, DPA or privacy policy** are inadequate for lawyer-client data ⚖ | *Inferred* | 3 | 4 | **12 Med** | Counsel-drafted ToS, DPA (advocate is Data Fiduciary, we are Processor), sub-processor list and privilege-preserving clauses before public launch. | Pre-launch gate | Founder + counsel |

## 2. Privacy & data-protection risks

| ID | Risk | Basis | L | I | Score | Mitigation | Owner |
|---|---|---|---|---|---|---|---|
| P1 | **DPDP non-compliance** when the substantive rules commence (~13–14 May 2027): breach notices, security safeguards, processor contracts | *Verified-secondary*: DPDP Rules 2025 commencement schedule; Rule 7 (72 h) | 3 | 4 | **12 Med** | DPDP readiness checklist done before the paid launch: breach runbook (Board + principals), 1-year log retention, processor DPA, deletion SLAs. | Founder |
| P2 | **CERT-In 6-hour reporting** missed after an incident; logs not kept 180 days in India | *Verified-primary*: CERT-In Directions 28 Apr 2022 | 2 | 4 | **8 Med** | Incident runbook with a named on-call person; India-region log store; NTP sync. | Tech lead |
| P3 | **Client data in LLM prompts** retained or used for training by a vendor | *Verified*: Bedrock India ZDR default; Gemini paid tier excludes training only; first-party Anthropic has no India region | 2 | 5 | **10 Med** | D-009: route matter content only through zero-retention, no-training endpoints (Bedrock India preferred). Enforce at the gateway with a provider allow-list. Publish sub-processors. | Tech lead |
| P4 | **Cross-matter memory leakage**: one client's facts appear in another client's draft | *Inferred* + PersistBench leakage findings | 2 | 5 | **10 Med** | D-005: retrieval hard-filtered by matter_id; row-level security; tests that try to leak across matters; memory citations visible. | Tech lead |
| P5 | **Third-party personal data** in court records (victims, minors, POCSO/matrimonial) is mishandled or made searchable | *Inferred*; DPDP applies | 2 | 4 | **8 Med** | No people-search across users. Data is visible only to the matter owner. Redaction helper planned for v1. | Tech lead |
| P6 | **Lost or stolen phone** exposes a matter diary (personal phones, shared devices) | *Inferred* | 4 | 3 | **12 Med** | App lock (biometric/PIN), encrypted local DB, remote sign-out, short-lived tokens, no document previews in notifications. | Tech lead |

## 3. AI quality / hallucination risks

| ID | Risk | L | I | Score | Mitigation |
|---|---|---|---|---|---|
| A1 | **Wrong next date or direction** extracted from an order, so a hearing is missed. This is the worst failure for a diary. | 3 | 5 | **15 High** | The user confirms every AI-extracted date before it becomes canonical. Show the source quote and page. Show the eCourts-fetched date next to the AI date when both exist and flag mismatches. Measure extraction accuracy on a 200-order gold set before launch (target ≥98% on next date). |
| A2 | Voice-note transcription errors in Hinglish or regional speech | 3 | 3 | **9 Med** | Show the transcript next to the structured output; editable; dates confirmed explicitly. |
| A3 | Drafts contain plausible but wrong facts drawn from memory | 2 | 4 | **8 Med** | Memory citations inline; facts limited to the current matter; "facts used" panel. |
| A4 | Model or provider changes silently degrade quality | 3 | 3 | **9 Med** | Pinned model versions; regression eval suite (orders, voice notes, drafts) run on every model change. |
| A5 | OCR fails on stamped, skewed or Hindi scans | 3 | 3 | **9 Med** | Test Sarvam against a vision-LLM fallback on 100 real scans; low-confidence banner; manual entry path. |

## 4. Security risks

| ID | Risk | L | I | Score | Mitigation |
|---|---|---|---|---|---|
| S1 | Multi-tenant authorization bug exposes another lawyer's matters | 2 | 5 | **10 Med** | Postgres RLS on every table; sync rules scoped by user or chamber; automated tenancy tests in CI; external pentest before paid launch. |
| S2 | Account takeover (SIM swap, OTP phishing) | 3 | 4 | **12 Med** | Passkeys or Google sign-in preferred over SMS OTP; new-device alerts; session list with remote revoke. |
| S3 | Prompt injection through uploaded documents (e.g. opposing party's filings) causes data exfiltration or tool misuse | 2 | 4 | **8 Med** | AI has no outbound tools in the MVP; outputs are structured and schema-validated; no autonomous actions; documents treated as data. |
| S4 | Secrets or keys leak; small team uses weak operational security | 2 | 4 | **8 Med** | Secret manager; least privilege; 2FA on all vendor consoles; quarterly access review. |
| S5 | Supply-chain compromise via npm dependencies | 2 | 4 | **8 Med** | Lockfiles, Renovate, minimal dependencies, SCA in CI. |

## 5. Vendor lock-in & dependency risks

| ID | Risk | L | I | Score | Mitigation |
|---|---|---|---|---|---|
| V1 | Sync engine vendor (PowerSync Cloud) changes pricing or shuts down | 2 | 4 | **8 Med** | Postgres stays the source of truth; PowerSync Open Edition can be self-hosted; sync behind our own adapter. |
| V2 | LLM provider price or terms change, or the India region is withdrawn | 3 | 3 | **9 Med** | Model gateway abstraction; evals so we can swap to Sarvam-hosted open models or Gemini; per-feature model routing. |
| V3 | Court data source breaks (portal redesign, captcha change, reseller API shuts down) | 4 | 4 | **16 High** | The product must stay useful with zero automated court data: manual entry, PDF digest and voice notes are the core. Treat lookup as an enhancement. Health monitor plus in-app status banner. |
| V4 | Supabase or managed Postgres limits or costs at scale | 2 | 3 | **6 Low** | Plain Postgres features only (no proprietary APIs in the core path); migration runbook. |
| V5 | App-store policy forces in-app billing (15%) or rejects the app | 3 | 3 | **9 Med** | Web checkout plus Play alternative billing (India); a pricing model that tolerates 15%; check store policy before launch. |

## 6. Support & operations risks

| ID | Risk | L | I | Score | Mitigation |
|---|---|---|---|---|---|
| O1 | A tiny team cannot meet support load during court hours (hearing-day urgency) | 4 | 3 | **12 Med** | In-app help plus a WhatsApp support number with business-hours SLA; status page; self-serve FAQ; design so the app works offline when sync fails. |
| O2 | Users expect "100% accurate court data" and blame us for eCourts lag | 4 | 3 | **12 Med** | Show the source and fetch time on every court datum; "last checked" stamps; never auto-overwrite a user-entered date. |
| O3 | Founder burnout or key-person risk | 3 | 4 | **12 Med** | Narrow MVP; boring tech; documented runbooks; no 24×7 promises. |
| O4 | AI cost overrun from heavy users or abuse | 3 | 3 | **9 Med** | Per-user monthly AI budgets, Haiku-class default, batch for non-urgent work, alerts at 80% of budget. |

## 7. Go-to-market & business risks

| ID | Risk | L | I | Score | Mitigation |
|---|---|---|---|---|---|
| G1 | **Low willingness to pay**: juniors earn under ₹10k/month and the free eCourts app and ChatGPT feel "good enough" | 4 | 5 | **20 High** | Freemium plus a cheap annual plan; validate price with a fake-door test before building billing (H6); a chamber plan paid by seniors; student funnel. |
| G2 | Diary habit doesn't move from paper, WhatsApp or the eCourts app (switching cost) | 3 | 5 | **15 High** | Import from the eCourts "My Cases" list, CNR paste and photo-of-diary-page OCR; 5-minute onboarding; value on day 1 (tomorrow's brief). |
| G3 | Incumbent bundles a diary (e.g. Manupatra MyKase, Provakil self-serve tier, Indian Kanoon adds a workspace) | 3 | 3 | **9 Med** | Win on mobile UX, price and memory; ship faster; community relationships. |
| G4 | Distribution through bar associations or colleges is slow and political | 3 | 3 | **9 Med** | Multiple channels: law-student ambassadors, moot and legal-aid clinics, YouTube education (not solicitation), AIBE-prep partners. |
| G5 | Segment too fragmented (court-, state- and language-specific workflows) | 3 | 3 | **9 Med** | Launch in 1–2 cities and 1–2 court types (Delhi district courts + Delhi HC, or similar); expand from data. |
| G6 | Runway runs out before product–market fit | 3 | 5 | **15 High** | Keep infra under ₹25k/month until 1,000 users; stage-gates with kill criteria (see [07](../validation/07-validation-plan.md)). |

---

## Top risks summary (score ≥ 15)
1. **G1** Willingness to pay (20)
2. **V3** Court-data fragility (16)
3. **L1** Rule 36 solicitation exposure (15)
4. **L4** AI citation misconduct exposure (15)
5. **A1** Wrong next date extracted (15)
6. **G2** Habit switching (15)
7. **G6** Runway (15)

## Items needing qualified Indian legal / tax review (⚖ list)
1. Current official BCI Rules text, including the 2008 Rule 36 website proviso and Schedule, and its gazette status.
2. Status of the Sulekha/JustDial SLPs in the Supreme Court (third-party listing of advocates).
3. Legality of user-initiated and server-relayed automated access to eCourts; the portal's terms.
4. Ambassador/referral programme terms (no fee-sharing or touting).
5. ToS, DPA and privacy policy; advocate as Data Fiduciary vs the platform; DPDP s.17 exemptions.
6. Limitation and deadline rule tables before any deadline calculator ships.
7. GST/RCM invoice templates (CA review).
8. Any future inbound-enquiry, profile-page or client-portal feature.
9. Any BCI AI norms issued after the July 2026 SC direction.
