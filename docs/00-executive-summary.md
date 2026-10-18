# 00 — Executive Summary

2026-10-17 · Package v0.3 · Read time about 6 minutes.

> **v0.3 supersedes v0.1 and v0.2.**
> - v0.1 framed the product as a safe-AI hearing diary (Delhi).
> - v0.2 reframed it around zero-entry convenience.
> - A chamber "court-day autopilot" draft was rejected by the founder and never adopted.
>
> The decision trail is in [DECISIONS.md](../DECISIONS.md), D-001 to D-034.

## The corrected product thesis
**Lawyer OS is an intelligent operating layer for how advocates practise in Indian courts.** It is delivered as a secure, multi-tenant, India-hosted SaaS. Its parts are:
- a **court layer** that understands each court's lists, stages, nomenclature and orders;
- a **matter graph** of proceedings, listings, hearings, orders and obligations, with provenance on every fact;
- a scoped, inspectable **lawyer memory** that learns how this lawyer practises;
- **document intelligence**;
- the **prepare → execute → follow-up → continuity** loop that runs the practice.

The lawyer remains the only one who judges, advises, argues, files and sends.

**What lawyers pay for** is walking into every hearing prepared, never missing an obligation a hearing creates, carrying less in their head, and never losing the thread of a matter. "Less typing" is how information gets in. It is not the value.

**"As a service"** means the operating system is delivered as cloud software. Legal services are never offered (D-032).

## The MVP: the first vertical slice of the OS (not a data-entry product)
- **Markets:**
  - Madras High Court, Principal Seat (Chennai).
  - Karnataka High Court, Principal Bench, plus the Bengaluru court ecosystem.
- **Court layer.** A1 adapters for both High Courts. A0 support (generic parsing plus confirmation) for Chennai and Bengaluru district courts, tribunals and commissions. Court data comes only through authorised paths:
  - the **Madras HC Registry's cause-list email push to AIMS-registered advocates** (Notification 230/2026);
  - **lawyer-shared Karnataka HC lists**, from a page that is public and captcha-free (A2 retrieval only after written authorisation);
  - lawyer-shared orders;
  - deep links. Never framing, never captcha circumvention.
- **Inputs (lawyer-owned first):** cause lists, orders, voice notes (English, Tamil, Kannada, or mixed), own documents, calendar `.ics`, diary photos, manual correction. Email forward-in and *internal* WhatsApp chat exports come later and are opt-in. Client chats are excluded by default.
- **Outputs:**
  - court-day operating view;
  - a preparation brief for each listing;
  - matter timeline;
  - action and deadline queue (including defect cures, SR/FR stages and certified copies);
  - document context;
  - client, senior and briefing-counsel update drafts in English, Tamil or Kannada (the lawyer sends them);
  - handover notes;
  - memory that compounds.
- **Boundaries:**
  - Internal, reversible steps are automated.
  - Dates, obligations, memory, delegation and every outward draft need one confirmation.
  - Advice, advocacy, authorities, filing, commitments and sending stay human.
  - **No autonomous action exists in code.**
- **SaaS:**
  - Solo and Chamber workspaces with roles; the clerk role is restricted from strategy notes.
  - Database row-level isolation plus per-workspace encryption keys.
  - Hosted in Mumbai with disaster recovery in Hyderabad; India-only AI inference by default.
  - Over-the-air updates; court adapters update server-side without an app release.
  - Court-day support windows; a 7-day offline cache.
- **Pricing (to test):**
  - Junior: free.
  - Advocate: ₹499 / ₹799 / ₹1,199 per month.
  - Chamber: ₹499 / ₹649 / ₹899 per seat per month, plus a ₹199 clerk seat.
  - Estimated variable cost is about ₹175 per seat per month, so gross margin is about 67–73% at mid-price.
- **Deferred for sequencing only:**
  - research integration;
  - drafting studio;
  - fees and invoices;
  - limitation engine;
  - live display-board tracking;
  - the Madurai, Dharwad and Kalaburagi benches;
  - Tamil and Kannada UI;
  - native desktop;
  - client status links;
  - analytics.

  All stay on the roadmap.
