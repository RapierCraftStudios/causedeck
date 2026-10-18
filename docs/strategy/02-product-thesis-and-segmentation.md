# 02 — Product Thesis & Target-User Segmentation

Version 0.1 · 2026-10-17 · Status: hypothesis. The evidence is in the [research report](01-research-report.md); the open beliefs are in [ASSUMPTIONS.md](../../ASSUMPTIONS.md).

---

## 1. One-line thesis

> **A pocket chamber for the young Indian litigator:** a mobile-first matter and hearing diary that remembers how *you* practise. Every order, hearing and voice note becomes a reliable next date, a to-do list and a client update, with AI that never invents law. It costs less than a monthly phone plan.

## 2. Thesis in five claims (each falsifiable)

| # | Claim | Evidence today | Falsified if… |
|---|---|---|---|
| T1 | **Daily-workflow software for juniors and solos is unserved.** Research is crowded and expensive. Practice management is either enterprise-priced (Provakil, MyKase, demo-gated) or a no-AI hobby diary app. | Competitor matrix ([05](05-competitor-and-ai-matrices.md) A3); eCourts app at 2.4★ with complaints about lost cases and offline mode removed | Interviews show juniors happily use an existing tool (eCourts app, Provakil, a diary app) and wouldn't switch |
| T2 | **The "next date" is the atomic unit of litigation practice.** Make it reliable and the rest (prep, client updates, tasks, fees) hangs off it. | Adjournment frequency (DAKSH: 54% of civil sitting time in its sample); 66.6 lakh district cases delayed due to lawyer unavailability (NJDG via press) | Fewer than 40% name dates or hearing tracking as a top-3 weekly pain (H1) |
| T3 | **Narrow AI over the lawyer's own material is both cheaper and safer than research AI.** Order digests, voice notes, templates and memory need small models and no corpus, and verification is part of the design. | Model price tables (Haiku-class ≈ $0.10–1 per M input tokens); SC 2026 "misconduct" rulings on fake citations; Stanford 17–34% hallucination in legal RAG | Users only value AI if it does open-ended research; extraction accuracy is below 98% even with confirmation |
| T4 | **Explicit, matter-scoped memory is the long-term moat.** The more matters, templates and preferences the product holds, the harder it is to leave, and the user owns and can export all of it. | Harvey Memory (Aug 2026) shows the pattern at the top end; nobody offers it at the low end in India | Users don't engage with memory features, or see them as a privacy risk |
| T5 | **Distribution can be compliant and cheap.** We sell *software to lawyers*, through students, clinics, moots and peer word of mouth, and never help lawyers market themselves to the public. | ~2.3–2.5 lakh AIBE candidates a year (an entry funnel); Rule 36 constrains lawyers, not the sale of software to them | CAC through these channels is above ~₹600 per paying user |

## 3. Why now
1. **Courts have made AI risk concrete.** The Supreme Court's 2026 orders call reliance on unverified AI citations misconduct and have asked the BCI to frame norms. Lawyers need a *safe* AI path, and generic ChatGPT is not one.
2. **The cost curve has collapsed.** Small frontier models cost ~$0.10–1 per million input tokens. Claude became available in-country on Bedrock in India on 29 Sep 2026, with zero data retention by default, so India-resident AI is affordable for the first time at a ₹300 price point.
3. **eCourts Phase III (₹7,210 cr) has digitised the pipes.** Orders and cause lists are online, but the official UX lags behind and its ratings are falling.
4. **DPDP Rules start to bite in May 2027.** A product built privacy-first now becomes a selling point against WhatsApp-and-Drive practice.
5. **A Gen Z cohort is entering the Bar** (~1.6–1.8 lakh AIBE passes a year). They are phone-native, used to UPI, and already use ChatGPT.

## 4. Segmentation

### 4.1 Segment map

| Segment | Who | Size signal | Core jobs | Pay ability | Fit | Role |
|---|---|---|---|---|---|---|
| **S1 Junior in a chamber** (0–3 yrs) | Works under a senior; runs the senior's diary, cause lists, filings and drafts; often also has a few own matters | Most of the ~1.6–1.8 lakh annual AIBE passers start here [inference] | Track many matters across courts; prep briefs for the senior; record what happened; draft routine applications | Low: <₹10k/month for 79% of those with under 2 years (Vidhi, via PIL) | ★★★ usage | **Primary user**. Free or low tier. Habit + virality inside chambers |
| **S2 Young independent litigator** (2–7 yrs) | Own practice, solo or 2–3 peers; district court + HC; drafting and client handling themselves | Unknown share of ~10–13 lakh practising [weak inference] | Everything S1 does plus client updates, fee tracking, intake, conflicts | Medium: pays for Indian Kanoon, CaseMine, LiveLaw at ₹1k–13k/yr | ★★★ | **Primary payer** (Pro) |
| **S3 Law student / intern / AIBE candidate** | Final-year students, interns in chambers, recent graduates | ~2,000 law colleges; ~2.3–2.5 lakh AIBE candidates a year | Learn the diary practice, track internship matters, moot prep | Very low | ★★ | **Acquisition funnel** (free, education framing) |
| **S4 Senior with a small chamber** (10+ yrs, 2–6 juniors) | Decides chamber tools; often less tech-savvy | Unknown | Visibility of all matters, juniors' updates, client communication | High | ★★ (via juniors) | **Expansion payer** (Chamber plan, v2) |
| **S5 Young associate at a law firm** | Corporate and litigation associates at mid and large firms | — | Firm tools (Harvey, Legora, Lucio, MyKase) | Firm pays | ★ | Not targeted (firm procurement, enterprise security reviews) |
| **S6 Young in-house counsel** | Company legal teams | — | CLM, matter management (SpotDraft, Legistify) | Company pays | ★ | Not targeted |

