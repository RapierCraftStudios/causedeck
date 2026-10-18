# 01 - Indian legal research platforms: competitor intelligence

Compiled 2026-10-17. Every source below was accessed 2026-10-17.
Tags: [VERIFIED] = vendor/official primary source (note: vendor claims are verified only as *what the vendor says*, not as true performance); [REPORTED] = press or third-party; [INFERENCE] = my reasoning.
Caveat: many Bar & Bench / Republic items are sponsored posts and are labelled as such. Competitor comparison pages (Vaquill, Bharat.Law, JuriGram) are marketing and are tagged [REPORTED] at best.

---

## 1. SCC Online (Eastern Book Company / EBC Publishing)

**Segments.** Lawyers, legal and tax professionals, transactional teams, law firms, in-house/corporate counsel, plus academic institutions. [VERIFIED] Target list from the AI Pro announcement: https://www.scconline.com/blog/post/2026/01/26/scc-online-ai-pro-republic-day-announcement/ (accessed 2026-10-17).

**Core product.** Case law with editorial headnotes, statutes, digests, TruePrint PDFs, 600+ databases. [REPORTED] "600+ databases" and "from ~Rs 18,999/year" come from competitor Bharat.Law: https://bharat.law/resources/best-ai-legal-research-tools-india-2026 (accessed 2026-10-17).

**AI features and timeline**
- **SCC Online AI Pro**: announced 26 Jan 2026 (Republic Day) as "coming soon". Describe an issue or fact pattern in plain language; the tool returns a structured answer (issues, applicable law, analysis, references), with every response "anchored in SCC's authoritative legal database" and linked to case law and statutes. LLM not named; pricing not stated. Positioned "human-led, AI-assisted". [VERIFIED] https://www.scconline.com/blog/post/2026/01/26/scc-online-ai-pro-republic-day-announcement/ (accessed 2026-10-17).
- Demo (Vinsys webinar, published 28 Apr 2026): memo-style output (issues, principles/statutes, application to facts, suggested position), hyperlinked authorities; uses cited are preliminary opinions, clause analysis, due diligence, compliance checks, issue spotting. SCC says queries are confidential and user data is not used for training. [VERIFIED, vendor] https://www.scconline.com/blog/?p=382554 (accessed 2026-10-17).
- **Smart Search**: natural-language search "from case laws to digest notes", blog dated 24 Apr 2026. Availability, plan-inclusion and pricing not stated. [VERIFIED, vendor] https://www.scconline.com/blog/post/2026/04/24/scc-online-smart-search-feature-scctimes/ (accessed 2026-10-17).
- **Harvey partnership**: announced 15 Jan 2026. SCC's Indian and global content (case law, legislation, secondary materials, news, forms and precedents) to be available as a knowledge source inside Harvey; co-developed integration for mutual customers of Harvey and "SCC Online AI". No financial terms or timeline. [VERIFIED] https://www.scconline.com/blog/?p=372658 (accessed 2026-10-17).
- **Architecture**: Microsoft case study calls it a "conversational Agentic Generative AI platform" built on Azure AI Foundry, Agent SDK, Cosmos DB, AI Search and Document Intelligence; no model named; no scale figures. [VERIFIED, Microsoft/vendor] https://www.microsoft.com/en-in/aifirstmovers/fy26scconline (accessed 2026-10-17). [INFERENCE] This is almost certainly RAG over the proprietary corpus with Azure OpenAI models underneath (Azure Foundry hosts them), but this is not disclosed.

