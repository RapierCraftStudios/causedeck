# 11 — Launch Markets: Madras High Court (Chennai) & the Bengaluru Court Ecosystem

Version 0.3 · 2026-10-17 · Decision: D-025 · Evidence: [raw/08 Madras HC & TN](../../research/raw/08-madras-hc-tamil-nadu-court-ecosystem.md) · [raw/09 Karnataka HC & Bengaluru](../../research/raw/09-bengaluru-karnataka-court-ecosystem.md). All sources were accessed 2026-10-17.

Tags: `[V]` primary page read · `[R]` secondary · `[I]` inference · ⚖ counsel review needed.

> **Method caveat.** Neither research pass could open an actual cause-list *output*:
> - Madras HC list searches are behind a captcha.
> - Karnataka HC PDF links failed to load.
>
> So the stage headings, item-number layout and per-row advocate fields below are **unconfirmed**. They must be confirmed from lawyer-supplied samples in spike T6 before the adapters are finalised.

---

## 1. Why these two markets
- **Founder direction** (D-025).
- **Complementary realities.** Madras HC has a very large Original Side and Appellate Side, a Madurai Bench, and Tamil-first subordinate courts. Bengaluru has a high-volume Karnataka HC principal bench, a dense civil, commercial and NCLT ecosystem, and Kannada in trial courts.
- **Officially sanctioned or open data paths exist in both cities, which de-risks the court layer:**
  - Madras HC is rolling out a **Registry cause-list email push** to advocates who register on AIMS (Notification 230/2026) `[V]`.
  - The Karnataka HC daily and advance cause list is a **public HTML page with no captcha** `[V]`. Using it automatically still needs authorisation ⚖.
- **Practice density.**
  - Advocates' Association Bengaluru: ~16,500 members (2021) `[R]`.
  - Karnataka State Bar Council: 92,500 enrolled by 2018 `[V]`.
  - Tamil Nadu: an aggregator reports "over 1.2 lakh" enrolled (weak) `[R]`.
- **Talent and legal-tech presence in Bengaluru:** Lucio, Nyayanidhi (which positions itself as a "litigation OS") and Jhana `[R]`. This means competition in Bengaluru, but also an audience that already understands legal software.
- **Junior economics in Chennai.** The Madras HC fixed junior stipends of **₹20,000/month in Chennai** (Farida Begam v. Puducherry Govt., W.P. 17976/2019, June 2024) `[R, two sources]`. That anchors chamber spending on juniors, and makes juniors' productivity a real cost to seniors `[I]`.

## 2. Court realities that shape the OS

