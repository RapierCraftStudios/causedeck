# 07 — Validation Plan

Version 0.3 · 2026-10-17 · Stage 0 runs over weeks 0–5 · Results feed [ASSUMPTIONS.md](../../ASSUMPTIONS.md) and [DECISIONS.md](../../DECISIONS.md).

> **v0.3 change (D-024, D-025, D-030).** We now validate **Lawyer OS as a whole loop** (prepare → execute → follow-up → continuity → memory) in two markets: **Madras HC (Chennai)** and **Bengaluru**. The proof of value is better preparation, fewer missed obligations, lower cognitive load and continuity. Minutes of data entry saved are now a secondary measure.
> **Founder-reported inputs** ([raw/07](../../research/raw/07-founder-reported-findings-2026-10-17.md)):
> - solo time savings are under 30 min/day;
> - lawyers are reluctant to forward client messages;
> - cause-list parsing is court-specific;
> - chamber aggregation is promising.
>
> These shape the design and are re-tested here.

**Principles**
- Each hypothesis has a metric, a threshold and a kill/pivot action, all set *before* data is seen.
- **Inputs are lawyer-owned only.** We use no client-originated content unless the lawyer explicitly chooses it per item, under counsel-approved guidance.
- **Court data comes only through authorised paths:**
  - lawyer-supplied lists and orders;
  - court-sent push emails the lawyer forwards (e.g. Madras HC AIMS push, Notification 230/2026);
  - deep links.

  No captcha circumvention and no scraping.
- Outreach is about *our software*. Honoraria are flat.

---

## 1. Hypotheses

### 1.1 Proof-of-value hypotheses (primary)
| ID | Hypothesis | Experiment | Pass threshold | If it fails |
|---|---|---|---|---|
| **H-PREP** | The OS raises preparation: briefs exist and are used, and lawyers feel more prepared | E2 vs E1 | Brief completeness ≥ 90%; briefs opened before ≥ 80% of listings; self-rated preparedness +1.0 (1–5 scale) vs baseline | Re-cut the brief (content/format) or reposition around obligations |
| **H-OBLIG** | The OS cuts missed or late obligations | E1 obligation audit vs E2 | Missed-obligation rate falls ≥ 50% vs the audited baseline; capture completeness ≥ 95% of directions in confirmed orders | Investigate where obligations arise outside orders; adjust capture |
| **H-LOAD** | The OS lowers cognitive load | Weekly 3-item load rating (mental demand, worry about forgetting, prep effort) | −30% vs baseline (median) | Reduce notification and confirmation burden; simplify views |
| **H-CONT** | Continuity: a matter can be understood or handed over fast | Time-to-context test (5 standard questions about a matter the participant hasn't touched for 3+ weeks, or a colleague's matter); handover reports | ≤ 3 min median (vs baseline); ≥ 90% "had what I needed" on delegated appearances | Strengthen timeline and handover note content |
| **H-COMP** | The OS gets more useful with use (memory + graph) | E2 week 1 vs week 2 (and the 4-week extension) | Corrections per item −40%; unedited brief acceptance ↑ | Revisit memory proposals and matching |
| **H-TRUST** | Lawyers accept the approval boundaries | E2 exit + E4 | ≥ 70% keep L3 automation on; < 20% report anxiety; 0 boundary breaches | Default to L2; slower ramp |
| **H-ADAPT** | Launch-court adapters are accurate on lawyer-supplied inputs | E5 | Madras HC and Karnataka HC list-row match precision ≥ 99.5%, recall ≥ 95%; order next-date ≥ 98% (≥ 30 fixtures each) | Restrict to stable list types; assisted-parse fallback |
| **H-LANG** | Tamil/Kannada/English mixed voice notes and subordinate-court orders are usable | E6 | Date and next-step capture ≥ 95% after confirmation; OCR legible-field rate ≥ 90% on Tamil/Kannada orders | English-first for HC; vernacular as v1 |