**Pricing signals.** No official public price list found. [REPORTED] Annual plans about Rs 18,999 to Rs 49,500 (Platinum Rs 33,500, Platinum Plus Rs 49,500); AI Pro add-on Rs 48,500/user/year + 18% GST (single competitor source, unconfirmed): https://vaquill.ai/alternative/scc-online (search-result summary; the page text I could fetch did not itself show the figure, so treat as unconfirmed) (accessed 2026-10-17). [REPORTED] JuriGram (competing lead-gen platform) claims annual cost "often exceeds Rs 30,000", an EBC Starter Package for advocates in first 36 months subsidised up to 60% (~Rs 800-1,000/month), High Court-specific modules, and a prepaid "Case Wallet" (Rs 500 load, Rs 50 per TruePrint download); all unverified: https://jurigram.com/advocates/resources/legal-research/scc-online-free-access-advocates (accessed 2026-10-17). [REPORTED] Same source says bar library terminals and e-Sewa Kendras give free access (unverified).

**Mobile.** Android app com.scconline: 4.36 average from ~7,477 ratings, v8.8.13, updated 23 Jun 2026 (data pulled 3 Aug 2026 by tracker). [REPORTED] https://chrome-stats.com/d/com.scconline (accessed 2026-10-17). iOS: 52 ratings. [REPORTED] https://appshunter.io/ios/app/scc-online/id1324544648 (accessed 2026-10-17).

**Strengths.** Brand trust and the SC/HC citation standard; editorial headnotes; Harvey tie-up gives enterprise credibility; high-rated app. **Weaknesses.** Price opacity and high entry cost for juniors; AI Pro and Smart Search availability and price unclear; no case management, no cause-list tracking, no document workspace (per competitor claim) [REPORTED] Bharat.Law URL above. **Gap for young solo lawyers [INFERENCE]**: no affordable AI-inclusive tier, no practice-management layer; cheap access only via bar libraries.
**Why they adopted AI [INFERENCE]**: defend the moat against Indian Kanoon Prism, CaseMine and Lexis; answer Gen Z preference for conversational search.

---

## 2. Manupatra (Manupatra Information Solutions)

**Segments.** Law firms, corporate legal, academia; also enterprise "legal operations" suite. [VERIFIED] https://www.manupatra.ai/ (accessed 2026-10-17).

**Product breadth.** Manupatra Online (research), **ManuWorks** (Legal AI, "AI Assistants & Tools", "Agentic AI"), Case, Compliance, Contract, IP and Notice Management, Academy (internships, law notes, students hub), Neutral Citation (free), BDLex (Bangladesh). The 2026 timeline lists "AI Search, Citation Verifier, Manu Reader" as new releases. Claims "100K+ users in 15+ countries". Inconsistent "25 years" vs "26+ years" branding. No standalone app mentioned (Plug-in alerts, WhatsApp/Telegram channels instead). [VERIFIED, vendor] https://www.manupatra.ai/ (accessed 2026-10-17).

**AI Search.** Sponsored Bar & Bench post, 18 Dec 2025: finds precedents for an issue, shows whether a judgment was overruled or distinguished, shows how courts have read a statute, natural-language Q&A with source-backed answers, AI analysis of top 10 results. Built on "proprietary legal knowledge ecosystem" enriched with citations, judicial history, cross-references and expert summaries, claimed to reduce hallucination. Model not named. [REPORTED, sponsored by Manupatra] https://www.barandbench.com/news/why-legal-research-demands-more-than-raw-ai (accessed 2026-10-17). A search summary also credits a free trial via manupatra.ai and SOC 2 Type II / AES-256 / zero-retention claims from other Manupatra Viewpoint pieces I did not open; treat as unconfirmed: https://www.barandbench.com/law-firms/view-point/beyond-generic-ai-tools-built-for-the-law (accessed 2026-10-17). [INFERENCE] Mechanism is RAG over a citator-enriched corpus; the Citation Verifier is a direct response to hallucination risk.

**Pricing (public plan sheets).** [VERIFIED] Starter Rs 14,250 + tax (SC + one High Court of choice; central and state bare acts; commentary, forms, draft agreements; court fees/valuation tools; e-books; **5 AI summaries per month**): https://www.manupatra.ai/subscription-plans/starter-plan.pdf (accessed 2026-10-17; text extracted from PDF structure tags, validity period not shown). [REPORTED] Core Rs 25,700 + tax (SC + all HCs); Advance Rs 31,860 + tax (adds tribunals/commissions), per search-result snippets of https://www.manupatra.ai/subscription-plans/core-plan.pdf and .../advance-plan.pdf (I did not open these two; accessed 2026-10-17). No student or individual-student plan found. Whether prices are annual is not stated [INFERENCE: likely annual].

