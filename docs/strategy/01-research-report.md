# 01 — Research Report: Legal OS for Gen Z Lawyers in India

Version 0.1 · 2026-10-17 · All sources accessed 2026-10-17 unless stated. The detailed notes and the full citation trail are in [research/raw/](../../research/raw/):
[01 Indian research platforms](../../research/raw/01-indian-research-platforms.md) · [02 Practice-management & legal-tech](../../research/raw/02-indian-practice-management-and-legaltech.md) · [03 Global comparators](../../research/raw/03-global-comparators.md) · [04 Regulation & ethics](../../research/raw/04-regulatory-ethics.md) · [05 Workflows & market](../../research/raw/05-indian-lawyer-workflows-market.md) · [05b Workflow deep-dive & verification](../../research/raw/05b-workflows-deep-dive.md) · [06 Tech stack & costs](../../research/raw/06-tech-stack-and-costs.md)

**Evidence tags:** `[V]` verified from a primary or official source · `[R]` reported (press, secondary, competitor, vendor marketing) · `[I]` our inference. ⚖ = needs qualified Indian legal review.
**Method.** Seven parallel desk-research passes used web search and fetch. Several official sites blocked automated fetches, and some content came through search summaries. Where that happened the note is tagged `[R]` even if the URL is primary. **No primary user research has been done yet.** That is the biggest gap, and the [validation plan](../validation/07-validation-plan.md) addresses it.

---

## 1. Executive findings (the ten things that matter)

1. **The Bar is large, but most of it is young and poor.** India has ~20.6–25.7 lakh enrolled advocates (SC, *Ajay Shankar Srivastava v. BCI*, 10 Apr 2023) `[V]`. About 2.3–2.5 lakh candidates sit the AIBE each year, with 69–77% passing `[R]`. More than 79% of advocates with under two years' practice in the surveyed High Courts earn under ₹10,000 a month (Vidhi survey, as cited in a PIL) `[R]`. **Implication:** a free tier is mandatory, and the paying segment is the 2–7-year independent litigator. `[I]`
2. **Litigation volume is enormous, and the "next date" changes constantly.** NJDG shows 5.16 crore cases pending as of 14 Oct 2026, probably subordinate courts only `[V/R]`. Add ~64–65 lakh in the HCs and ~93–96k in the SC `[R]`. Adjournments took ~54% of civil sitting time in DAKSH's 4-court sample `[R]`.
3. **No official public API exists for court data.** The eCourts portals sit behind a captcha. Vendors use OCR to solve the captcha and scrape (the open-source `bharat-courts` SDK, Apify actors), or resell data with undisclosed sourcing (Surepass, eCourtsIndia, Meon) `[R]`. We could not retrieve the portal's terms of use ⚖.
4. **The official eCourts app is losing trust.** It is rated 2.4★ on iOS from ~2.4k ratings, down from 2.9. Complaints include saved cases lost after an update, restore failures and offline access removed `[V: App Store page]`.
5. **AI research is crowded and sold at a premium.**
   - CaseMine AI Pro: ₹29,999/yr; AI Premium ₹41,999/yr `[V]`.
   - Manupatra Starter: ₹14,250, with 5 AI summaries a month `[V]`.
   - SCC Online AI Pro: reported add-on of ₹48,500 `[R]`.
   - Indian Kanoon Prism: ₹5,000/yr Premium, the cheapest option `[V]`.
   - Enterprise players are entering India through content deals: Harvey×SCC (Jan 2026), Legora×Manupatra (Jan 2026) `[V/R]`.