### 1.2 Willingness to pay and adoption
| ID | Hypothesis | Experiment | Pass threshold | If it fails |
|---|---|---|---|---|
| **H-VALUE** | "Walk in prepared / never miss an obligation / never lose the thread" beats "research", "AI drafting" and "less typing" as the reason to pay | E3 MaxDiff (n ≥ 60 across both cities) | An OS value (prep, obligations or continuity) ranks #1; "less data entry" ranks below it | Re-centre messaging on the winning value; keep architecture |
| **H-WTP-S** | Independent advocates pay ≥ ₹799/month after a pilot | E2 paid continuation (randomised ₹499 / ₹799 / ₹1,199) | ≥ 40% of solo pilot participants pay; ≥ 25% at ₹799+ | Anchor at ₹499; lean on chamber plan |
| **H-WTP-C** | Chambers pay per seat (≥ ₹649) | E2 chamber continuation (₹499 / ₹649 / ₹899 per seat) | ≥ 2 of 4 pilot chambers pay for ≥ 3 seats | Flat chamber price test; senior-only seat |
| **H-SAAS** | Chambers accept India-hosted multi-tenant SaaS for matter data | E7 security one-pager review + E6 interviews | ≥ 75% accept with the stated controls; top objections listed | Offer stronger controls earlier (BYOK, dedicated tenant) |
| **H-DEMO** | The marketable demo creates pilot demand | E3 demo sessions (n ≥ 30) | ≥ 40% request a pilot; ≥ 20% book onboarding within 7 days | Rework the demo narrative |
| **H-SPREAD** | Juniors carry the product (free workspace → independent practice; peer referral) | Pilot referral tracking + interviews | ≥ 1 organic referral per pilot chamber in 4 weeks | Add explicit, compliant referral credits (software only) |

### 1.3 Retained from earlier versions (secondary)
- **H-TIME** (minutes saved): measured and reported, but not a gate.
- **H-PRIV** (client-content forwarding): now *tested as a choice*, not assumed. We measure how often lawyers opt in to internal-chat or email imports.

---

## 2. Top experiments

### E1 — Baseline practice audit (week 1)
**Participants**
- **Chennai (Madras HC):** 5 independents + 2 chambers (3–6 members each).
- **Bengaluru (Karnataka HC + city courts):** 5 independents + 2 chambers.
- Total ≈ 30 lawyers.

**Measures (no client confidences recorded)**
1. **Obligation audit.** With the lawyer, review orders from the last 60 days for 10 of their matters. Count each direction or obligation, whether it was met on time, met late, or missed, and how it was tracked. The lawyer can redact; we record only counts and categories.
2. **Preparation self-rating.** A one-tap 1–5 rating after each hearing for 5 court days, plus a "what was missing?" pick-list.
3. **Cognitive load.** The 3-item weekly rating.
4. **Time-to-context test.** Pick a matter untouched for 3+ weeks, or a colleague's matter. Time how long it takes to answer 5 questions: stage, last order, next date, open obligations, key document location.
5. **Chamber coordination log.** Calls and messages asking "what happened / what's listed" per day; handover issues.
6. *(Secondary)* Admin minutes per category (9 pm 3-minute log).

**Incentive:** ₹1,000 per individual, or ₹3,000 per chamber (flat).

### E2 — Two-week concierge pilot of the whole OS loop (weeks 2–3, optional extension to week 5)
**Aim:** run *every* OS engine by hand with AI assistance on lawyer-owned inputs, then ask for payment.

**Setup (Day 0, 45–60 min per workspace)**
- Confirm consent (⚖ counsel-reviewed). Mark sensitive matters for exclusion.
- **Madras HC participants:**
  - Register on **AIMS** with their enrolment number and tag their cases, so the Registry's cause-list email push reaches them (Notification 230/2026).
  - Forward those emails to the pilot intake; also share recent cause lists and orders.
- **Bengaluru participants:** share recent Karnataka HC lists and orders (lawyer-supplied), plus City Civil, Mayo Hall and tribunal orders, per the channels in [11](../strategy/11-launch-markets-madras-hc-bengaluru.md).
- We build each **matter graph** (proceedings, IAs and connected matters, listings, orders, obligations) in an India-hosted working store, and send a **confirm grid**. The lawyer approves, merges or splits.