- **Permanently out:** public solicitation or marketing of lawyers, autonomous advice, unverified citations, unsupervised filing, unauthorised scraping, judge analytics.

## Proof of value
- **North star: the Prepared & Kept rate.** This is the share of appearances that had a current brief beforehand *and* where every resulting obligation was captured and kept.
- **Supporting metrics:** brief completeness and use, self-rated preparedness, missed-obligation rate, cognitive-load score, time-to-context and handover success, correction rate by tenure (compounding memory), and paid continuation.
- Minutes saved are secondary. This is consistent with the founder-reported finding that solos save under 30 minutes a day.

## Demo and pilot
- **Marketable demo (7 minutes):**
  1. Registry email.
  2. Court-day view.
  3. A writ petition (WP) brief, with its miscellaneous petitions (WMPs) and connected matter.
  4. A Tamil-English voice note becomes the next date and obligations.
  5. Order PDF, with a conflict caught.
  6. Tamil client draft.
  7. Defect-cure queue.
  8. Handover note.
  9. Memory proposal, undo, and the India-hosting controls.
- **Concierge pilot (2 weeks):** runs the whole OS loop by hand for 5 independent advocates and 2 chambers in each city, then asks for real payment ([07 E2](validation/07-validation-plan.md)).

## Main uncertainties
1. **Cause-list formats are unconfirmed for both High Courts.** Madras HC searches are behind a captcha, and the Karnataka HC PDFs could not be opened. Fixtures from lawyer-supplied lists (spike T6) decide whether each adapter reaches A1.
2. **Access rights.** The Madras HC copyright page and its terms of use conflict on reproduction, and both courts are silent on automation. We need written authorisation for A2 and a counsel memo ⚖.
3. **Willingness to pay** for an OS (Advocate plan versus per-seat Chamber plan). It is untested.
4. **Tamil and Kannada** voice notes and vernacular subordinate-court orders: accuracy is unmeasured.
5. **Competition in Bengaluru.** Nyayanidhi calls itself a "litigation OS". We have not yet analysed it.
6. **Founder-reported findings F1–F4** need their underlying data added to the repo.

## Next three actions
1. **Collect court fixtures and write to the Registries (this week).**
   - Get 30+ lawyer-supplied cause lists and 50+ orders per High Court. In Chennai, run AIMS-registration sessions so the email push flows.
   - Write to the Madras HC Registrar (IT-cum-Statistics) and the Karnataka HC Registrar (Computers)/NIC about permitted use and data feeds.
   - Brief counsel on the access-mode registry and the "software, not legal services" wording.
2. **Run E1 then E2 in both cities.** A 1-week baseline practice audit (obligations, preparedness, load, time-to-context), then the 2-week concierge OS pilot with a paid-continuation offer.
3. **Build the 7-minute demo** on a synthetic, court-faithful dataset, and run it with 30+ lawyers alongside the MaxDiff value test. Then hold the Stage 0 GO / GO-WITH-CHANGES / re-cut decision at week 5.

## Document map
| Document | Version |
|---|---|
| [Research report](strategy/01-research-report.md) | v0.1, plus addendum |
| [Thesis](strategy/02-product-thesis-and-segmentation.md) | v0.3 |
| [PRD](product/03-prd.md) | v0.3 |
| [MVP](mvp/04-mvp-definition.md) | v0.3 |
| [Competitors](strategy/05-competitor-and-ai-matrices.md) | §C positioning |
| [Risks](risk/06-risk-register.md) | §8 |
| [Validation](validation/07-validation-plan.md) | v0.3 |
| [Repo & backlog](engineering/08-repo-structure-and-backlog.md) | §7 |
| [Capture subsystem](product/09-zero-entry-automation-design.md) | — |
| [System architecture](product/10-lawyer-os-system-architecture.md) | — |
| [Launch markets](strategy/11-launch-markets-madras-hc-bengaluru.md) | — |
| [Decisions](../DECISIONS.md) | — |
| [Assumptions](../ASSUMPTIONS.md) | — |