6. **Daily-practice software for juniors and solos is effectively unserved.** Provakil and MyKase are demo-gated and enterprise-oriented `[V]`. Diary apps (~₹300–800/month) have no AI and no evidence of paid traction `[R]`. Nobody offers matter-scoped lawyer memory at the low end `[I]`.
7. **Courts now treat unverified AI citations as misconduct.**
   - *Gummadi Usha Rani* (SC, 27 Feb 2026): "It would be a misconduct and legal consequence shall follow" `[R]`.
   - *Pooja Ramesh Singh v. J&K Bank* (2026 INSC 668, ~2 Jul 2026): "zero tolerance" `[R]`.
   - The Bombay HC imposed ₹50k costs in Jan 2026 `[R]`.
   - The BCI has been asked to frame norms; none are gazetted yet `[R]`.
   - Stanford measured 17–34% hallucination in commercial legal RAG tools `[V]`.
8. **Marketing to the public on lawyers' behalf is a legal minefield.**
   - Rule 36 of the BCI Rules bars direct or indirect solicitation and advertising `[V]`.
   - The Madras HC (3 Jul 2024) directed action against Quikr, Sulekha, JustDial and Grotal listings; the SC SLP is pending with no stay `[R]`.
   - The BCI's 17 Mar 2025 release condemns social-media and influencer promotion `[R]`.
   - The Delhi, P&H and Karnataka bar councils issued warnings in 2025 `[R]`.

   **Implication:** CRM must mean existing-client management only. `[I]` ⚖
9. **Data-protection obligations are on a clock.**
   - DPDP Rules 2025 were notified ~13–14 Nov 2025. Consent-manager rules apply from ~Nov 2026; most substantive duties, including 72-hour breach reports, from ~13–14 May 2027 `[R via mirror]`.
   - CERT-In requires 6-hour incident reporting and 180-day logs kept in India `[V: official PDF]`.
   - Privilege now sits in BSA s.132; *In re: Summoning Advocates* (2025 INSC 1275) applies it `[R]`.
10. **The economics now work for India-resident AI at a low price point.**
    - Claude on Amazon Bedrock became available in-country (Mumbai/Hyderabad) on 29 Sep 2026, with zero data retention by default `[V]`.
    - Haiku 5.5 lists at $0.10/$0.50 per M tokens first-party `[V]`.
    - Sarvam offers Indic OCR at ₹0.50/page and STT at ₹0.49/min `[V]`.
    - Android holds ~94% of Indian mobile web traffic (StatCounter, Sep 2026) and UPI processes ~24 bn transactions a month `[R]`.

---

## 2. Market