| Reality | Madras HC (Principal Seat, Chennai) | Karnataka HC (Principal Bench, Bengaluru) | OS design response |
|---|---|---|---|
| **Official site(s)** | `hcmadras.tn.gov.in`, plus services spread across `mhc.tn.gov.in`, `madrashighcourt.tn.gov.in` and national eCourts portals; the TLS chain failed validation in our fetch `[V]` | `judiciary.karnataka.gov.in` (current); legacy `karnatakajudiciary.kar.nic.in` still referenced but unreachable `[V/R]` | Config-driven base URLs; deep links open in a new window (**no framing**: a Madras HC policy) |
| **Cause list access** | 7 search modes, including **advocate name** and **enrolment no.**, each behind a 6-character captcha `[V]`. **Registry email/SMS push** for AIMS-registered advocates who tag their cases (Notification 230/2026, 6 Oct 2026) `[V]` | Daily and advance list HTML per bench, **no captcha**, updated the previous evening (Bengaluru 8:36 pm on 16 Oct) `[V]`. Dated search (≤ 30 days) by judge, advocate, **Bar Registration No.** or party `[V]`. Whole-list PDFs available `[V]` | **Madras:** onboard lawyers onto AIMS and ingest the court-sent emails the lawyer forwards (A1, sanctioned). **Karnataka:** the lawyer shares the list or PDF (A1); one-tap device-side retrieval of the public page only after written authorisation (A2 ⚖) |
| **List structure** (to confirm) | List categories (e.g. admission, hearing, orders, mentions, fresh, part-heard, supplementary) **unconfirmed** `[R/I]` | Practitioner taxonomy: Preliminary Hearing, Prelim "B Group", Hearing on IA, Admission, For Hearing/Final, For Being Spoken To, Orders (registry objections); **2–3 lists per hall per day** `[R]` | Stage headings form an **open enum** with a per-court normalisation map. The map is learned from fixtures and lawyer corrections |
| **Live court status** | Display board pages exist; content loaded dynamically; no documented feed `[V]` | Display board per bench: hall, list no., running Sl. No., **single-letter stage code** (legend not published), lag disclaimer `[V]` | MVP: deep link plus a manual "current item" note. v1: live tracking only if permitted ⚖. Learn the stage-letter legend from lawyers |
| **Advance notice** | Unknown | **Advance final-hearing list was discontinued in Nov 2021**; advocates get about 1 day's notice (DAKSH) `[R]`. Restoration unconfirmed | Readiness-by-default: briefs are kept current for *all* matters likely to be reached, not just tomorrow's |
| **Case status** | Captcha; search by case no., **CNR**, filing no., party `[V]` | Captcha; search by case no., **Filing Register no.**, trial/appellate (lower-court) no., advocate, party `[V]` | Deep links only. Status changes reach the graph through lists, orders and the lawyer's own notes |
| **Orders & citations** | JUDIS portal (judgments + **daily orders**); neutral citation since 2023, `YYYY/MHC/n` reported; separator unconfirmed `[V/R]` | Judgment search (disposed only, captcha, ≤ 3-month ranges); **blockchain e-judgment verification**; neutral citation `2024:KHC:n`, `KHC-D` (Dharwad), `-DB` suffix (aggregator-observed) `[V/R]` | Order parser per court. Citation verifier recognises both neutral-citation schemes; the KHC blockchain verification is an authenticity flag (v1) |
| **Nomenclature** | Official dropdown of about **130 case types**: WP, WMP/WPMP, WA, HCP, CRP (NPD/PD), SA, AS, CMA, CRL OP, CRL RC, Original Side CS/OP/OA/OSA/A/APPL, Commercial Division, Arb O.P., tax, plus a **"(MD)" Madurai suffix** `[V]` | WP, WA, RFA, RSA, MFA, CRL.P, CRL.RP, CRL.A (confirmed); official case-type PDF unreadable `[V/R]`. **Dharwad and Kalaburagi use 100xxx numbering** `[I]` | Case types are data, not code. Normalise punctuation (W.P./WP). Miscellaneous petitions (WMP, CMP, CRL MP, SUB A; IAs) are **child proceedings** |
| **Pre-numbering stage** | **SR (Stamp Register) numbers**; defects lead to a return to the "seat for returns"; delays may need condonation `[R]` | **Filing Register (FR) no.**; scrutiny objections listed under "Orders" if uncured `[V/R]` | Proceeding states: `filed → SR/FR → defects raised → re-presented → numbered`; cure-deadline obligations |
| **Sides & jurisdiction** | **Original Side** (suits above ₹1 cr from Chennai; Commercial Division) vs Appellate/Writ/Criminal sides; Madurai has no ordinary original jurisdiction `[R]` | Appellate, writ and criminal at the HC. Civil suits go to the City Civil Court; commercial suits to Commercial Courts (Com.O.S., etc.) `[R]` | The forum model carries "side". The matter graph links suits ↔ appeals across forums |
| **Roster / benches** | "Sitting Arrangements" + "Standing Orders" PDFs per seat (latest wef **05.10.2026**; Dussehra vacation sittings) `[V]`; portfolio changes roughly quarterly `[R]` | "Sitting lists" PDFs (`blr-sl-*`) act as the roster; revised about every 6 weeks `[R]`; no roster page `[V]` | Effective-dated roster import (v1); a "bench changed" alert on affected matters |
| **E-filing** | National portal; Madras HC e-Filing Rules 2020 (A4, Times New Roman 14, 1.5 spacing, OCR PDF, 20 MB cap, counters until 4 pm) `[R]`; mandatory for commercial, arbitration, IP and several district categories `[V titles]` | National portal + HC "Quick e-Filing" (case diary login) `[V]`; online early-listing memo pilot (RJ 187/2023) `[R]` | Templates follow the court's format rules. We never file (no L5). Early-listing memos are a trackable obligation state |
| **Certified copies** | e-Copy Application portal; Copying Branch `[V]` | Certified Copy Status menu `[V]` | Certified-copy obligation tracking (applied → ready → collected) |
| **Clerks** | Entry passes for registered advocates' clerks; Advocates' Clerks Rules 1983 amended Aug 2026 `[R]` | Not researched | **Clerk role** in Chamber workspaces, restricted from strategy notes |
| **Language** | HC in English. **Subordinate courts Tamil-first** (TN Official Language Act amendment 1976) `[R]`. Tamil judgment digest published `[V]` | HC in English (one Kannada DB order, Dec 2024) `[V]`. **Kannada for trial courts and tribunals** under Karnataka Act 13 of 2023 (bill text read; in-force status unclear) `[V/R]`. HC Kannada translation project `[R]` | Tamil and Kannada OCR, STT and drafts; original-language storage; machine translation labelled unofficial; enrolment / Bar Registration No. used as the stable key rather than transliterated names |
| **AI context** | No Madras AI practice direction found | No formal KHC AI policy; Jan 2025 trial order allegedly relied on 3 non-existent judgments, and the HC stayed further action `[R]` | Citation verification against neutral citations is built in; nothing generated |
| **Terms of use / automation** | Hyperlinking allowed; **framing forbidden**; copyright page says free reproduction, but the T&C says **permission by email**, so the pages conflict. No robots.txt. Silent on automation `[V]` | T&C silent on automation; copyright and hyperlinking pages "under construction"; no robots.txt `[V]` | **Access-mode registry** (D-028). Letters to the Madras HC Registrar (IT-cum-Statistics) and the Karnataka HC Registrar (Computers)/NIC. No captcha circumvention ⚖ |