**Daily service (Days 1–12)**
| Time | What participants receive or do | OS engine exercised |
|---|---|---|
| ~8 pm (eve of court days) | **Court-day view** (by complex → hall → item, stage, clashes; chamber delegation suggestions) + **per-listing preparation brief** (stage, last order with page link, open obligations, carry list, synopsis, last-hearing note, their court notes) | Prepare, Execute |
| 7 am | Changes from supplementary lists | Execute |
| After each hearing | Lawyer or junior sends a **voice note** (EN/TA/KN/mixed) → within 30 min a **structured outcome card**: next date, stage, directions → obligations, tasks. Lawyer replies ✓ or corrects | Execute, Follow-up |
| On order arrival | Lawyer shares the order PDF → anchored digest; directions → proposed obligations; conflict flags vs the voice note | Document intelligence, Follow-up |
| Daily ~6 pm | **Action & deadline queue**: overdue / this week, owners, drafted next steps; **client / senior / briefing-counsel update drafts** in the client's language (lawyer sends) | Follow-up |
| Day 5 and Day 10 | **Memory proposals** ("We noticed you always… Save?") and a **"what changed" digest** for matters not touched | Memory, Continuity |
| Day 11 | **Handover drill**: generate handover notes for 3 matters; a colleague or the lawyer answers the 5 questions | Continuity |

**Boundaries (identical to the product):**
- we never contact clients, courts or registries;
- no advice;
- no generated citations;
- nothing filed;
- the lawyer sends everything outward.

**Channel and privacy**
- A dedicated team phone using the WhatsApp Business *app* (end-to-end to that device) [I: verify], with backups off.
- Processing goes only through India-region tools under no-training terms.
- Founders sign an NDA.
- Data is deleted within 14 days after the pilot ends (or migrated into the product with written consent).

**Measurement (Days 1–12):** the same instruments as E1, plus:
- brief completeness and open-before-hearing;
- capture completeness of obligations;
- corrections per item;
- L3 undo-equivalents (lawyer reversals);
- ops minutes per workspace (the automation-cost proxy).

**Day 13–14 readout + paid continuation**
- Each workspace gets its **Practice Report**:
  - preparedness: before vs after;
  - obligations: missed before vs after, and catches made;
  - load score;
  - time-to-context;
  - (secondary) minutes.
- Randomised continuation offer, paid in real money by Razorpay link and refundable if the app doesn't ship within 4 months:
  - **Advocate:** ₹499 / ₹799 / ₹1,199 per month.
  - **Chamber:** ₹499 / ₹649 / ₹899 per seat per month.
- Then a Van Westendorp survey and an exit interview covering trust, boundaries, the SaaS comfort level, and "what would make this indispensable?".