**Strengths.** Only major player publishing plan sheets; broad enterprise suite; free neutral-citation search. **Weaknesses.** AI quota at entry tier is tiny (5 summaries/month); no app; upload limits and citation reliability not public (per Bharat.Law, competitor) [REPORTED]. **Gap [INFERENCE]**: positioned for firms/enterprise; juniors get legacy UX and no daily-workflow tooling.

---

## 3. CaseMine (Gauge Data Solutions Pvt. Ltd., founded 2013)

**Segments.** Advocates, firms, researchers; also students, prosecutors and judges (free credit tiers); also US/UK markets. [VERIFIED] https://www.casemine.com/home/faq and https://www.casemine.com/home/pricing (accessed 2026-10-17).

**Features.** Judgment search (IJS with Boolean), Parallel Search (conceptual), citator with colour treatment, CiteText, Visual Search, Importance Matrix, task management, bookmarks, topic alerts; **AMICUS AI** (chat, document summarisation, drafting, contract review, argument generation; GPT-based RAG over CaseMine's database); **CaseIQ** (upload a brief/pleading/order, get related precedents, flag problematic citations, table of authorities; "extractive AI"). Coverage: SC, all HCs, tribunals (India); US; UK. [VERIFIED] FAQ above and https://www.casemine.com/home/westlaw-vs-casemine (accessed 2026-10-17).
- **AMICUS AI - Advanced** launched 10 Mar 2026 (sponsored by CaseMine): stronger reasoning/document comprehension/drafting, based on undisclosed internal benchmarks; Standard remains. [REPORTED, sponsored] https://www.barandbench.com/news/casemine-launches-amicus-ai-advanced-its-most-powerful-ai-model-for-legal-work (accessed 2026-10-17).

**Pricing (India, INR, public).** [VERIFIED] https://www.casemine.com/home/pricing (accessed 2026-10-17):
| Plan | 1 month | 1 year | Auto-pay/month | AI credits |
|---|---|---|---|---|
| Essential | Rs 1,999 | Rs 12,999 | Rs 1,399 | n/a (no AMICUS) |
| AI Pro | Rs 3,999 | Rs 29,999 | Rs 2,999 | 250 AMICUS/mo |
| AI Premium | Rs 4,999 | Rs 41,999 | Rs 3,999 | 500 AMICUS/mo |
Free tiers: Student 10 AMICUS credits/month; Prosecutor and Judge 50/month. Uploads 50 MB (Pro), 100 MB (Premium); storage 100 MB / 2 GB / 5 GB; case limits 5 / 20 / unlimited. Note: a competitor (Bharat.Law) quotes USD 499/1,499.99 per year, and CaseMine's US page shows USD 149/month; those are different regions/older data. Tax treatment not stated.

**Mobile.** No app rating found. [UNKNOWN]

**Strengths.** Only major player with transparent INR monthly pricing, a student free tier, and a monthly (no lock-in) option; AI built in since 2023-ish; citator; upload workflow. **Weaknesses.** Credits cap AI usage; citation correctness not independently verified; no court tracking or CRM (per Bharat.Law) [REPORTED]. **Gap [INFERENCE]**: closest to a "young lawyer" price point, but still research-centric; no hearings/cases-as-a-workflow, and Rs 3,999/month for AI is steep for juniors.

---

## 4. Indian Kanoon (Sushant Sinha) and Prism AI

**Segments.** Free for everyone (lawyers, students, public); Prism targets lawyers, students and institutions. 40M+ documents. [REPORTED] JGU library: https://library.jgu.edu.in/2026/04/trial-access-to-prism-ai-indian-kanoon-is-now-active/ (accessed 2026-10-17).

**Free search.** Court judgments, statutes; query alerts, court copies. [VERIFIED] https://indiankanoon.org/prism/pricing/ (accessed 2026-10-17).

**Prism AI** (university trial announced 20 Apr 2026, trial to 31 Jul 2026). Tools on all plans: Know Your Kanoon (chatbot with citations), Talk with IK-doc, DocGen Hub (drafting), Comparison & Review, Upload and Chat, Case Predict AI, Counter Argument Generator, Moot Court Simulation, Study Buddy; NoteIK on paid plans. [VERIFIED] pricing page above; [REPORTED] JGU post. LLM not disclosed. [INFERENCE] RAG over the IK corpus + third-party LLM.

**Prism pricing (INR + 18% GST).** [VERIFIED] https://indiankanoon.org/prism/pricing/ (accessed 2026-10-17); page labels all figures "/year", columns appear to be monthly/quarterly/half-yearly/yearly - ambiguity flagged by the fetch.
- Free: Rs 0, "a few" Prism credits, 25 court-copy downloads/month, 2 query alerts.
- Premium: Rs 500 / 1,500 / 2,700 / 5,000; 20x credits; 250 downloads/mo; 25 alerts; 500 MB storage.
- Pro: Rs 1,500 / 4,500 / 8,000 / 15,000; 100x credits; 1,000 downloads; 100 alerts; 2 GB.
Competitor Bharat.Law quotes only "Rs 15,000/year plus GST" for Prism. [REPORTED]

**API.** Prepaid per request: search Rs 0.50, document Rs 0.20, fragment Rs 0.05, metainfo Rs 0.02; Rs 500 free on signup; non-commercial use "free Rs 10,000/month" after use-case verification by administrator; payment gateway not yet integrated (NEFT/RTGS/SWIFT). [VERIFIED] https://indiankanoon.org/members/pricing (accessed 2026-10-17). API pricing for AI features: not listed.

**Mobile.** Rating not found. [UNKNOWN]

**Strengths.** Cheapest credible option (Premium Rs 5,000/yr); only one with an API; huge free corpus; Prism feature breadth (moot court, study buddy appeals to Gen Z). **Weaknesses.** No headnotes or editorial citator; reliability of AI predictions untested; no workspace/case management, no court tracking (per Bharat.Law) [REPORTED]; credit system opaque. **Gap [INFERENCE]**: best build-on/integrate candidate for research data (API), but terms of commercial redistribution need legal review; no hearing/matter workflow.

---

## 5. India Code (Legislative Department / NIC)

**What it is.** Official digital repository of the Constitution, Central Acts and subordinate legislation, State Acts and UT legislation. Built by NIC for the Legislative Department. [REPORTED] https://www.manoramayearbook.in/current-affairs/india/2026/08/14/india-code-portal-revamped.html (accessed 2026-10-17); official about page returned HTTP 403 to my fetch: https://www.indiacode.nic.in/about.jsp?locale=en.

**Revamp.** Launched 13 Aug 2026 by MoS (IC) Law and Justice Arjun Ram Meghwal: semantic and speech search, AI-assisted search/interaction, amendment and legislative history, Act-to-subordinate-legislation links, e-Gazette integration, QR access, feedback mechanism; goal of AI-assisted access in all 22 Eighth Schedule languages (stated as aim, not confirmed). [REPORTED] same source (secondary; I found no official notice).

**API/limitations.** No public API, bulk download or developer documentation found in any source I reached. [UNKNOWN; absence of evidence]. [INFERENCE] Treat as a free source of authoritative bare-act text to be scraped/linked cautiously; check terms and robots before ingestion. Free, no case law.

---

## 6. LexisNexis India, Westlaw India, Lexis+ AI

**LexisNexis India.** Lexis Advance India; **Case Analysis India** launched Feb 2026 (precedent value, treatment over time, visual indicators); **Protege Workflow** standalone AI workflow tool (Apr 2026; press release date placeholder unfilled; to integrate with LexisNexis content later); **Skills in Lexis Advance with Protege** announced 30 Sep 2026 for law firms and corporate legal departments: guided skills (India contract analysis, amendment tracking, NDA/playbook review; litigation skills like drafting written submissions, reviewing witness statements, triaging summonses/orders), Protege Vault for matter documents, grounding in LexisNexis India content, CaseAnalysis India, uploads and (for General AI) web; "multiple leading AI models" with skills from LexisNexis and Anthropic. [REPORTED, company announcement carried by Republic World] https://www.republicworld.com/initiatives/lexisnexis-launches-skills-in-lexis-advance-with-protege-in-india-advancing-legal-ai-built-on-the-authority-legal-work-demands-2026-09-30-137999 ; [VERIFIED, vendor] https://www.lexisnexis.com/blogs/in-legal/b/law/posts/launch-protege-india (via search summary; page not opened) (accessed 2026-10-17). Product page fetch failed (parse error): https://www.lexisnexis.com/en-in/products/lexis-advance-protege.
- Lexis+ AI with Protege launched in Singapore and Malaysia on 2 Oct 2025; no India "Lexis+ AI" branding found. [REPORTED] https://www.lexisnexis.com/blogs/my/b/press-room/posts/launch-lexis-plus-ai-with-protege-malaysia (search listing).
- Pricing: not public; competitor says opaque/contract-locked and ~2.4M Indian cases [REPORTED, unverified] https://vaquill.ai/alternative/lexis-ai.
- Segment: firms and corporates, not juniors. Strength: global brand, Shepard's-style validation, Anthropic skills. Weakness: enterprise sales, price. [INFERENCE]

**Westlaw India (Thomson Reuters).** I found no India-specific announcement of Westlaw India AI or CoCounsel India. Competitor Vaquill claims Westlaw Asia Indian coverage is archived at March 2021 with 20 HCs and 14 tribunals [REPORTED, unverified] https://vaquill.ai/alternative/westlaw (accessed 2026-10-17). Thomson Reuters global products (Westlaw Advantage, Deep Research) do not mention India: https://legal.thomsonreuters.com/en/products/westlaw-advantage. [INFERENCE] Westlaw is a minor factor in Indian solo/junior practice.

---

## 7. News and media (not research)

- **LiveLaw**: legal news, judgments, digests, mobile apps, "Premium" subscription. Latest prices I could find are stale promos: Nov 2023 Diwali sale Rs 1,299/1yr, 2,099/2yr, 3,240/3yr + GST; Oct 2022 standard Rs 1,499/yr + GST. Current price unverified. [REPORTED] https://livelaw.in/lawschool/top-corner-stories/livelaw-premium-subscription-242113 (accessed 2026-10-17).
- **Bar & Bench**: news, also hosts sponsored product posts. Student annual subscription Rs 999 (1yr)/Rs 2,499 (3yr), valid to 31 Dec 2026 (an older page says Rs 699). [REPORTED] https://www.barandbench.com/Law-School/annual-subscription-law-students-999-year (accessed 2026-10-17).
- [INFERENCE] These are distribution channels and mindshare sources for the target audience, not competitors; but their cheap student pricing sets a price anchor (Rs ~1,000/yr).

---

## 8. Emerging Indian AI tools (2024-2026)

- **Jhana (jhana.ai)**: Bengaluru, Harvard founders; $1.6M seed led by Together Fund (Sep 2024). Research, drafting, document review; free plan with 10 paralegal chats, 15 searches, 30 files of document intelligence; paid prices not found; claims 10,000+ users incl. 150+ judges/registrars (unverified). Targets lawyers, firms, in-house, tax, judiciary. [REPORTED] https://entrackr.com/2024/09/ai-paralegal-startup-jhana-raises-1-6-mn-in-seed-round ; https://lapaasvoice.com/startup/jhana-ai/ (accessed 2026-10-17).
- **Lucio**: Bengaluru; founded 2022 by Vasu Aggarwal and Darsan Guruvayurappan; $5M seed led by DeVC (reported 7 Oct 2025); AI-native workspace (drafting, review, due diligence, research, translation, compliance tracking); claims 200+ orgs, 3,000+ lawyers, nine jurisdictions; Dec 2025 interview names Harvey/Legora as competitors and prioritises US/UK expansion. [REPORTED] https://www.entrackr.com/snippets/legal-tech-startup-lucio-raises-5-mn-led-by-devc-10536460 ; https://www.businesswire.com/news/home/20251006027921/en/Lucio-Raises-%245M-to-Build-AI-Native-Workspace-for-Lawyers (accessed 2026-10-17). [INFERENCE] Enterprise/firm focus, going global, leaving the India solo segment under-served.
- **Nyayanidhi**: founded 2024; $2M seed (3one4 Capital); targets advocates for documentation, court filings, multilingual translation. [REPORTED] https://inc42.com/buzz/nyayanidhi-nets-2-mn-to-automate-legal-research-with-ai (accessed 2026-10-17).
- **Legitquest**: AI research, case management, due diligence; pricing "subscription plans aimed at law firms and enterprises", free trial credits, card and UPI; demo required for attorneys; no public prices. [VERIFIED, vendor] https://www.legitquest.com/legal-research-tool-pricing (accessed 2026-10-17).
- **Bharat.Law / BharatLaw.ai**: Bharat.Law claims court tracking across 15,000+ courts, uploads to 10,000 pages, shared case workspace, paid plans unlisted [REPORTED, self-promotional] https://bharat.law/resources/best-ai-legal-research-tools-india-2026. [INFERENCE] This is the only competitor in the roundup with court tracking plus research; closest to our OS thesis; verify independently.
- **Vaquill**: API-first Indian case law/AI Q&A; credits at Rs 10 each (search 0.1 credit, AI Q&A 0.5, deep research 2.0) [REPORTED, self-published, via search summary] https://vaquill.ai/case-law-api (accessed 2026-10-17). Also seen publishing "alternative to" pages against every incumbent.
- **Not found**: NyayaGPT and Nearlaw produced no credible results; Vidhi (think-tank) is not a research product. Do not assume they exist as competitors. "NyayaAI" is an academic paper (May 2026), not a product. [REPORTED] https://www.emergentmind.com/papers/2605.10155.
- **Courts' own tools**: SUPACE (Apr 2021, judges), SUVAS translation (36,271 SC judgments into Hindi; 17,142 into regional languages by 2024). [REPORTED] https://analyticsindiamag.com/the-supreme-court-of-india-gets-a-new-ai-portal-suvas ; https://lawfullegal.in/harnessing-artificial-intelligence-in-the-indian-judiciary-an-analysis-of-e-courts-suvaas-and-supace/ (accessed 2026-10-17).

---

## 9. Regulatory and trust context (why verified citations matter)

- July 2026: Supreme Court (Narasimha and Aradhe JJ.) in *Pooja Ramesh Singh v. J&K Bank* set aside NCLT/NCLAT orders relying on hallucinated AI-generated precedents; said citing unverified AI precedents can be advocate misconduct; directed the Bar Council of India to constitute a committee. Draft "Regulations for Use of AI in Courts, 2026" in consultation. [REPORTED, not checked against judgment text] https://www.freepressjournal.in/mumbai/supreme-court-declares-zero-tolerance-for-ai-generated-fake-legal-precedents-directs-bar-council-to-act ; https://moneylife.in/article/supreme-court-sets-aside-nclt-judgement-for-relying-on-hallucinated-aigenerated-citations/80952.html (accessed 2026-10-17).
- [INFERENCE] Incumbents (Manupatra Citation Verifier, SCC "anchored" answers, Lexis Shepard's) are all marketing verifiability. A low-cost entrant must show click-through to the source judgment and never generate citations free-form.

---

## 10. Cross-cutting analysis [INFERENCE unless stated]

1. **Price ladder**: Indian Kanoon Premium Rs 5,000/yr < CaseMine Essential Rs 12,999 < Manupatra Starter Rs 14,250 ~ Prism Pro Rs 15,000 < SCC base ~Rs 19-33k < CaseMine AI Pro Rs 29,999 < CaseMine Premium Rs 41,999 < SCC AI Pro (reported +Rs 48,500). AI adds a steep premium everywhere except Prism.
2. **Mechanism pattern**: RAG over proprietary or curated corpus + citator metadata; vendors compete on "grounded in our database". Nobody discloses LLMs except CaseMine (GPT) and Lexis (multiple, incl. Anthropic skills).
3. **Nobody serves the junior's daily workflow**: hearings/cause lists, matter diary, client updates, limitation reminders, drafting templates tied to a matter. Case management lives in enterprise suites (Manupatra, Legitquest) or startups (Bharat.Law, Lucio).
4. **Lawyer-specific memory** (firm's own drafts, past arguments, style): only Lucio, Lexis Protege Vault, and CaseMine uploads touch it. Open opportunity at low price.
5. **Student/Gen Z hooks**: CaseMine free student credits, Prism Study Buddy/Moot Court, Manupatra Academy. Early habit capture is an active tactic.
6. **Why AI now**: generative-search expectations from ChatGPT; funded startups (Jhana, Lucio) threatening headnote moats; cost of Rs 30k+ subscriptions for solos; court AI push.

## Confidence & unknowns

- High confidence: CaseMine and Indian Kanoon pricing (read from official pages; Prism column labelling ambiguous); Manupatra Starter price; SCC AI Pro announcement facts; Harvey partnership.
- Medium: Lucio, Jhana (press only); LexisNexis India launches (company announcement); India Code revamp (secondary press, no official notice).
- Low/unknown: SCC Online current official price list and AI Pro price (only competitor-sourced); Manupatra Core/Advance details and validity; Manupatra student plans; app ratings for Manupatra, CaseMine, Indian Kanoon; Westlaw India status; India Code API existence; Indian Kanoon ToS for commercial reuse and Prism LLM provider; LLMs behind SCC/Manupatra/Prism; whether SCC AI Pro is generally available; Bar & Bench student price (Rs 699 vs 999 conflicting). WebSearch summaries were used for several items, and only some pages were opened directly; items marked "search summary" should be re-checked.
- Not found at all: NyayaGPT, Nearlaw.

## Summary table

| Product | Segment | AI | Price (public) | Mobile | Main gap for juniors |
|---|---|---|---|---|---|
| SCC Online | firms, advocates | AI Pro, Smart Search, Harvey tie-up | not official; ~Rs 19-50k/yr reported | Android 4.36 (7.5k) | price, no workflow |
| Manupatra | firms, enterprise | AI Search, Citation Verifier, ManuWorks | Rs 14,250 / 25,700 / 31,860 + tax | none noted | 5 AI summaries/mo, enterprise focus |
| CaseMine | advocates, students | AMICUS (GPT RAG), CaseIQ | Rs 12,999 / 29,999 / 41,999 per yr; monthly options | unknown | credit caps, no hearings |
| Indian Kanoon | everyone | Prism suite | Free; Rs 5,000 / 15,000 per yr + GST; API per request | unknown | no workspace |
| India Code | public | AI search (Aug 2026) | free | n/a | no API found, no case law |
| LexisNexis India | firms, corporates | Case Analysis, Protege Skills | not public | n/a | enterprise only |
| Westlaw India | n/a | none found for India | not public | n/a | marginal |
| Jhana | lawyers, judiciary | research, drafting | free tier; paid unknown | unknown | pricing unclear |
| Lucio | firms, global | AI workspace | not public | unknown | firm/global focus |
| Legitquest | firms, enterprise | iSearch, case mgmt | not public | unknown | no junior plan |
