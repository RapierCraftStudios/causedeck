# 07 — Validation Plan

Version 0.1 · 2026-10-17 · Stage 0 runs over weeks 0–4. Results go into [ASSUMPTIONS.md](../../ASSUMPTIONS.md) (status updates) and [DECISIONS.md](../../DECISIONS.md) (gate decisions).

**Principles**
- Each hypothesis has a metric, a threshold and a kill or pivot action, all set *before* we look at the data.
- We learn from behaviour (sign-ups, payments, task completion) more than from opinions.
- Every outreach to lawyers is about *our software*. We never offer to promote their services. Honoraria are flat thank-you payments, never tied to referrals.
- Interviews involve no client-confidential material. We ask participants to anonymise examples or use public orders.

---

## 1. Falsifiable hypotheses

| ID | Hypothesis | Method | Metric & threshold (pass) | If it fails |
|---|---|---|---|---|
| **H1** | Tracking dates and hearings across courts is a top-3 weekly pain for S1/S2 litigators | 20 interviews (problem ranking card sort) | ≥ 40% rank it top-3 **and** ≥ 30% report a missed or nearly missed listing in the last 6 months | Pivot the wedge to drafting and memory (MVP §8) |
| **H2** | Juniors currently spend ≥ 30 min/day on diary, cause-list and update admin | Interviews + 5-day diary study (n=8) | Median ≥ 30 min/day | Reframe the value proposition around reliability, not time saved |
| **H3** | Litigators will record a hearing outcome in-app within 2 hours of the hearing if it takes ≤ 60 s | Prototype + 2-week concierge pilot (WhatsApp voice note to us → we return a structured update; n=10) | ≥ 60% of hearings logged within 2 h in week 2 | Drop voice-first; emphasise PDF digest and manual entry |
| **H4** | AI can extract the next date and directions from real orders accurately enough to be trusted with confirmation | Gold set of 200 orders across 5 courts (incl. 40 Hindi or scanned) | Next date ≥ 98%; directions recall ≥ 90%; zero hallucinated dates (date not present in source) | Ship AI as suggestion-only; invest in OCR and prompts |
| **H5** | The core flows are learnable without help | Clickable prototype test (n=8): add 5 matters, read Tomorrow, record hearing, share update | ≥ 6/8 finish all tasks unaided in < 10 min; SUS ≥ 70 | Redesign onboarding before the build |
| **H6** | There is willingness to pay ₹299–499/month among S2 | Landing page with pricing fake door (3 price arms) + interview WTP (Van Westendorp) | Visitor → waitlist ≥ 8%; ≥ 30% of the waitlist pick a paid tier; Van Westendorp acceptable range includes ≥ ₹299 | Test ₹149–199, chamber-paid, or institutional model |
| **H7** | Some will pay *before* the product exists | Founding-member pre-order (₹1,999/yr, refundable) via Razorpay link to the warm waitlist | ≥ 15 pre-orders from ≥ 150 qualified waitlist contacts | Treat WTP as unproven; delay billing; reconsider the segment |
| **H8** | Explicit memory is valued and not seen as creepy | Prototype task: review "what Lawyer OS remembers" + 5-point desirability + concern probe | ≥ 60% rate memory ≥ 4/5; < 20% voice a strong privacy objection after explanation | Make memory opt-in and minimal; drop it from positioning |
| **H9** | Seniors would pay for chamber visibility | 6 senior interviews + concept test | ≥ 3/6 say they'd pay ≥ ₹999/month for a chamber of 3–5 | Keep the chamber plan in v2 but deprioritise |
| **H10** | Lawyers accept AI processing of matter documents when it is India-hosted with no training | Interview block D + opt-in rate in the pilot | ≥ 70% opt in to AI features in the pilot | Offer local-only and no-AI modes; position diary-first |
| **H11** | Law students and interns are an efficient channel | Ambassador test in 3 colleges (⚖ terms) | ≥ 150 sign-ups in 4 weeks; ≥ 20% of those are practising advocates reached via the students | Shift to bar-association and court-complex channels |
| **H12** | Device-side, user-driven eCourts lookup works reliably | Spike T1 on 3 court types × 30 lookups | ≥ 90% successful parse after the user solves the captcha; median ≤ 45 s total | Ship manual + PDF only |