### E3 — Marketable demo + value test (weeks 1–5, parallel)
- **Demo:** the 7-minute script in [04 §9](../mvp/04-mvp-definition.md#9-the-marketable-demo). It is a clickable Expo/Figma prototype on a **synthetic but court-faithful** dataset, using real nomenclature and realistic list and order layouts with fictional parties. Each city gets its own version.
- **Sessions:** n ≥ 30 lawyers across bar-association libraries (with permission), chambers, and alumni events in Chennai and Bengaluru.
- After the demo, run three things:
  - **MaxDiff** across 8 values:
    1. walk into every hearing prepared;
    2. never miss an obligation;
    3. pick up any matter instantly;
    4. one view of the court day;
    5. client updates drafted in Tamil/Kannada/English;
    6. AI case-law research;
    7. case-law database;
    8. less data entry.
  - **Pilot ask:** "Start a 2-week pilot."
  - **Price** (Van Westendorp).
- **Landing page:** an OS-led headline ("Walk into every hearing prepared") vs a research-led one vs an entry-led one, × price arms. Founding-workspace pre-order: ₹7,999/yr Advocate, refundable.

---

## 3. Supporting experiments

### E4 — Prototype usability (weeks 4–5, n = 8 per city)
Tasks:
1. Set up from shared lists and orders.
2. Read tomorrow's view and open a brief.
3. Capture a hearing by voice.
4. Confirm obligations from an order.
5. Send a Tamil or Kannada client update.
6. Generate a handover note.
7. Undo a wrong auto-attachment.
8. Review memory.

Measures: success rate, SUS (target ≥ 70), and trust ratings.

### E5 — Court-adapter spikes (weeks 0–5)
| Spike | Question | Done when |
|---|---|---|
| T6-MHC | Madras HC list formats from authorised channels (AIMS push email; lawyer-downloaded lists): categories, item numbers, halls, advocate names; order headers; neutral citation separator | ≥ 30 fixtures; precision/recall report; stage-heading map |
| T6-KHC | Karnataka HC list formats (lawyer-supplied; see [11](../strategy/11-launch-markets-madras-hc-bengaluru.md)); orders; neutral citation | ≥ 30 fixtures; report |
| T6-A0 | Generic parse quality on Chennai/Bengaluru subordinate and tribunal orders | 40 orders; anchored-field accuracy |
| T8 | Roster / sitting-arrangement PDFs → effective-dated bench map (Madras HC wef 05.10.2026; Karnataka equivalent) | Parse + change-detection demo |
| ⚖ L1 | **Letters to the Madras HC Registrar (IT-cum-Statistics) and the Karnataka HC Registry** seeking permission and/or a data feed; counsel memo on the access-mode registry | Letters sent; memo received |

### E6 — Interviews + language spikes (weeks 0–2)
- **Interviews:** 12 per city (independents, chamber heads, juniors, clerks).
- The v0.2 script, adding:
  - **preparation** ("Walk me through preparing for tomorrow. What's always missing?");
  - **obligations** ("Show me the last order with directions. How did you track each one?");
  - **continuity** ("When a junior left, what was lost?");
  - **appearance realities** (AoR vs arguing counsel vs "for" appearances; how clerks and juniors split work);
  - **language** (Tamil/Kannada orders, client languages);
  - **SaaS comfort** ("What would you need to know before putting matter data in a cloud service?").
- **Language spikes:**
  - T2/T3 Tamil and Kannada STT on 30 noisy notes each;
  - OCR on 30 subordinate-court orders each (Sarvam vs a vision LLM).

### E7 — SaaS trust review (week 3)
- **Artefact:** a one-page security & privacy brief covering:
  - India hosting;
  - workspace isolation;
  - roles (incl. restricted clerk);
  - no training;
  - support-access consent;
  - export/delete;
  - DPA;
  - "software, not legal services".
- **Review:** with 10 chamber heads. Record acceptance and objections (H-SAAS).

---

## 4. Metric definitions (pilot and product)
| Metric | Definition | Pilot source | Product source |
|---|---|---|---|
| Brief completeness | Listings with stage + last order + open obligations + carry list ÷ listings | Our briefs | Instrumented |
| Brief opened before hearing | Opened or confirmed before listing time ÷ listings | Read receipts / reply | Instrumented |
| Preparedness | Post-hearing 1–5 self-rating | WhatsApp one-tap | In-app one-tap |
| Missed-obligation rate | Obligations past due without deliberate reschedule ÷ obligations due | E1 audit / E2 queue | Queue state |
| Capture completeness | Directions in confirmed orders present as obligations | Audit | Order ↔ queue reconciliation |
| Cognitive load | 3-item weekly rating (1–7 each) | Survey | In-app monthly pulse |
| Time-to-context | Minutes to answer 5 standard questions | Timed test | Periodic in-app test (opt-in) |
| Handover success | Delegated appearances rated "had what I needed" | Survey | One-tap after delegated hearing |
| Corrections per item | Corrections ÷ items delivered | Chat log | Instrumented |
| Paid continuation | Paid ÷ offered | Razorpay | Plan conversion |

## 5. Stage 0 decision (end of week 5)
- **GO:** H-PREP, H-OBLIG, H-VALUE and either H-WTP-S or H-WTP-C pass, H-ADAPT passes for at least one launch court, and there is no ⚖ blocker.
- **GO-WITH-CHANGES:** value passes but WTP is weak (re-price or re-package), or only one court adapter passes (launch that city first).
- **PIVOT THE SLICE (not the identity):** H-PREP and H-OBLIG both fail. Re-cut which engine leads, per D-024.

Record the outcome in DECISIONS.md.
