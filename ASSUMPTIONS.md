# Assumptions Register

This file holds **assumptions only**. They are beliefs we act on that have **not** been verified. Verified facts live in the research report with their citations ([docs/strategy/01-research-report.md](docs/strategy/01-research-report.md)).
Each assumption links to the hypothesis or test that will confirm or kill it ([docs/validation/07-validation-plan.md](docs/validation/07-validation-plan.md)).

Status values: **Open** (untested) · **Supported** (evidence so far is for it) · **Weakened** · **Killed** · **Confirmed**.

| ID | Assumption | Why we believe it (evidence strength) | Risk if wrong | Test | Status |
|---|---|---|---|---|---|
| A-01 | Tracking hearing and next dates across courts is a top-3 weekly pain for junior and young independent litigators | Adjournment frequency (DAKSH; "tareekh pe tareekh"); eCourts app complaints; dozens of diary apps exist (medium, indirect) | Wedge fails | H1 interviews; H3 diary study | Open |
| A-02 | Gen Z lawyers will move their diary from paper, WhatsApp or the eCourts app if onboarding takes under 10 minutes | Gen Z is mobile-native (inference); the eCourts app is losing trust (2.4★) | Activation fails | H2 prototype test; activation metric | Open |
| A-03 | A ₹299–499/month (or ₹2,999–3,999/year) plan is affordable for the paying segment (2–7 years' practice, independent) | Juniors under 2 years earn under ₹10k/month (so they are the free tier); anchors are Indian Kanoon ₹5k/yr and CaseMine ₹13k/yr (medium) | Revenue model fails | H6 fake-door pricing; H7 pre-orders | Open |
| A-04 | Seniors will pay for a chamber plan that gives visibility into their juniors' matters | Chamber structure is common in Indian litigation (inference; not sourced) | Lose the B2B2C path | H9 senior interviews | Open |
| A-05 | Order PDFs are mostly digitally generated with a usable text layer, so OCR is the minority path | eCourts and HC orders are generated from CIS (inference) | Higher OCR cost and error | Gold-set collection (200 orders, 5 courts) | Open |
| A-06 | A small model can extract next date and directions at ≥98% accuracy with user confirmation | LLM extraction quality (inference) | Core feature unsafe | Extraction eval on the gold set | Open |
| A-07 | Hinglish voice notes give usable structured notes through Sarvam STT plus an LLM | Sarvam vendor claims (weak) | Feature downgraded to typing | Prototype test with 20 voice notes | Open |
| A-08 | User-initiated CNR lookups (on device or relayed) work reliably enough to add value without bulk scraping | Open-source SDKs show feasibility; captcha OCR is ~75% (weak) | Manual-only product; less magic | Technical spike T1 | Open |
| A-09 | Lawyers will accept AI processing of matter documents if it is India-hosted, zero-retention and transparent | ABA 512-style norms; Manupatra survey cites ethics as a barrier (weak) | AI features unused | Interview Q block D; opt-in rate | Open |
| A-10 | "Explicit memory" (profile, matter facts, preferences) is valued, not seen as creepy | Harvey ships confirm-before-save memory (weak for India) | Differentiator falls flat | Prototype test task 4 | Open |
| A-11 | Law students and AIBE candidates are an efficient acquisition channel that converts to paid within 12–24 months | ~2.3–2.5 lakh AIBE candidates a year (verified count; conversion is an assumption) | CAC higher than planned | Cohort tracking | Open |
| A-12 | Variable AI cost per Pro user stays ≤ ₹100/month at launch (India-resident route) and ≤ ₹60 by month 6, with Haiku-class routing and caps | Price tables (verified) + usage model (assumption) | Margin squeeze | Telemetry in the pilot | Open |
| A-13 | Web checkout (Razorpay / UPI Autopay) is allowed alongside the Android app under Play policy for this category | Play alternative billing exists in India (reported) | 11–15% fee on mobile sales | Policy review before launch | Open |
| A-14 | Delhi (district courts + HC) is a good launch geography (dense, English/Hindi, eCourts coverage) | Inference; the founder network is unknown | Slow early traction | Founder network check; H1 sampling | Open |
| A-15 | Hindi plus English covers most of the first 1,000 users | Launch geography assumption | Need regional languages earlier | Interview language log | Open |
| A-16 | Desktop need is satisfied by a web app / PWA for the first 12 months | Litigators are mobile-heavy in court; drafting happens on laptops (inference) | Need native desktop sooner | Usage telemetry; interview | Open |
| A-17 | Indian Kanoon API terms allow commercial citation-verification lookups with attribution | API terms require attribution; commercial-reuse scope unclear | Need another verification source | Email to IK; counsel review | Open |
| A-18 | A 1–2 person team can ship the MVP in ~12–14 weeks | Scope in the MVP doc (inference) | Runway | Milestone tracking | Open |