### 4.2 Beachhead
**S1 + S2 litigators in one metro court ecosystem: district courts + High Court.** Delhi is the default proposal, with Bengaluru or Mumbai as alternatives depending on the founders' network (A-14).
- Why a litigator rather than a transactional lawyer: the next-date problem is unique to litigation, transactional tooling is crowded (SpotDraft, Spellbook), and litigators are the bulk of the Bar.
- Why one ecosystem: cause-list formats, court naming, languages and the network effects inside chambers are all local. A dense launch gives word of mouth.

### 4.3 Personas (built from research patterns, to be validated in interviews)

**Ananya, 24: junior in a Delhi HC chamber (S1)**
- Enrolled 2025 and earns ₹15k/month. Tracks about 60 of her senior's matters plus 4 of her own.
- Copies the next day's list into a notes app every night. Messages the senior's clerk on WhatsApp for item numbers.
- Has missed a listing once when an advance list changed. Uses ChatGPT for first drafts but is now scared of fake citations.
- *Wants*: "Tell me tonight what's listed tomorrow, where, at what item number, and what I need to carry."

**Rohit, 28: independent at Saket district court + Delhi HC (S2)**
- 5 years' practice and 70 live matters, mostly civil, consumer and bail.
- Keeps a paper diary and a WhatsApp group with his munshi. Clients call him constantly for updates.
- Pays ₹5k/yr for Indian Kanoon and drafts in MS Word from old files. Fees come by UPI and cash, and he loses track of what is outstanding.
- *Wants*: "Never miss a date, send clients updates in 10 seconds, find my old draft for this kind of application."

**Meera, 22: final-year student interning in a chamber (S3)**
- Wants to look sharp to her senior and practise maintaining a matter file. Will tell her whole batch if the tool is good.

**Mr. Saxena, 52: senior with 4 juniors (S4)**
- Wants one screen showing every listed matter, who is attending, and what happened. Pays if it saves him from embarrassment in court.

## 5. Positioning

| | Lawyer OS | eCourts app | Paper / WhatsApp | Provakil / MyKase | CaseMine / SCC / Prism | ChatGPT |
|---|---|---|---|---|---|---|
| Built for | Junior & solo litigators | Everyone | — | Firms / enterprise | Research | Everyone |
| Daily diary & next dates | ●  | ◐ unstable | ● manual | ● | ○ | ○ |
| Remembers *your* practice | ● | ○ | ◐ in your head | ◐ | ○ | ◐ generic |
| AI you can trust in court | ● verification-first | ○ | ○ | ? | ● (premium) | ✖ hallucination risk |
| Price for a junior | Free / ₹199–499 | Free | Free | Demo-gated | ₹5k–50k/yr | Free / ₹1,999 |

**Positioning statement.** For young Indian litigators who juggle dozens of matters across courts, Lawyer OS is the practice diary that turns orders and hearings into reliable next dates, tasks and client updates, and learns how you work. Unlike the eCourts app or a paper diary, it remembers your practice. Unlike research databases and ChatGPT, its AI works only on your own material and never invents a citation.

## 6. Business-model sketch (to validate)
- **Free** (students, S1): up to ~30 active matters, manual + PDF digest (capped), basic reminders, 10 AI actions a month.
- **Pro** (S2): unlimited matters, voice notes, templates and drafts, memory, citation checker, exports, priority sync. Price-test ₹199 / ₹299 / ₹499 per month, with ~2 months free on annual.
- **Chamber** (S4, v2): per-seat pricing with a senior dashboard and assignment.
- No ads, no selling of data, no lead-gen revenue. This is both a trust promise and a Rule 36 guardrail.

## 7. What this thesis explicitly is *not*
- Not a research database or citator (D-001).
- Not a lawyer marketplace, directory or lead-gen tool (D-006).
- Not a consumer legal-advice app (D-007).
- Not an enterprise CLM or legal-ops suite.