## 2. Interview programme

**Sample (n = 20 litigators + 6 seniors + 4 students):**
- Litigators: 8 S1 juniors in chambers, 8 S2 independents with 2–7 years' practice, 4 mixed or tribunal.
- Courts: launch city district courts and High Court, plus 4 interviews in a second city as a contrast.
- At least 8 women and at least 6 first-generation lawyers.
- Recruit through law-school alumni networks, moot and clinic networks, and personal referrals. Do not recruit through bar-association mass messages until counsel confirms the outreach wording.
- Incentive: ₹500–1,000 honorarium or a free year. 45 minutes, recorded only with consent, no client-identifying information.

### Script (S1/S2, 45 min)

**A. Context (5 min)**
1. Walk me through your practice: courts, matter types, how many live matters, whether you work under a senior.
2. What does a typical court day look like, from the evening before to the evening after?

**B. Dates, lists, hearings (12 min)**

3. How do you find out what's listed tomorrow? Show me, using your phone or diary as you actually do it.
4. Where do you write the next date after a hearing? Show me the last 3 entries.
5. Tell me about the last time a date or listing surprised you. What happened? What did it cost?
6. How do you know when your item is about to be called? What do you do while waiting?
7. Who else (clerk, senior, colleagues, WhatsApp groups) is involved in tracking dates? How?
8. Have you used the eCourts app or website? What works and what doesn't? Any other app?

**C. Orders, drafting, research (8 min)**

9. When an order comes out, how do you get it, and what do you do with it?
10. How did you draft your last application? Where did the starting text come from?
11. Which research tools do you use, and who pays for them? Have you used ChatGPT or similar for legal work? What happened?
12. Have you heard of the recent Supreme Court orders on AI-generated fake citations? Did they change anything for you?

**D. Clients, fees, confidentiality, AI comfort (10 min)**

13. How do clients get updates from you? How much time does that take each week?
14. How do you record fees received? How do you know who owes you?
15. Where do client documents live (phone, WhatsApp, Drive, laptop, paper)? Have you ever worried about that?
16. Would you let an app read your orders and voice notes with AI if the data stays in India and is never used for training? What would make you say no?

**E. Ranking & WTP (8 min)**

17. Card sort: rank these 10 problems by how much they hurt weekly: dates and listings, item waiting, recording outcomes, client updates, drafting from old files, finding old documents, research cost, fee tracking, limitation and deadlines, coordinating with senior or clerk.
18. Van Westendorp: at what monthly price would a tool that solves your top 2 be (a) too cheap to trust, (b) a bargain, (c) getting expensive, (d) too expensive?
19. What do you pay for today (apps, research, phone plan)?
20. If this existed tomorrow, what would stop you from switching?

**F. Close (2 min)**

21. May we invite you to test a prototype? Who else should we talk to? Ask for a peer, never for a client.

### Senior script additions (S4)
- How do you know what your juniors did in court today?
- What has gone wrong because of a missed update?
- Who decides tools in the chamber, and who pays?
- Would you want juniors' matters in one view? What must stay private?

### Synthesis
- Tag every pain mention with frequency, severity and current workaround.
- Fill a **pain × segment** heat map and record the H1/H2/H6/H9 metrics.
- Write a 2-page Stage 0 readout that updates the ASSUMPTIONS statuses.

## 3. Landing-page tests

**Page:** a single page in English with a Hindi toggle. Headline variants (A/B/C):
- A: "Never miss a date. Record any hearing in 60 seconds."
- B: "Your munshi-lite: the case diary that remembers your practice."
- C: "AI for litigators that never invents a citation."