| Metric | Value | Tag | Source |
|---|---|---|---|
| Enrolled advocates | ~20.57 lakh (BCI table) to ~25.70 lakh (Court's estimate), Apr 2023 | V | https://api.sci.gov.in/supremecourt/2023/2478/2478_2023_1_28_43311_Judgement_10-Apr-2023.pdf |
| UP Bar Council alone | 4,69,900 (Nov 2024) | V | https://legalaffairs.gov.in/sites/default/files/AU2827.pdf |
| Women advocates (15 councils) | ~2.85 lakh (≈11–15% of Bar) | V/I | https://legalaffairs.gov.in/sites/default/files/AU1034.pdf |
| AIBE XIX | 2.30 lakh appeared, 77.27% passed | R | https://www.barandbench.com/news/aibe-xix-pass-rate-increased-from-51-to-77-rti-reply-reveals |
| AIBE XX | ~2.52 lakh appeared, ~69% passed | R | https://collegedunia.com/exams/aibe/results |
| Law colleges | ~2,000; BCI moratorium on new colleges from Aug 2025 | R | https://educationforallinindia.com/bcis-2025-moratorium-on-new-law-colleges/ |
| Pending cases (NJDG, district) | 5,15,91,381 as of 14-10-2026 | V(page)/I(scope) | https://njdg.ecourts.gov.in/njdgnew/index.php |
| Pending (HC / SC) | ~64–65 lakh / ~93–96k | R | https://www.barandbench.com/news/26-cases-pending-in-supreme-court-for-30-years-558-cases-for-20-years-centre-in-rajya-sabha |
| eCourts Phase III | ₹7,210 cr over 4 years (from 2023) | V | https://static.pib.gov.in/WriteReadData/specificdocs/documents/2023/sep/doc2023922255101.pdf |
| Junior income | >79% (<2 yrs) earn <₹10k/month | R | https://www.barandbench.com/news/delhi-high-court-appeals-senior-lawyers-pay-good-stipend-juniors |
| Stipend guidance | BCI suggests ₹20k urban / ₹15k rural (advisory, Oct 2024); Madras HC fixed floors; SC *Sarika Tyagi* (19 Jun 2026) made tentative remarks on a young-lawyers fund | R | https://www.scconline.com/blog/post/2024/10/16/bci-issues-guidelines-to-pay-minimum-stipend-to-junior-advocates/ ; https://supremetoday.ai/sc-flags-inadequate-court-facilities-for-women-lawyers-and-flags-financial-hardship-and-endorses-proposal-for-young-lawyers-professional-assistance-fund-20260705102208 |
| Mobile OS | Android ~93.9%, iOS ~6.1% (Sep 2026) | R | https://gs.statcounter.com/os-market-share/mobile/india |
| UPI | ~24.07 bn txns, ₹29.37 lakh cr (Sep 2026) | R | https://startuptalky.com/upi-transactions-september-2026/ |

**Sizing** `[I]`, to be replaced by bottom-up data from the pilot:
- **Reachable new entrants:** ~1.6–1.8 lakh AIBE passes a year.
- **Serviceable segment:** active litigators under 35 in metro and tier-2 court complexes. Assume 25–35% of ~10–13 lakh practising advocates, so ~2.5–4.5 lakh. The practising count itself is weak; it rests on one UP ratio.
- **Paying segment:** if 10–20% of that segment pays ~₹3,000/yr, revenue potential is ₹75–270 cr/yr.
- **Bootstrap milestone:** 3,000 paying users × ₹3,000 = ₹90 lakh ARR. That is enough to sustain a 2–3 person team.

## 3. Competitive landscape (summary — full matrix in [05](05-competitor-and-ai-matrices.md))

### 3.1 Indian research platforms
| Product | AI features (how they appear to work) | Pricing signal | Serves | Strengths | Weaknesses / gaps | Why AI | Key sources |
|---|---|---|---|---|---|---|---|
| **SCC Online** (EBC) | **AI Pro** (announced 26 Jan 2026): issue → memo (issues, law, analysis) "anchored in SCC's database"; **Smart Search** (Apr 2026); built on Azure AI Foundry, model undisclosed; Harvey content partnership `[V]` | No official list; ~₹19k–50k/yr; AI Pro reportedly +₹48,500/yr `[R]` | Advocates, firms, corporates | Citation standard, headnotes, 4.36★ Android app | Price opacity; no practice workflow | Defend content moat; conversational search expectations `[I]` | https://www.scconline.com/blog/post/2026/01/26/scc-online-ai-pro-republic-day-announcement/ ; https://www.microsoft.com/en-in/aifirstmovers/fy26scconline ; https://www.scconline.com/blog/?p=372658 |
| **Manupatra** | **AI Search** (Dec 2025), **Citation Verifier**, ManuWorks agentic suite; RAG over a citator-enriched corpus `[R/I]`; MyKase for matters | Starter ₹14,250 (5 AI summaries/mo), Core ₹25,700, Advance ₹31,860 + tax `[V/R]` | Firms, enterprise, academia | Published plans; breadth; Legora partnership | Tiny AI quota at entry; no app found | Moat defence; enterprise upsell | https://www.manupatra.ai/ ; https://www.manupatra.ai/subscription-plans/starter-plan.pdf ; https://www.barandbench.com/news/why-legal-research-demands-more-than-raw-ai |
| **CaseMine** | **AMICUS** (GPT-based RAG): chat, summaries, drafting, arguments; **CaseIQ** brief analysis; AMICUS Advanced (Mar 2026) `[V/R]` | ₹12,999 / 29,999 / 41,999 per yr; ₹1,399–3,999/mo auto-pay; students 10 free credits `[V]` | Advocates, students | Transparent INR monthly pricing; student funnel | Credit caps; no hearings or workflow | Differentiate vs incumbents | https://www.casemine.com/home/pricing ; https://www.casemine.com/home/faq |
| **Indian Kanoon / Prism** | Chat with citations, doc chat, DocGen, counter-arguments, case prediction, moot simulator, study buddy; model undisclosed `[V]` | Free; Premium up to ₹5,000/yr; Pro up to ₹15,000/yr + GST; API ₹0.02–0.50/request `[V]` | Everyone | Free corpus; cheapest AI; only real API | No headnotes or citator; no workspace | Monetise traffic; Gen Z study features | https://indiankanoon.org/prism/pricing/ ; https://indiankanoon.org/members/pricing ; https://api.indiankanoon.org/terms/ |
| **India Code** | Revamped 13 Aug 2026: semantic/speech/AI-assisted search, amendment history, e-Gazette links `[R]` | Free | Public | Authoritative statutes | No API found; no case law | Government digitisation | https://www.manoramayearbook.in/current-affairs/india/2026/08/14/india-code-portal-revamped.html |
| **LexisNexis India** | Case Analysis India (Feb 2026); Protégé Skills + Vault (30 Sep 2026), multi-model including Anthropic `[R]` | Not public | Firms, corporates | Global brand | Enterprise only | Global roadmap | https://www.republicworld.com/initiatives/lexisnexis-launches-skills-in-lexis-advance-with-protege-in-india-advancing-legal-ai-built-on-the-authority-legal-work-demands-2026-09-30-137999 |
| **Jhana / Lucio / Nyayanidhi / Supreme Today / Draft Bot Pro / Bharat.Law / Vaquill** | AI paralegal, research and drafting, Word add-ins (Lucio), uploads; mostly undisclosed internals `[R]` | Mostly unpublished; Jhana reported ₹3.3–5k/mo (conflicting) | Firms (Lucio), lawyers | Funded (Lucio $5M, Jhana $1.6M, Nyayanidhi $2M) | Research and drafting only; little case ops | Startup wedge | https://entrackr.com/2024/09/ai-paralegal-startup-jhana-raises-1-6-mn-in-seed-round ; https://www.businesswire.com/news/home/20251006027921/en/Lucio-Raises-%245M-to-Build-AI-Native-Workspace-for-Lawyers ; https://inc42.com/buzz/nyayanidhi-nets-2-mn-to-automate-legal-research-with-ai |

### 3.2 Practice management & case ops (India)
- **eCourts Services app** (NIC): free and authoritative, but 2.4★ on iOS. Its "My Cases" feature is unreliable `[V]`: https://apps.apple.com/in/app/id1260905816
- **Provakil**: 19,000+ forums claimed, WhatsApp cause lists, billing, client SMS; demo-gated; G2 reviews mention delayed updates `[V/R]`: https://provakil.com/advocates
- **MyKase** (Manupatra): matter management across "10,000+ courts", price on request `[V]`: https://www.mykase.in
- **Legodesk / Legistify / SpotDraft**: lender and enterprise CLM, not for solos `[V/R]`.
- **Vakeel Saathi**: WhatsApp-first next-date queries, cause-list monitor, invoices at ₹799–4,999/month; maker's claims only `[R]`: https://www.producthunt.com/products/vakeel-saathi
- **Vakalat Diary**: ₹400/month Pro, free for ≤5 cases `[R]`.
- **Play-store diary apps**: rated 3.0–4.8★, mostly no AI `[R]`.
- **Adalat AI**: court-side transcription, 6,000+ courtrooms, YC F26. It is not an advocate tool, but it will improve upstream data `[R]`.

### 3.3 Global comparators (what transfers)
- **Clio + vLex** (US$1B acquisition, closed Nov 2025; US$5B valuation) validates practice management + research + drafting under one roof `[R]`. Trust accounting and US court rules don't transfer `[I]`.
- **Harvey Memory** (Aug 2026) is the reference design for lawyer memory: confirm-before-save, viewable, editable, deletable, cited when used, per-user, never trained on `[V]`: https://www.harvey.ai/blog/memory-is-here-harvey-personalized
- **MyCase** (US$50–130/user/mo; AI only in Pro and above; MCP connector) and **PracticePanther** (US$49–114, no AI) show the Western SMB price anchor. It is roughly 10–20× what Indian juniors can pay `[V]`.
- **Smokeball × Westlaw** and **Legora × Manupatra** show that practice-management vendors license research content rather than build it `[V/R]`.
- **Clio Legal Trends 2025**: 79% of legal professionals use AI, but only 40% use legal-specific tools. Free generic AI is the real competitor `[R]`.
- **ABA Formal Opinion 512** (Jul 2024) requires verification, confidentiality and supervision. It is a useful template for product duties `[V/R]`.

## 4. Indian lawyer workflows (what we know vs. what we're assuming)

| Workflow | What the evidence says | Strength | Product implication `[I]` |
|---|---|---|---|
| **Case listing & tracking** | CNR (16-char) lookup on eCourts behind a captcha; "My Cases" in the official app; HC apps have diaries; many private trackers claim 10–19k courts | R/V | User-initiated lookup + manual + PDF; never depend on one source |
| **Cause lists & item numbers** | Published the evening before; supplementary lists; late uploads a long-standing complaint (SCBA 2014; SC AoR 2024); 60–100+ items per court list | R | Evening "Tomorrow" view; live item-position alerts (v1 spike) |
| **Clerks / munshis** | Munshis copy cause lists, update the vakil's diary, cure defects; cost ₹15–30k/month (vendor claim), unaffordable for juniors | R (dated academic + vendor) | Position as "munshi-lite" for juniors without a clerk |
| **Hearings & adjournments** | Adjournments dominate sitting time; next date is the decision-critical datum | R | Next-date provenance + confirmation; post-hearing voice note |
| **Research** | Juniors use the free Indian Kanoon tier, bar-library terminals and seniors' SCC/Manupatra accounts; ~78% of AI use in the Manupatra survey is research | R | Link out; cite-check; don't build a corpus |
| **Drafting** | "Rely heavily on old drafts, online templates, and copy-paste formats", which causes mismatched names, dates and annexures | R | Templates + matter-fact fill + consistency check |
| **Documents / versions** | No data; Word files in folders assumed | — | Simple versioning; DOCX export |
| **Deadlines / limitation** | No practitioner data; doctrine is error-prone (s.12 certified-copy exclusion, *India House v. Kishan N. Lalwani*); free calculators exist | R | Certified-copy tracker + counsel-reviewed rule table (v1) ⚖ |
| **Collaboration** | Chamber hierarchy, seniors' clerks; SC uses WhatsApp for case info (Apr 2024) | R | Share-to-WhatsApp in MVP; chamber plan in v2 |
| **Billing & fees** | No data on collection modes; UPI ubiquitous; RCM GST for business clients | R/I | Fee log (MVP); invoices (v1, CA review) |
| **Client intake & comms** | Personal WhatsApp mixes family and clients (vendor claim); free-advice culture | R | Draft-and-share updates; never auto-message |
| **Confidentiality / security** | Vidhi blog: foreign cloud without consent may breach DPDP and BCI duties; personal-phone risks | R | India residency; app lock; no-training AI; "India-only AI mode" |
| **Mobile use** | Android ~94%; consumer PCs ~7M/yr nationally, so laptops can't be assumed for juniors | R | Android-first, low-RAM, offline; web for drafting |

**Critical gap:** we found **zero** practitioner-sourced quantitative evidence on daily workflows. Reddit, Quora and LinkedIn were not reachable, and no Indian survey covers diaries, clerks or fees. Every workflow claim above must be checked in interviews before we build.

## 5. Regulation & ethics (verified rules vs. product inferences)

### 5.1 Verified or sourced rules
| Topic | Rule / authority | Tag | Source |
|---|---|---|---|
| Solicitation / advertising | BCI Rules Part VI Ch. II **Rule 36** (in Section IV "Duty to Colleagues", not Section II as often stated): no direct or indirect solicitation or advertising "by circulars, advertisements, touts, personal communications…" | V (Gujarat BC copy, may be outdated) | https://www.barcouncilofgujarat.org/images/ActAndRule/BCI&BCG_RULES_1.PDF |
| Website proviso | 2008 BCI resolution permits websites limited to Schedule info (name, contact, enrolment, qualifications, areas of practice); gazette status unclear | R ⚖ | https://itatonline.org/info/advertisement-by-advocates/ |
| Leading case | *Bar Council of Maharashtra v. M.V. Dabholkar* (SC, 3 Oct 1975): "Law is no trade, briefs no merchandise" | V | https://indiankanoon.org/doc/276363/ |
| Aggregators | Madras HC, *P.N. Vignesh v. BCI* (3 Jul 2024): action against lawyer listings on Quikr, Sulekha, JustDial, Grotal; SC notice on Sulekha SLP 11 Nov 2024, no stay; outcome unknown | R ⚖ | https://www.verdictum.in/court-updates/supreme-court/sulekhacom-new-media-private-limited-v-pn-vignesh-ors-special-leave-to-appeal-c-nos-257942024-1557830 |
| Influencers / social media | BCI release 17 Mar 2025; Bar Council of Delhi notice Aug 2025 | R | https://www.scconline.com/blog/post/2025/03/17/bci-condemns-warns-against-unethical-legal-advertising-advocates-legal-influencers-issues-directives/ |
| Unauthorised practice | Rule 37: no lending name or services to aid unauthorised practice | V | Gujarat BC copy |
| Fees | Rule 20: no contingency or share of proceeds; Rules 25–32: client money accounting; **no express "no fee-sharing with non-lawyers" rule found** | V ⚖ | Gujarat BC copy |
| Confidentiality | Rules 17, 24; BSA 2023 s.132 (privilege), ss.133–134; *In re: Summoning Advocates* 2025 INSC 1275 (31 Oct 2025) | V (rules) / R (BSA, judgment) | https://www.scobserver.in/journal/summoning-advocates-who-represent-clients-under-investigation-judgement-summary/ |
| DPDP | Rules 2025 notified ~13–14 Nov 2025; Rule 4 at +12 months; Rules 3, 5–16, 22–23 at +18 months (~May 2027); Rule 7 breach: notify without delay + 72 h report; Rule 15: transfers permitted unless restricted | R (mirror of Gazette) | https://www.dpdpa.com/dpdparules/rule1.html ; https://www.dpdpa.com/dpdparules/rule7.html |
| IT Act s.43A / SPDI | Remain until omitted with the 18-month tranche | R ⚖ | https://ksandk.com/data-protection-and-data-privacy/what-happens-spdi-rules-after-dpdp-enforcement/ |
| CERT-In | 6 h incident reporting; 180-day logs within India; 5-yr subscriber records for cloud and VPN providers | V | https://www.cert-in.org.in/PDF/CERT-In_Directions_70B_28.04.2022.pdf |
| AI citations | SC *Gummadi Usha Rani* (27 Feb 2026), *Pooja Ramesh Singh v. J&K Bank* (2026 INSC 668): unverified AI citations = misconduct; BCI asked to form expert committee | R ⚖ (judgment text not read) | https://www.livelaw.in/amp/top-stories/use-of-ai-generated-fake-judgments-supreme-court-urges-bci-to-form-expert-panel-to-examine-issue-533023 ; https://moneylife.in/article/supreme-court-sets-aside-nclt-judgement-for-relying-on-hallucinated-aigenerated-citations/80952.html |
| AI in courts | Delhi HC *Christian Louboutin v. Shoe Boutique* (22 Aug 2023); Kerala HC district-judiciary AI policy (19 Jul 2025); SC CRP white paper (Nov 2025); MeitY AI Governance Guidelines (~5 Nov 2025) | R | https://www.scconline.com/blog/post/2023/08/28/delhi-hc-artificial-intelligence-cannot-substitute-human-intelligence-in-adjudicatory-process/ ; https://www.medianama.com/2025/07/223-kerala-hc-bars-ai-tools-chatgpt-deepseek/ |
| GST | Notification 13/2017-CT(Rate): advocate services to business entities under reverse charge | R ⚖ (CA) | https://taxindiaonline.com/RC2//pdfdocs/wnew/press_release15july.pdf |
| Judgment copyright | *EBC v. D.B. Modak* (2008) 1 SCC 1: editorial headnotes protected; judgment text not | R | https://lawtimesjournal.in/eastern-book-company-and-ors-vs-d-b-modak-and-ors/ |
| eCourts terms | **Not found.** Automated-access rules unknown | — ⚖ | — |

### 5.2 Product inferences drawn from the rules (not legal conclusions) `[I]` ⚖
- **Allowed:** matter management, deadlines, documents, billing for existing clients; AI drafting with enforced citation verification and an audit log; an advocate-controlled profile limited to Schedule fields on the advocate's own domain (counsel to confirm).
- **Grey:** inbound enquiry forms; educational content tooling; any platform-hosted profile; client feedback collection; hosting outside India.
- **Prohibited by our policy:** prospect campaigns; lead-gen or scoring; directories, ratings and badges; ad, SEO or influencer tooling; referral or commission flows; consumer legal-advice AI; unverified citations or auto-filing; training on client data; scraping in breach of terms; reuse of publisher headnotes; contingency-fee templates.
- The full table is in [raw/04 §8](../../research/raw/04-regulatory-ethics.md).

## 6. Technology & cost facts that shape scope
- **LLMs** (first-party list, $/M tokens in/out): Haiku 5.5 0.10/0.50; Sonnet 5.5 2/10; Opus 5.5 4/20 `[V]` https://platform.claude.com/docs/en/about-claude/pricing
- **India-resident inference:** Bedrock India profile (Opus 5, Sonnet 5, Haiku 4.5), ZDR by default, ~10% regional premium `[V/I]` https://aws.amazon.com/blogs/machine-learning/amazon-bedrock-expands-claude-model-availability-to-india-cross-region-inference/
- **Indic OCR / speech:** Sarvam Document AI ₹0.50–1.00/page; STT ₹0.49/min `[V]` https://www.sarvam.ai/api-pricing. AWS Textract lacks Hindi `[R]`.
- **Sync:** PowerSync Free / Pro $49/mo, plus a self-hostable Open Edition `[V]` https://www.powersync.com/pricing
- **Backend:** Supabase Pro $25/mo `[V]` (Mumbai region assumed, needs confirming); R2 $0.015/GB-mo `[V]`.
- **Payments:**
  - Razorpay 2% + GST `[V]`.
  - RBI e-mandate: no per-transaction AFA up to ₹15,000 `[R]`.
  - Google Play 15% on subscriptions, −4 points with alternative billing in India `[R]`.
  - Stripe India is invite-only `[R]`.
- **WhatsApp utility template:** ~₹0.115 per message (BSP-reported) `[R]`.
- **Court data APIs** (Surepass, eCourtsIndia, Meon): prices unpublished. This is the **largest unknown cost line** `[R]`.

## 7. Confidence & unknowns

### High confidence
- Advocate headcount range; AIBE order of magnitude; NJDG figure (page-level).
- CaseMine, Indian Kanoon and Manupatra Starter prices.
- Rule 36 text and *Dabholkar*; CERT-In directions.
- Anthropic, Bedrock India, PowerSync, Supabase and Sarvam prices.
- That no official eCourts API is publicly documented.
- iOS rating of the eCourts app.

### Medium confidence
- Junior income statistics (petition's description of the Vidhi survey).
- DPDP commencement dates (mirror text).
- The SC AI-citation holdings (consistent press reports; judgment text not read).
- BCI March 2025 release (via SCC Online).
- Madras HC aggregator order; GST RCM structure.
- Competitor funding; Android share; UPI volumes.

### Low confidence / unknown
1. Real daily workflows (cause-list habits, clerks, WhatsApp groups, fees, limitation practice). **No primary data.**
2. Willingness to pay for practice software. No evidence that any diary app converts.
3. eCourts terms for automated access; legality of user-initiated relay lookups ⚖.
4. Current official BCI Rules text, including the 2008 website proviso and Schedule ⚖.
5. Status of the Sulekha/JustDial SLPs ⚖.
6. Court-data API pricing; Indian Kanoon API commercial-use scope.
7. SCC Online's real price list and AI Pro price; Provakil, MyKase and Jhana pricing.
8. Supabase and Neon Mumbai availability; Vertex and Azure India model availability.
9. Share of under-30s in the Bar; state-wise distribution; tribunal counts.
10. Whether BCI AI norms will impose disclosure duties.

### Verification debt to clear before external use of this report
- Read the judgment texts of *Pooja Ramesh Singh* and *Gummadi Usha Rani*.
- Pull the official BCI Rules and the Schedule.
- Read the DPDP Rules in the e-Gazette.
- Read the eCourts terms and robots.txt.
- Read the NJDG HC page.
- Recheck all `[R]` prices before using them in a pitch.


---

## 8. Addendum (v0.3, 2026-10-17): launch-market research and founder-reported findings
- **Founder-reported findings F1–F4** ([raw/07](../../research/raw/07-founder-reported-findings-2026-10-17.md)):
  - solo admin savings are under 30 min/day;
  - lawyers are reluctant to forward client messages;
  - cause-list parsing is court-specific;
  - chamber aggregation is promising.

  These are tagged `[FR]` until their data is added to the repo.
- **Madras HC** ([raw/08](../../research/raw/08-madras-hc-tamil-nadu-court-ecosystem.md)):
  - Cause-list searches (including by advocate and enrolment number) are captcha-gated `[V]`.
  - The **Registry's email push to AIMS-registered advocates** is described in Notification 230/2026 of 6 Oct 2026 `[V]`.
  - An official list of about 130 case types exists, including the "(MD)" suffix `[V]`.
  - Neutral citations began in 2023 `[V]`. Their format, `YYYY/MHC/n`, is reported but not confirmed.
  - Sitting Arrangements take effect from 05.10.2026 `[V]`.
  - The site's hyperlinking page allows linking but forbids framing. Its copyright page conflicts with its terms of use `[V]`.
  - Subordinate courts in Tamil Nadu work in Tamil first `[R]`.
  - The junior stipend is ₹20k in Chennai (*Farida Begam*, 2024) `[R]`.
- **Karnataka HC and Bengaluru** ([raw/09](../../research/raw/09-bengaluru-karnataka-court-ecosystem.md)):
  - The daily and advance cause list is a public HTML page with no captcha, and the dated search covers advocate name and Bar Registration Number `[V]`.
  - A display board shows stage letters with no legend `[V]`.
  - Case status and judgment searches are behind a captcha `[V]`.
  - Neutral citation format is `YYYY:KHC[-D]:n[-DB]` `[R]`.
  - The advance list for final hearings was discontinued in 2021 (DAKSH), so lawyers get about 1 day's notice `[R]`.
  - District cause lists need a double captcha `[V]`.
  - NCLT publishes one PDF per date, with counsel names `[V]`.
  - The Kannada Act (13 of 2023) applies to trial courts; whether it is in force is unclear `[V/R]`.
  - Karnataka State Bar Council had 92,500 enrolled as of 2018 `[V]`.
- Synthesis is in [11](11-launch-markets-madras-hc-bengaluru.md).
