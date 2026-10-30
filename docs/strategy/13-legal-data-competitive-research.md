# 13 — Legal data layer: competitors, sources, law and the AI edge

**Date:** 2026-10-27 · **Status:** Research (input to D-048, D-049, D-050 and the counsel brief in #118) · **⚖** — not legal advice

Tags: [VERIFIED] primary page read · [REPORTED] press, vendor or third party · [INFERENCE] our analysis. Prices are as of the date above. Items marked "check" need a primary-source pass before they go in a deck or a counsel brief.

## 1. Bottom line

1. **No incumbent combines official data, workflow and verified AI.**
   - eCourtsIndia and the litigation-check vendors resell data from the eCourts portal without saying how they get it.
   - SCC Online and Manupatra are research libraries with AI added on, and they publish no accuracy figures.
   - The new "litigation OS" entrants (Nyayanidhi, Lexshastra, LexTrack) are early and don't name their data sources.
2. **The biggest open data gap is High Court cause lists and display boards.** eCourtsIndia's cause-list API covers district and taluka courts only. [VERIFIED] Madras HC and Karnataka HC lists, which we launch with, are exactly what it lacks.
3. **AI costs are small; data and trust decide who wins.**
   - OCR is ₹0.50 a page, and embedding 1,000 judgments costs ₹18–180.
   - A heavy advocate costs roughly ₹150–400 a month in AI. [INFERENCE from VERIFIED rates]
   - What separates products is (a) lawful, fresh, complete data and (b) citations that survive scrutiny. The Supreme Court now treats citing unverified AI-generated precedent as advocate misconduct.
4. **The fastest lawful coverage is already open:**
   - Supreme Court and High Court judgment corpora under CC-BY-4.0 on AWS Open Data.
   - The eCourts and Madras HC AIMS email push, which advocates forward to us.
   - The Karnataka HC public lists, which have no captcha.

   Bulk captcha crawling is the highest-risk route, and nothing on the roadmap needs it.
5. **One contradiction needs a founder decision before counsel starts.** #118 asks counsel to confirm "no server-side automation and no captcha circumvention". D-048 as amended allows a server-side captcha fallback through AlterLab. See §7.

## 2. Competitors

### 2.1 The four named targets

| | eCourtsIndia | Indian Kanoon | SCC Online (EBC) | Manupatra |
|---|---|---|---|---|
| **Coverage** | Claims 24–32 crore case records: SC, 25 HCs, district courts, 18 tribunal types. **Cause lists: district and taluka only** [VERIFIED] | Free judgment and statute search; no current document count found | Case law, statutes, secondary material; AI Pro reportedly over 4M judgments [REPORTED] | 10M+ documents, 150K+ users [VERIFIED, vendor] |
| **Data source** | "Official court sources", "not affiliated with NIC/eCourts" [VERIFIED]. Captcha method undisclosed | Public raw judgments (*EBC v. Modak* basis) | Its own editors: headnotes, citator. Sues copiers: LexisNexis injunction confirmed by the SC in 2016, Thomson Reuters [REPORTED] | Its own editors: "editorially enriched" [VERIFIED] |
| **Price** | Consumer use free. API: case detail ₹1.50, cause-list check ₹0.30, order PDF ₹3.75, order with AI summary ₹7.50. Pay-as-you-go is 3× the enterprise rate. Enterprise ₹10,000/mo or ₹1 L/yr + GST [VERIFIED] | API: search ₹0.50, document ₹0.20, fragment ₹0.05. ₹500 free credit. ₹10k/mo free for verified non-commercial use [VERIFIED] | ₹19k–49.5k/yr; AI Pro ~₹48.5k per user per year [REPORTED, rival's page] | Not published |
| **API** | 30 endpoints, hosted MCP server (41 tools), 100 requests a minute. **Terms bar resale "as a competing data service"** [VERIFIED] | Yes; commercial-use terms silent ("AS IS") | None public; content licensed into Harvey (Jan 2026) [VERIFIED] | None public |
| **AI** | Order summaries; MCP | Prism | AI Pro announced Jan 2026, **still "coming soon"** [VERIFIED] | AI search, case gists, citation maps, "judge-behaviour insights" [VERIFIED, vendor] |
| **Weak spots** | No HC or SC cause lists; depends on the portal; can't be resold | No citator or headnotes; one founder; facing right-to-be-forgotten orders (§4.4) | AI late; opaque price; research only | Opaque; no benchmarks; little workflow |

### 2.2 Others to watch

- **Nyayanidhi** (Bengaluru, "litigation OS", $2M seed from 3one4, Nov 2025, piloting in High Courts) [VERIFIED]. It is the closest to our launch market.
- **Lexshastra, LexTrack, CaseIndex, Bharat.Law, Vakeel Saathi** (eCourts sync, BNS drafting, WhatsApp-based practice). These are 2026 entrants and all their claims are their own [REPORTED].
- **CaseMine AMICUS** (about $1,500/yr AI Premium), **Jhana** ($1.6M seed, 2024), **Lucio** ($5M seed, Oct 2025, firm-focused) [REPORTED].
- **Litigation-check vendors** (Legitquest ~₹40k–5 L/yr, Surepass, LegalKart ₹1–5 per hit, AuthBridge, Meon). None discloses where its data comes from. Buying from them would give a fallback, not a moat, and would carry over any problem with how they got the data [INFERENCE].
- **Adalat AI** (nonprofit). Court transcription in about 4,000 courtrooms; Kerala made it mandatory for depositions from 1 Nov 2025 [REPORTED]. It could become a source of official text later; it isn't a competitor.
- **Global bar:** Harvey ($11B, Bengaluru office, SCC content) and Clio + vLex ($1B deal). Both put research inside the matter workspace. That is the standard to meet.
- **News:** LiveLaw premium about ₹1,849/yr; Bar & Bench premium paywalled [VERIFIED]. Headlines, links and short summaries only (D-048).

### 2.3 Gaps we can exploit (ranked)

1. **HC and SC cause lists, display boards and item tracking.** Nobody covers them well.
2. **Official sourcing as the brand.** "Sourced from the Registry, with provenance on every fact" answers everyone else's "not affiliated" disclaimer.
3. **A flat price that includes all lookups.** A daily check on a 40-matter diary costs ₹12 a day pay-as-you-go on eCourtsIndia. A Zerodha-style flat plan undercuts that and the ₹48k research tiers.
4. **Workflow plus research in one place, at solo-advocate prices.** SCC and Manupatra are research first; Lucio and Harvey are firm first.
5. **Published citation-verification results.** No competitor publishes any.
6. **Orders turned into actions** (next date, directions, obligations) inside the diary, where eCourtsIndia sells a ₹7.50 summary per call.

## 3. Data sources: what is lawful and how fast

| Route | Source | What it gives | Status | Unblocks |
|---|---|---|---|---|
| Open licence | **AWS Open Data: Indian SC judgments** (1950–2025, updated every two months) and **HC judgments** (25 HCs, updated quarterly), CC-BY-4.0, published by Dattam Labs [VERIFIED] | Bulk judgment corpus with JSON and Parquet metadata | Usable now, with attribution. Ask counsel one question: the compilation is CC-BY, but what about the underlying text taken from eCourts? | Corpus and research features |
| Official push (A1) | **eCourts email/SMS** to registered advocates; **Madras HC AIMS** cause-list push (Notification 230/2026 — check text) [REPORTED] | Next dates, disposals, order PDFs, cause lists | Lawful when the advocate forwards it. Give each workspace a forwarding address | #119, daily coverage |
| Public, no captcha (A2) | **Karnataka HC** daily and advance lists, whole-list PDFs [VERIFIED in repo doc 11]; **NCLT** static cause-list PDFs; **SEBI RSS**; eGazette PDFs | Lists, notices | Needs counsel clearance for each source (#118) | #610, Bengaluru launch |
| Official agreement (A3) | **NJDG open API**, currently given to government and institutional litigants under NDSAP [REPORTED]; Registry feeds | Statistics, case status, establishment masters | No framework for private firms found. This needs relationships | #513, #640 |
| Research data | Development Data Lab (80M cases from 2010–18, CC-BY, de-identified); DAKSH (CC BY-NC, so a commercial use needs a licence) | Benchmarks for adjournments and disposal times | Analytics only, never people-level data | Product claims, D-049 |
| Licensed | Legitquest, Surepass, eCourtsIndia, Indian Kanoon API | Gap filler | Fallback only; ask each where its data comes from and what rights it guarantees | #114, #118 licensed-API item |
| Delegated | The advocate's own lookup, captcha solved on their device | Their own matters | D-048; risk medium-low (§4) | Free alerts tier (#506) |
| Bulk captcha crawl | eCourts at scale | Full coverage | **High risk**; parked (#492) | — |

**Establishment list (#640), lawful options in order:**
1. Ask NIC's open-data helpdesk and search the government open-data catalogue (nothing found by search).
2. Ask eCommittee for the court master list in the #513 letter.
3. Seed from the annexures to Parliament answers on eCourts, which list courts by state (unread; counsel to clear).
4. Use the governed fetch only after counsel clears it.

Never script the portal's dropdown endpoints.

## 4. Legal landscape (brief for counsel)

| Activity | Risk | Basis |
|---|---|---|
| Delegated captcha lookup, solved on the advocate's device | Medium-low | IT Act s.43(a)/(b) "without permission"; no Indian case on solving captchas |
| Server-side captcha fallback (AlterLab) | Medium-high | Same, plus it is our server doing the access; conflicts with the #118 wording |
| Bulk coverage crawl (#492) | **High** | s.43/66, load on court servers, a Registry may block us and the relationship suffers; no precedent supports it |
| Raw judgment corpus from official text | Low (copyright) | Copyright Act s.52(1)(q); *EBC v. D.B. Modak* (2008) 1 SCC 1 protects only editorial additions (headnotes, notes, arrangement) |
| AI-generated headnotes | Medium | Fine if generated from raw text; **never ingest or train on SCC or Manupatra copy-edited text or headnotes** |
| A public judgment corpus searchable by party name | **Medium-high** | Right-to-be-forgotten orders, below |
| Party names in the advocate's own matters | Low-medium | DPDP s.3(c)(ii) probably covers court-published data, but this is not settled |
| Factual bench facts | Low-medium | The risk is the relationship, not the law; D-050's line holds |
| Developer API reselling court data | **High** | No official source; also bars on resale by vendors |
| Lawyer directory, referrals, lead generation | **High** | Madras HC (Jul 2024): directories breach BCI Rules 36/37 and lose s.79 safe harbour; the Supreme Court appeal (Sulekha) is pending |

### 4.1 Right to be forgotten

- **Delhi HC (May 2026, *Laksh Vir Singh Yadav*)** ordered Indian Kanoon to turn off name search for the named judgments, leaving lookup by case number or citation available. Indian Kanoon has appealed.
- **Karnataka HC (Aug 2026)** ordered a name masked for an acquitted woman.
- **Supreme Court** stayed the Madras HC *Karthick Theodore* takedown in 2024, and the case is still pending. [REPORTED]
- **Statutory bars on identification:** POCSO s.23, BNS s.72 (formerly IPC 228A), JJ Act s.74, and matrimonial/in-camera proceedings.

**Design consequences:**
- Name search over judgments is off by default.
- Barred categories are filtered when documents are ingested.
- There is a masking and erasure workflow from day one.

### 4.2 DPDP

- The Rules were notified on 14 Nov 2025. The main duties apply from about May 2027 (check the Gazette).
- Cross-border transfer is allowed except to notified countries. Our India residency (D-009) is stricter than the law requires.

### 4.3 AI in practice

- ***Pooja Ramesh Singh v. J&K Bank*, 2026 INSC 668 (2 Jul 2026).** The Supreme Court set aside NCLT and NCLAT orders built on fabricated citations, with "zero tolerance". One source says the Court directed the BCI to frame norms (check).
- **Other incidents:** the Bombay HC quashed a ₹28 cr assessment; a Bengaluru tax tribunal recalled a ₹669 cr order.
- **Policies:** the Kerala HC AI policy (Jul 2025) and the SC's AI white paper (Nov 2025) both require human verification.

**Consequence:** "every citation verified" is a reason lawyers will buy the product.

### 4.4 Questions counsel must answer (#118)

1. Does s.43(a)/(b) reach automated retrieval of public eCourts or HC pages in each of these cases?
   - (a) A page with no captcha.
   - (b) A captcha solved on the advocate's device.
   - (c) A captcha solved on our server.

   Do the portal terms, once read, create a contractual bar?
2. Is bulk captcha crawling (#492) defensible at all? What authorisation (eCommittee, NIC, each Registry) would make it so?
3. What do the eCourts Copyright, Hyperlinking and Disclaimer pages and the Madras and Karnataka HC terms actually say?
4. Does s.3(c)(ii) cover party names that a court publishes voluntarily? Does that survive aggregation, derived datasets, AI processing and reuse across workspaces?
5. Right to be forgotten:
   - Do we need masking and erasure now?
   - Should name search be off for acquittals?
   - Should we filter the statutory bars when documents are ingested?
   - What is our exposure while *IKanoon v. Karthick Theodore* is pending?
6. May we hold a raw judgment corpus (including the AWS CC-BY compilation) and generate headnotes without *Modak* exposure?
7. Do factual bench facts carry contempt risk? Is D-050's line enough?
8. Do BCI Rule 36 or the Madras HC Sulekha ruling reach any feature (shared briefs, referrals)? What AI disclaimers are needed after *Pooja Ramesh Singh*?
9. Is there any lawful route (NDSAP, the Open Data Licence, a Registry MoU) for a private firm to receive NJDG or eCourts data? What must a Registry authorisation say?
10. What API resale terms and indemnities would work (for example, non-personal data only)?
11. AlterLab: the processor agreement and residency (#488). Does a processor solving captchas shift liability?
12. Indian Kanoon (#114): may we use it commercially, cache results and show snippets?

## 5. The AI edge: what makes the product far faster to use

Advocates' main pain points [REPORTED unless marked]:
- **Portal friction.** Captchas, timeouts and wrong results hit a majority at least half the time (ThePrint survey, n≈70).
- **Late lists.** Cause lists are final around 6 pm, and juniors still pass photos of them around on WhatsApp.
- **Adjournments eat court time.** About 54% of civil-court sitting time goes on them (DAKSH, Bengaluru).
- **Lawyer unavailability.** 66.6 lakh district cases are delayed because the lawyer isn't available (NJDG, Sep 2024). That is a diary problem we can fix.

### 5.1 Build now (no external data dependency)

1. **Cause-list and order intake** from the advocate's own photos, PDFs, forwarded court email and WhatsApp. Indic OCR (Sarvam ₹0.50 a page [VERIFIED]), row parsing, matching to matters, and extraction of next dates and tasks for the advocate to approve, with provenance.
2. **Citation-verification layer first.** It sits underneath every later research feature:
   - The model refers to stored document IDs and never writes a citation string itself.
   - Every citation is checked against a canonical index (neutral citation, court, date, bench).
   - Quoted text is matched exactly or closely against the source.
   - Each authority gets a green or amber badge.
   - "No authority found" is an allowed answer.
   - The retrieval set is kept in an audit log.
3. **IPC→BNS / CrPC→BNSS / IEA→BSA resolver that knows the offence date.** It uses the public BPR&D tables, works out whether the old or new code applies (they took effect on 1 Jul 2024), and overlays the mapping on old precedents ("cites IPC 302 → read as BNS 103").
4. **Matter chronology and brief** built from the advocate's own documents, each point linked to its source.
5. **WhatsApp delivery and capture.**
6. **Bilingual order summaries** in Tamil and Kannada ↔ English, after a quality bake-off on real orders from #119.

### 5.2 Build once the corpus or official data lands

1. **Verified research memos.** Hybrid search over the AWS corpus, then the citation layer from 5.1.
2. **One-tap import and a unified docket across courts** by CNR or advocate code, using delegated lookups. Waits on #118.
3. **Display-board item tracking and predicted call time** from internal bench data (D-050), with factual bench facts later behind `bench_facts`.
4. **Developer API and MCP server**, only over data we may re-serve (official or our own derived data). This is how we compete with eCourtsIndia's MCP without inheriting its resale bar.

### 5.3 Moat over time

1. **Citator treatment signals** (followed, distinguished, overruled), proposed by the model from citing passages and checked by a human, generated from raw text only.
2. **Contributed data that compounds**, with opt-in reuse across workspaces under D-048.
3. **Listing-pace and call-time models.**
4. **Institutional and API revenue** on top of cheap retail pricing (D-049).

The permanent exclusions stay: no citations the model makes up, no autonomous advice, no unsupervised filing, and no judge ratings or predictions.

### 5.4 Unit economics [INFERENCE on VERIFIED rates; Bedrock prices to check in the console]

| Item | Cost |
|---|---|
| OCR (Sarvam) | ₹0.50 a page to digitise, ₹1.00 with extraction |
| Speech to text | ₹29.40 an hour |
| Translation | ₹20 per 10k characters |
| Embeddings | 1,000 judgments (~10M tokens) ₹18–180 |
| A brief (60k tokens in, 4k out) | Sonnet-class ~₹21 (batch ~₹10); Sarvam 105B ~₹1 (Indian legal quality not yet tested) |
| Per advocate per month | ₹150–400 |

Licensed data and lookup volume are the real cost risks.

## 6. Action plan mapped to the needs-human issues

| # | Action | Owner | Resolves |
|---|---|---|---|
| 1 | Download the AWS SC and HC judgment datasets; register them as a `corpus` source with Dattam Labs attribution; email contact@dattam.in about a feed or partnership | Eng + founder | Corpus; #513 groundwork |
| 2 | Decide the server-side captcha question (§7), then brief counsel with §4.4 | Founder → counsel | #118 |
| 3 | Counsel-approved letters to the Madras HC and Karnataka HC Registries (AIMS ingest, Karnataka device retrieval, feed request); log replies, or silence after 30 days | Founder/counsel | #118 |
| 4 | Letter to eCommittee, the SC IT cell and NJDG asking for the open API, a case-status web service and the establishment master list; cite Phase III "open data sharing"; ask about the institutional-litigant tier or partner with an eligible bank or bar association | Founder | #513, #640 |
| 5 | Ask the advocate cohort to register for the eCourts and AIMS push and forward it; collect NCLT Bengaluru PDFs | Founder | #119, #544 |
| 6 | Indian Kanoon token plus written answers on commercial use, caching and snippets | Founder | #114 |
| 7 | AlterLab: written residency and log retention, plus a processor agreement | Founder | #488, #708 |
| 8 | Ask Legitquest, Surepass and eCourtsIndia three questions each: where their data comes from, what rights they warrant, and whether we may re-serve it | Founder | #118 licensed-API item |
| 9 | Keep #492 (bulk captcha) parked; build the free alerts tier (#506) on push, contributed data and delegated lookups instead of bulk crawling | Eng | #506 |
| 10 | Bedrock and Sarvam keys | Founder | #112, #113, #561 |

## 7. Decision needed

**Server-side captcha fallback (D-048, amended) vs the #118 acceptance wording.** Options:
- **(a) Device-only captcha until counsel clears the server-side fallback.** Lowest risk, and it keeps the #118 wording. A delegated lookup simply fails over to "open in portal" when the device can't solve it.
- **(b) Keep the server-side fallback and reword #118** so counsel assesses it rather than confirming it doesn't exist.

Recommendation: **(a)**. It costs little convenience and keeps the Registry relationships that D-049 depends on. Log the choice as a superseding decision.

## 8. Research gaps (next pass)

- The eCourts terms pages, Madras HC and Karnataka HC terms, and the text of Notification 230/2026 (from a lawyer's copy).
- The NJDG API application process; the Phase III draft PDF for API and standards language.
- Tribunals not covered: DRT/eDRT, ITAT, CESTAT, NGT, RERA, APTEL, NCLAT; CBIC, RBI and PRS feeds.
- Official SCC Online and Manupatra prices; Provakil, Legistify, LegitQuest product depth; Thomson Reuters and LexisNexis India.
- Primary text of *Pooja Ramesh Singh* (the BCI direction), and the status of the Delhi HC appeal and the SC right-to-be-forgotten case.
- Bedrock Mumbai prices for Claude and Titan.