**Sections:**
- the Tomorrow screenshot;
- a voice-note demo GIF;
- the privacy promise (India-hosted, no training);
- pricing with three arms randomised per visitor: ₹299 / ₹399 / ₹499 per month, each with an annual option;
- CTA "Join the founding batch".
- The form asks: role, courts, years of practice, current tool.

**Channels.** We market software to lawyers, not lawyers to the public:
- law-school alumni groups;
- moot and clinic communities;
- LinkedIn posts by the founders;
- one targeted LinkedIn ad set (₹10–15k) aimed at advocates aged 22–32;
- Telegram or WhatsApp communities only where admins approve.

**Metrics:**
- visitor → waitlist conversion by headline and price arm;
- paid-tier selection share;
- cost per qualified waitlist sign-up (target ≤ ₹150).

**Guardrails:**
- no claims about outcomes for clients;
- no "best lawyer" language;
- no user testimonials about winning cases;
- privacy policy live before the page launches.

## 4. Prototype tests

**Prototype.** A clickable Figma build, or an Expo prototype with stubbed AI, covering:
- onboarding;
- add matters through CNR paste, order photo or quick add;
- the Tomorrow view;
- recording a hearing by voice, using a pre-recorded clip to keep things realistic;
- the confirm-date step;
- sharing a client update;
- the Memory screen;
- drafting an adjournment application and running the citation check.

**Tasks** (n = 8, in person at the court complex where possible, about 30 min each):
1. Sign up and add these 5 matters. Data card provided: 2 CNRs, 1 order PDF, 2 manual.
2. Tell me what you have tomorrow and what to carry.
3. You just finished a hearing. Record what happened.
4. Your client is asking for an update. Send it.
5. Find what the app remembers about you and change one thing.
6. Draft an adjournment application for matter 3 and get it ready to file.

**Measure:**
- task success, time on task and errors;
- SUS score;
- trust ratings for AI-extracted dates (1–5);
- think-aloud quotes.

**Pass:** H5 thresholds, plus average trust in the confirmed date of at least 4/5.

## 5. Concierge / Wizard-of-Oz pilot (H3, H10)
- Run for 2 weeks with 10 litigators.
- After each hearing they send a WhatsApp voice note, or a photo of the order, to our test number. They anonymise names where possible.
- Within 30 minutes we return a structured update, with the AI pipeline run by us and checked by a human.
- Measure the logging rate, latency tolerance, edits requested, and willingness to continue paying ₹299/month.
- **Confidentiality:** a consent form, data deleted at the end of the pilot, processing in India-hosted tools only, and no clients' sensitive matters (POCSO, matrimonial) accepted.

## 6. Technical spikes (in parallel with interviews)

| Spike | Question | Done when |
|---|---|---|
| T1 | Device-side user-driven eCourts lookup and parse (district, HC, SC) | 30 lookups per court type; parse success ≥ 90%; legal memo requested ⚖ |
| T2 | Order digest accuracy with Haiku-class on the Bedrock India profile vs a Sarvam-hosted model | Gold-set report: accuracy, latency, ₹ per digest |
| T3 | Sarvam STT on 30 Hinglish courtroom-corridor voice notes (noisy) | WER and date-capture accuracy measured |
| T4 | Public display-board feeds for live item position (Delhi HC + one district complex) | Feasibility note + terms check ⚖ |
| T5 | Expo + PowerSync performance on a ₹10k Android phone with 500 matters | Cold start < 2.5 s; Tomorrow < 300 ms |

## 7. Stage 0 decision meeting (end of week 4)
- **Inputs:** interview readout, landing-page and pre-order data, prototype results, gold-set and spike reports, counsel's initial view.
- **Outcomes:** GO (build the MVP as specified), GO-WITH-CHANGES (adjust scope or segment), or PIVOT (wedge or segment change per [MVP §8](../mvp/04-mvp-definition.md#8-what-would-make-us-change-this-mvp)).
- Record the outcome as a new entry in DECISIONS.md.