### 2.1 Bengaluru forums beyond the HC
| Forum | Publication | Adapter level (MVP) |
|---|---|---|
| City Civil & Sessions Court, CMM courts, Mayo Hall, Small Causes, Family Court, Commercial Courts, labour courts (Bengaluru Urban district courts, `bengaluru.dcourts.gov.in`) | eCourts template. Cause-list form has **two captchas and no advocate field**; advocate search only in case status `[V]` | **A0**: lawyer-shared orders and lists, generic parser + confirmation; CNR as key |
| **NCLT Bengaluru bench** | **One PDF per date**; table with CP No., CA/IA No., purpose, parties, **counsel names**, IRP/RP `[V, 2023 sample]` | A0 → **A1 candidate** (structured table; high-value for young corporate litigators) |
| DRT-1/2 Bengaluru, consumer commissions (ConfoNet/e-Daakhil), RERA Karnataka | Not verified `[R]` | A0 |

### 2.2 Chennai forums beyond the HC
| Forum | Publication | Adapter level (MVP) |
|---|---|---|
| City Civil Court (pecuniary limit ₹1 cr), Small Causes, CMM (Egmore), Family Courts, Commercial Court (Egmore) | District eCourts; Chennai district site unreachable in our test `[V/R]`; **Tamil-first orders** | **A0** with Tamil OCR |
| Madurai Bench | Own lists, status, display board; "(MD)" types; no original side `[V]` | **Deferred (v2)**: separate adapter config |

## 3. Launch assumptions (to validate; see [ASSUMPTIONS](../../ASSUMPTIONS.md) A-19 to A-27)
1. A1 adapters for the **Madras HC Principal Seat** and the **Karnataka HC Principal Bench** cover most of a launch-segment lawyer's listings. Subordinate and tribunal work runs at A0 with confirmation.
2. Madras lawyers will register on AIMS and tag their cases, so court-pushed cause-list emails become the default input (A-20/A-22).
3. Karnataka lawyers will share the evening list or PDF (or forward the HC Telegram channel output, if any; uninspected) until A2 authorisation exists.
4. HC orders are in English. Subordinate orders are Tamil-first (Chennai) or increasingly Kannada (Bengaluru). The MVP UI is English, with content in EN/TA/KN (A-25).
5. **Sequencing:** the two cities may launch a few weeks apart. Whichever adapter passes T6 first leads (G7 risk).

## 4. Court-adapter plan for launch (see [10 §5](../product/10-lawyer-os-system-architecture.md#5-court-adapter-strategy-extensible))

| Adapter | Level at MVP | Inputs (authorised) | Must parse | Fixtures needed | ⚖ actions |
|---|---|---|---|---|---|
| `in.tn.madras-hc.principal` | **A1** | AIMS push emails (forwarded or forward-in), lawyer-downloaded lists, orders (JUDIS / daily orders) | List rows: hall, judge(s), item, category, case type/no/year (~130 types), advocate; order header, operative directions, next date; neutral citation; SR/returns | ≥ 30 lists (incl. supplementary), ≥ 50 orders | Letter to the Registrar (IT-cum-Statistics) on permitted use and a feed; resolve the copyright vs T&C conflict |
| `in.ka.karnataka-hc.bengaluru` | **A1** (A2 after authorisation) | Lawyer-shared HTML or PDF lists; orders | List no., Sl. No., hall, judge, stage headings (open enum), advocate / BRN; orders; `KHC` citations; FR numbers; scrutiny objections | ≥ 30 lists, ≥ 50 orders | Letter to the Registrar (Computers)/NIC on device retrieval of the public list and display board |
| `in.ka.bengaluru-urban.district` | **A0** | Lawyer-shared orders and lists | Generic header + operative parse; Kannada OCR | 40 orders | — |
| `in.tn.chennai.district` | **A0** | Lawyer-shared orders | Generic + Tamil OCR | 40 orders | — |
| `in.nclt.bengaluru` | A0 → A1 (MVP-late) | Lawyer-shared PDF lists; orders | Table rows incl. nested IAs, counsel names | 20 lists | Read the NCLT T&C |

## 5. Market-entry notes [I]
- **Chennai:** start with independents and young chambers on the **Appellate/Writ side** (high listing volume, the WMP child structure). Run AIMS onboarding as a joint "get your court's cause list by email, then let Lawyer OS prepare you" session. The court-endorsed step lowers trust friction.
- **Bengaluru:** start with young chambers doing **Karnataka HC writs/RFAs plus City Civil and Commercial Court** work. The 1-day notice for final hearings makes "always-ready briefs" the hook. NCLT is a secondary wedge for corporate litigators.
- **Competition:** in Bengaluru, Nyayanidhi uses the "litigation OS" language `[R]`. We differentiate through court-adapter depth, the obligation model, scoped memory, self-serve INR pricing, and strict boundaries. Its offering needs a closer look (open item).
- **Distribution:** bar-association libraries and chambers (with permission), law-school alumni (NLSIU Bengaluru; TNNLU and Chennai colleges), and junior networks. We never market advocates' services (D-006).
