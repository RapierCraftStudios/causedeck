# 03 - Global comparators for an India-first legal OS (raw research)

Compiled 2026-10-17. Tags: [VERIFIED] = official/primary page fetched; [REPORTED] = press/secondary/aggregator; [INFERENCE] = my reasoning. Every sourced claim carries "(accessed 2026-10-17)". No price is invented: where no list price was found, it says "not published". Search tool results were summaries of web pages, so several [REPORTED] items were not re-checked against the primary page; this is flagged inline.

---

## 1. Vendor-by-vendor comparison

### 1.1 Harvey (enterprise, Big Law / in-house)
- Segment: large law firms, corporate legal, professional services. India office opened Nov 2025; reported Indian clients include Shardul Amarchand Mangaldas, AZB & Partners, PwC India [REPORTED] (https://www.newsbytesapp.com/news/business/harvey-ai-opened-india-office-with-tailored-legal-models/tldr) (accessed 2026-10-17).
- Features: Web app, Outlook and Word add-in, playbook runs, agents, Vault (document sets). Memory: "Memory" stores standing preferences (tone, format, audience, jurisdiction), saved when the user asks or a prompt signals a preference; each save is confirmed via a card showing what was stored; user can review, edit, search, delete or turn memory off; admins control availability; memory follows the user across Web App, Outlook, Word Add-In, playbooks and agents; when a memory shapes an answer Harvey cites it like a source; scoped to the individual only today, shared-space and org-level memory "in development/planned"; individual memories "never used to train AI models"; blog dated 2026-08-26, Early Access [VERIFIED] (https://www.harvey.ai/blog/memory-is-here-harvey-personalized) (accessed 2026-10-17).
- Pricing: no rate card. Third-party estimates of ~USD 1,000-2,000/seat/month with 20-25 seat minimums, 12-month contracts, onboarding fees USD 10k-50k; Harvey has reportedly disputed such estimates [REPORTED, low reliability] (search summaries of https://www.eesel.ai/blog/harvey-ai-pricing and https://www.vaquill.ai/blog/harvey-ai-review-honest-assessment, a competitor) (accessed 2026-10-17).
- Funding/adoption: a USD 550M round at ~USD 15.5B post-money reported around Sept-Oct 2026 (sources disagree on date and USD 15.5B vs 16B); earlier USD 8B (Dec 2025) and USD 11B (Mar 2026). ARR estimates range USD 300M (Sacra, May 2026) to 400M+; 1,300 to 3,000+ customer orgs, 100k+ lawyers depending on source [REPORTED, aggregators] (https://sacra.com/c/harvey/ ; https://www.saasrise.com/deals/harvey-raises-550m-in-funding-round-valuation-reaches-155b-fdaacbc6-e5ae-49f1-a9e7-224789dfde95) (accessed 2026-10-17).
- Strengths: deep workflow agents, memory with clear controls, enterprise trust. Weaknesses: price, minimums, enterprise sales motion.
- India: [INFERENCE] memory UX (confirmation card, citation of memory, edit/delete) translates fully. Pricing and Big-Law positioning do not; irrelevant to a solo/small-firm Gen Z lawyer.

### 1.2 Thomson Reuters CoCounsel / Westlaw AI
- Segment: mid-to-large firms, corporate legal, government.
- Features: CoCounsel Legal launched 2025-08-05 with agentic guided workflows and Deep Research (multi-step research plan, visible reasoning, citation-backed reports grounded in Westlaw and Practical Law); agents use Westlaw tools such as KeyCite and Key Numbers; Westlaw Advantage launched Aug 2025 [VERIFIED press release; details via LawNext/Legal Technology] (https://www.thomsonreuters.com/en/press-releases/2025/august/thomson-reuters-launches-cocounsel-legal-transforming-legal-work-with-agentic-ai-and-deep-research ; https://legaltechnology.com/thomson-reuters-launches-cocounsel-legal-with-agentic-ai-and-deep-research-capabilities/) (accessed 2026-10-17). Word/Microsoft 365 integration: not confirmed in my searches.
- Pricing: not published. A third-party aggregator lists ~USD 104-639/user/month across four plans (top: Westlaw Advantage with CoCounsel Essentials ~USD 639), with other pages quoting earlier different figures; treat as unreliable [REPORTED] (https://costbench.com/software/ai-legal-tools/cocounsel/calculator) (accessed 2026-10-17).
- Strengths: proprietary content moat (Westlaw, KeyCite citator). Weakness: bundled with content subscriptions; Stanford study found high hallucination in Westlaw AI-Assisted Research (see 2.1).
- India: [INFERENCE] the moat is content plus citator. India has no equivalent open citator; the closest are SCC Online, Manupatra and CaseMine, so content licensing is the hard problem, not the LLM.

### 1.3 LexisNexis Lexis+ AI / Protege
- Features: Protege went GA Jan 2025 inside Lexis+ AI and Lexis Create+ (drafting in Word), replacing the earlier assistants; LexisNexis says it personalises output to practice area, jurisdiction and writing style, uses the firm's DMS, works with Word, Outlook, Teams and Copilot; personalisation is "controlled by the user or organisation" [VERIFIED vendor pages] (https://www.lexisnexis.com/blogs/amppage/136/introducing-lexisnexis-protege-the-next-generation-of-personalised-legal-ai-for-lawyers ; https://www.lawnext.com/2025/01/lexisnexis-launches-protege-ai-assistant-to-general-availability-promising-autonomous-completion-of-legal-tasks.html) (accessed 2026-10-17). The vendor page I fetched does not describe a persistent "memory" store or what is retained; so Lexis personalisation is best described as profile/DMS-grounding rather than documented conversational memory [VERIFIED absence on that page; not exhaustive].
- Pricing: not published (not found).
- Strengths: content plus Office integration. Weakness: Stanford found Lexis+ AI hallucinating 17%+ (see 2.1); opaque personalisation.
- India: [INFERENCE] DMS-grounding translates only if the lawyer actually keeps files in a DMS; most Indian small practices use WhatsApp, Drive, Word and paper. Memory should be built on the lawyer's own matter files and notes.

### 1.4 Clio (Manage, Duo/Manage AI, Vincent, Clio Work)
- Segment: SMB law firms globally, largest PMS vendor. Acquired vLex (Vincent AI) for USD 1B announced June 2025, closed 2025-11-10 alongside a USD 500M Series G at USD 5B valuation [REPORTED] (https://techcrunch.com/2025/06/30/legal-software-company-clio-drops-1b-on-law-data-giant-vlex ; https://www.folio3.ai/ai-pulse/clio-completes-usd-1-billion-vlex-acquisition-secures-usd-500-million-funding-usd-5-billion-valuation) (accessed 2026-10-17). Clio's own press release: https://www.clio.com/uk/about/press/clio-signs-definitive-agreement-to-acquire-vlex/ [VERIFIED for announcement].
- Features: Clio Duo (announced as built-in assistant) later reported renamed "Manage AI"; ClioCon 2025 introduced Vincent by Clio; April 2026 agentic capabilities in Clio Work and a standalone Vincent mobile app for multi-step tasks over a ~1B document library [REPORTED] (https://www.artificiallawyer.com/2026/04/08/clio-rolls-out-agents-for-work-and-vincent/ ; https://www.clio.com/?p=51349) (accessed 2026-10-17).
- Pricing: Clio's pricing page returned HTTP 403 to my fetch. Third-party sources say EasyStart ~USD 49/user/month with higher tiers quote-gated (est. USD 89-149), Manage AI quote-priced add-on, not on EasyStart [REPORTED, conflicting] (https://costbench.com/software/legal-practice-management/clio-manage/ ; https://checkthat.ai/brands/clio/pricing) (accessed 2026-10-17).
- Strengths: distribution, integrations, trust accounting, payments (US/Canada/UK/AU focus). Weaknesses: US-centric billing/trust workflows; AI add-on gated at higher tiers.
- India: [INFERENCE] the "PMS + research + drafting under one roof" thesis (Clio plus vLex) is the strategic validation of the OS idea. Trust accounting/LEDES features do not translate; cause-list, e-courts and limitation tracking would be the India equivalents.

### 1.5 MyCase (8am)
- Pricing [VERIFIED, official page]: Basic USD 60 monthly / 50 annual; Pro 120 / 100; Advanced 150 / 130 per user per month; Accounting add-on USD 39/user/month. AI: 8am IQ Writing and Document Assistant in Pro; 8am IQ Case Assistant and Discovery Assistant (OCR, 5,000 pages/user/month, extra 5,000 pages USD 30) in Advanced; an official MCP connector lets users query MyCase data from Claude (plan not stated) (https://www.mycase.com/pricing/) (accessed 2026-10-17).
- Insight: AI is a tier-upsell, and an MCP connector shows PMS vendors positioning as data layers for general assistants. [INFERENCE]

### 1.6 Smokeball
- [VERIFIED official page]: no dollar prices; quote-based. Plans Bill, Boost, Grow, Prosper+; Word and Outlook (Microsoft 365) integration from Boost; Archie AI assistant is an add-on; "Westlaw Deep Research in Archie AI" announced with a headline dated 2026-10-13 (https://www.smokeball.com/pricing) (accessed 2026-10-17).
- Insight: PMS vendors are licensing content/research from incumbents (Westlaw) instead of building it. [INFERENCE]

### 1.7 PracticePanther
- [VERIFIED official page]: Solo USD 59 monthly / 49 annual; Essential 79/69; Business 99/89; Business Pro 124/114 per user per month; no AI features listed on the pricing page (https://www.practicepanther.com/pricing/) (accessed 2026-10-17).
- Insight: PMS without AI is an eroding position; per-user entry prices of ~USD 49-60 anchor the Western SMB market. [INFERENCE]

### 1.8 Filevine
- Segment: plaintiff/PI and mid-size firms. USD 400M raised in 2025 (USD 140M Series D-2 plus USD 260M Series E, Sept 2025); Sacra estimates USD 250M ARR in April 2026 (third-party estimate); acquired Parrot (Apr 2025) and Pincites (Word-based contract redlining; dated Dec 2025/Jan 2026, sources conflict); no AI pricing found [REPORTED] (https://sacra.com/c/filevine ; https://www.lawnext.com/2025/09/filevine-raises-400m-in-two-round-funding-to-scale-ai-powered-legal-platform-i-speak-with-its-ceo.html) (accessed 2026-10-17).
- Insight: PMS vendors are buying Word-native drafting tools: Word is the center of lawyer drafting everywhere. [INFERENCE]

### 1.9 Spellbook
- Segment: transactional lawyers and in-house; Word add-in (Review, Draft, Ask, Benchmarks, Playbooks) plus "Associate" multi-document agent; 7-day trial; pricing by team size, no public numbers [VERIFIED] (https://spellbook.com/pricing) (accessed 2026-10-17). Funding/valuation not researched in this pass.
- Strengths: in-Word UX, playbooks (lawyer's own standards = a form of memory). India: playbook-style "my standard clauses" translates well. [INFERENCE]

### 1.10 Legora
- Segment: law firms and in-house in 50+ markets. Series D USD 550M at ~USD 5.55B (Mar 2026), extended +USD 50M (Sacra); FT-reported early talks at USD 10B+ [REPORTED, unconfirmed]; ARR est. USD 100M (Apr 2026) to 150M (Q2); 800 to 1,500 customers depending on source (https://sacra.com/c/legora/ ; https://lawyer-monthly.com/2026/08/legora-10bn-valuation-harvey-15bn-ai-funding/) (accessed 2026-10-17).
- India: Legora has real Indian traction: Dua Associates (8 offices), Veritas Legal, Chandhiok & Mahajan firm-wide, and an exclusive data partnership with Manupatra (Jan 2026) [VERIFIED vendor newsroom / REPORTED Bar & Bench] (https://www.artificiallawyer.com/2026/01/20/legora-partners-with-indian-legal-data-company-manupatra/ ; https://www.barandbench.com/news/corporate/chandhiok-mahajan-announces-firm-wide-rollout-of-legora) (accessed 2026-10-17). Implication: enterprise players are entering India via licensed local content; the bottom of the market (solo/junior) is not served. [INFERENCE]

### 1.11 Eudia
- In-house legal AI plus "Eudia Counsel", an AI-augmented law firm under Arizona's ABS programme (launched 2025-09-03); Series A up to USD 105M (Feb 2025, General Catalyst; USD 30M upfront, USD 75M contingent on acquisitions); valuation figures unofficial (USD 250-525M estimates) [REPORTED] (https://www.artificiallawyer.com/2025/09/03/eudia-opens-ai-augmented-law-firm-for-ma/ ; https://www.verdict.co.uk/eudia-raises-upto-105m-in-series-a-round/) (accessed 2026-10-17).
- India: services-plus-software hybrid is barred by Indian rules (Advocates Act restricts non-lawyer practice; Bar Council rules on advertising/fee sharing) [INFERENCE, not researched in this pass: verify with Bar Council of India Rules before relying].

### 1.12 Luminance
- Contract review/negotiation, UK-origin; USD 75M Series C (Feb 2025, Point72), USD 165M total per company; "Panel of Judges" multi-model cross-checking before a final orchestration layer (company description, unverified marketing claim) [VERIFIED company pages for statements; claim of accuracy unverified] (https://www.luminance.com/press/luminance-raises-75-million-in-series-c-funding-round/ ; https://www.luminance.com/technology.html) (accessed 2026-10-17). No 2026 round found.

### 1.13 Paxton
- US legal research/drafting for small/mid firms. USD 22M Series A (2025), USD 28M total [REPORTED] (https://www.geekwire.com/2025/oregon-legal-tech-startup-raises-22m-to-fuel-ai-platform-that-speeds-research-drafting-and-more/). Pricing reported inconsistently: USD 199-299/lawyer/month vs USD 499/user/month or USD 2,999/year [REPORTED, conflicting] (https://spellbook.com/learn/paxton-ai-pricing, a competitor; https://www.g2.com/products/paxton-ai/pricing) (accessed 2026-10-17). July 2026 launch of "Secure Matter Collaboration" (https://www.lawnext.com/2026/07/paxton-ai-launches-secure-matter-collaboration-the-most-advanced-way-for-litigation-teams-to-share-matter-intelligence.html).
- Relevance: closest Western analogue for "affordable AI for small firms", and its price band (~USD 200-500) is still 10x+ above what an Indian junior can pay. [INFERENCE]

### 1.14 Supio
- Plaintiff PI / mass-tort evidence analysis; USD 60M Series B (2025-04-30; Sapphire, Mayfield, Thomson Reuters Ventures; USD 91M total); no published pricing; reportedly per-case-volume subscription [VERIFIED press release / REPORTED] (https://www.businesswire.com/news/home/20250430087416/en/Supio-Announces-$60M-Series-B-to-Accelerate-Adoption-of-Legal-AI-in-Plaintiff-Law) (accessed 2026-10-17). Lesson: vertical focus (one practice area, one painful document workflow) beats horizontal. [INFERENCE]

### 1.15 Indian incumbents and entrants (for context)
- CaseMine: reported plans Essential USD 499/yr and AI Premium USD 1,499.99/yr, or from INR 3,999/month; no court-tracking per a competitor's review. Lucio: Delhi-area startup, USD 5M seed (Jul 2025, DeVC), enterprise pricing. Jhana: Bengaluru, ~USD 1.6M raised. SCC Online entry ~INR 18,999/yr [REPORTED, many from competing vendors, so low reliability] (https://bharat.law/resources/best-ai-legal-research-tools-india-2026 ; https://neuronfeed.com/startups/lucio-ai) (accessed 2026-10-17). Not researched: Adalat AI, Nyay, Manupatra AI pricing.

---

## 2. Evidence on hallucination and sanctions

### 2.1 Measured hallucination rates
- Stanford RegLab/HAI (Magesh et al., 2024; pre-registered, 200+ open-ended legal queries): Lexis+ AI and Thomson Reuters Ask Practical Law AI hallucinated "more than 17%" of the time; Westlaw AI-Assisted Research "more than 34%"; legal RAG tools reduced but did not eliminate errors versus general chatbots (58-82% in the authors' earlier study). Hallucination defined as incorrect (misstates law) or misgrounded (cites a source that does not support the claim) [VERIFIED] (https://hai.stanford.edu/news/ai-trial-legal-models-hallucinate-1-out-6-or-more-benchmarking-queries) (accessed 2026-10-17). Thomson Reuters disputed that Ask Practical Law AI was meant for this use [REPORTED] (search summary of Stanford/press coverage). Note the Stanford RegLab page quotes 17%-33%; the HAI page says 34%. Use "17-34%".
- Later: Vals Legal AI Report (VLAIR) legal research study, Oct 2025: Alexi, Counsel Stack, Midpage and ChatGPT scored 74-78% versus a 69% lawyer baseline (Alexi's own release says 71%); legal tools beat the generalist, and all beat the lawyer baseline; many big vendors declined to participate [REPORTED] (https://www.lawnext.com/2025/10/vals-ais-latest-benchmark-finds-legal-and-general-ai-now-outperform-lawyers-in-legal-research-accuracy.html ; https://www.law.berkeley.edu/wp-content/uploads/archive/2025/12/VALs-AI-Legal-AI-report-February-2025-.pdf) (accessed 2026-10-17). Takeaway: accuracy is improving, but benchmark results are US-law and vendor-selected. [INFERENCE]

### 2.2 Court sanctions and warnings
- Tracker: Damien Charlotin's AI Hallucination Cases database: ~1,598 cases worldwide as of 2026-06-09 per one secondary source; 1,058 US cases early June (UNC) and 1,240 US (MSBA, July 2026); growth ~8/day [REPORTED, secondary; count definitions differ] (https://library.law.unc.edu/2026/06/handling-hallucinations-a-reflection/ ; https://haqq.ai/blog/ai-legal-hallucination-audit.html) (accessed 2026-10-17).
- UK: R (Ayinde) v London Borough of Haringey; Al-Haroun v Qatar National Bank [2025] EWHC 1383 (Admin), 6 June 2025, Divisional Court. A pupil barrister's grounds cited five non-existent cases; court warned that placing false authorities before a court can lead to referral to the BSB/SRA, contempt or police referral, and stressed lawyers' duty to verify; earlier wasted-costs ruling [2025] EWHC 1040 (Admin) [REPORTED via law-firm notes] (https://inquisitiveminds.bristows.com/post/102kpmf/divisional-court-delivers-stark-warning-on-ai-use ; https://www.hsfkramer.com/notes/litigation/2025-05/court-lambasts-citation-of-fake-authorities-in-proceedings-and-orders-wasted-costs) (accessed 2026-10-17). A claim of "18 of 45 authorities fake" in Al-Haroun came from a low-quality site and is NOT verified.
- UK regulator: SRA authorised Garfield.Law (AI-driven small-claims debt firm, May 2025) with named solicitors accountable, client approval at each step, and a design that cannot propose case law (hallucination control) [REPORTED] (https://www.legalcheek.com/2025/05/sra-approves-ai-driven-law-firm/) (accessed 2026-10-17). I did not retrieve an SRA generative-AI guidance document; marked unknown.
- India:
  - Bombay High Court (Justice Milind Sathaye, 7 Jan 2026), Deepak Bahry v. Heart & Soul Entertainment: INR 50,000 costs on a litigant for citing a non-existent judgment in written submissions; court said AI use is fine if verified [REPORTED] (https://www.barandbench.com/amp/story/news/bombay-high-court-imposes-50000-costs-on-litigant-for-unverified-ai-generated-submissions) (accessed 2026-10-17).
  - Bombay HC (Oct 2025) quashed a Rs 22 crore tax notice that relied on three fake AI-generated judgments [REPORTED] (https://studycafe.in/bombay-high-court-quashes-rs-22-crore-tax-notice-based-on-fake-ai-generated-judgments-398529.html) (accessed 2026-10-17).
  - Supreme Court (27 Feb 2026, Narasimha and Aradhe JJ), suo motu on an Andhra Pradesh trial order relying on four fabricated judgments (Gummadi Usha Rani v. Sure Mallikarjuna Rao); said such reliance is misconduct, not mere error; notice to AG, SG, BCI; Shyam Divan amicus [REPORTED] (https://www.medianama.com/2026/03/223-supreme-court-ai-fake-case-laws-misconduct/) (accessed 2026-10-17).
  - Supreme Court (reported 2 July 2026, Pooja Ramesh Singh v. J&K Bank): "zero tolerance"; citing unverified AI judgments is advocate misconduct; BCI asked to frame norms; no sanction reported in that article [REPORTED] (https://www.barandbench.com/news/litigation/supreme-court-declares-zero-tolerance-to-citing-fake-ai-generated-judgments-asks-bci-to-frame-norms) (accessed 2026-10-17). Another source ties J&K Bank/NCLT fake citations to the same line; details across these Indian reports need checking against the orders.
  - No named Indian advocate sanction found. BCI norms status unknown.
- [INFERENCE] India is moving from warnings to misconduct framing; any citation feature must make verification structurally unavoidable.

---

## 3. Surveys, ethics opinions (design inputs)
- Clio 2025 Legal Trends Report: 79% of legal professionals report using AI in their firms, but use of legal-specific tools was reported at 40% (down from 58% in 2024), implying a drift to generic tools; broad adopters were ~3x as likely to report revenue growth [REPORTED, secondary; I did not open the report; 2024 baseline figures conflict across sources] (https://www.2civility.org/2025-clio-legal-trends-report/ ; https://www.canadianlawyermag.com/news/general/many-legal-clients-have-asked-artificial-intelligence-legal-questions-clio-report/393228) (accessed 2026-10-17).
- Other surveys quoted in the same coverage: ABA 2024 survey 30.2% of attorneys' offices using AI tools; Thomson Reuters 28% of law firms using GenAI. Definitions differ widely [REPORTED].
- Thomson Reuters Institute Future of Professionals 2026 and AI in Professional Services 2026 exist; I could not extract legal-specific percentages; the 2025 edition surveyed 2,275 professionals [REPORTED] (https://www.thomsonreuters.com/en/institute/sectors/innovation-and-technology) (accessed 2026-10-17). Unknown: headline legal figures.
- ABA Formal Opinion 512 (29 Jul 2024): applies existing Model Rules; lawyers need reasonable understanding of tool capabilities/limits; must verify output; confidentiality may require informed client consent before inputting client data; supervision, communication, candor; bill actual time, not more than actually spent [VERIFIED announcement; details REPORTED] (https://www.americanbar.org/news/abanews/aba-news-archives/2024/07/aba-issues-first-ethics-guidance-ai-tools/ ; https://www.lawnext.com/2024/07/in-first-ethics-ruling-on-gen-ai-aba-says-lawyers-must-have-reasonable-understanding-of-the-technology-but-need-not-become-experts.html) (accessed 2026-10-17).
- Design implications [INFERENCE]: (1) adoption is mostly ungoverned generic-tool use, so the wedge is "safer than ChatGPT, cheaper than Westlaw"; (2) confidentiality consent and data-handling transparency should be product features; (3) audit trail of what AI did supports supervision duties.

---

## 4. Lessons on memory/personalisation
- Harvey is the best documented legal implementation: explicit, confirm-before-save, visible, editable, deletable, cited when used, per-user scope, not trained on [VERIFIED] (https://www.harvey.ai/blog/memory-is-here-harvey-personalized) (accessed 2026-10-17). Shared/org memory is deferred, suggesting scope and permission questions are the hard part. [INFERENCE]
- Lexis Protege: personalisation (practice area, jurisdiction, style) plus DMS grounding, controlled by user/organisation; no documented memory store on the page I read [VERIFIED page] (accessed 2026-10-17).
- General assistants: PersistBench (arXiv, Feb 2026) evaluates cross-domain leakage and memory-induced sycophancy as failure modes of long-term memory [REPORTED, abstract-level] (https://arxiv.org/html/2602.01146v1) (accessed 2026-10-17). Secondary reports say major assistants enable memory by default and deletion controls are hard to audit, and mention memory-poisoning research; these were not verified against primary sources (https://aiweekly.co/alerts/wsj-flags-privacy-risks-in-ai-chatbot-memory) (accessed 2026-10-17). A "25x sycophancy" statistic seen in a blog is unverified; do not cite.
- Design principles [INFERENCE]: separate memory classes: (a) preferences/style, (b) matter facts (per-matter, never cross-client), (c) firm playbooks. Never let one client's facts leak into another matter (privilege/confidentiality). Make memory inspectable, editable, deletable, exportable. Prefer structured memory (typed fields tied to sources) over opaque summaries. Memory that stores legal propositions must carry citations and be re-verified, not trusted.

---

## 5. Summary table

| Vendor | Segment | AI core | Price signal (USD/seat/mo) | Confidence |
|---|---|---|---|---|
| Harvey | Big Law/in-house | Agents, memory, Word/Outlook | Not published; est. 1,000-2,000, 20+ seats | Low on price |
| CoCounsel/Westlaw | Mid-large | Deep Research, agents | Not published; est. 104-639 | Low |
| Lexis+/Protege | Mid-large | Personalised assistant, Word/Outlook | Not found | n/a |
| Clio | SMB PMS | Manage AI, Vincent, Work agents | EasyStart ~49; others quote | Medium-low |
| MyCase | SMB PMS | 8am IQ, MCP connector | 50-130 annual; 60-150 monthly | High (official) |
| Smokeball | SMB PMS | Archie add-on, Word/Outlook | Quote only | High on absence |
| PracticePanther | SMB PMS | none listed | 49-114 annual | High (official) |
| Filevine | PI/mid | Platform + acquisitions | Not found | n/a |
| Spellbook | Transactional | Word add-in, playbooks | Not published | High on absence |
| Legora | Firms/in-house | Collaborative agents | Not found | n/a |
| Eudia | In-house + ABS firm | Augmented services | n/a | n/a |
| Luminance | Contracts | Multi-model "panel of judges" | n/a | n/a |
| Paxton | Small/mid US | Research/drafting | 199-499 (conflicting) | Low |
| Supio | Plaintiff PI | Evidence analysis | Per-case, unpublished | Low |

---

## 6. Confidence & unknowns
- High: MyCase and PracticePanther prices, Smokeball plan structure, Harvey memory design, Stanford rates, Ayinde existence, Indian SC/Bombay HC actions as reported.
- Medium: Clio acquisition, funding for Harvey/Legora/Filevine (aggregators; figures conflict).
- Low: all enterprise prices (Harvey, CoCounsel, Paxton) are third-party estimates; Clio tiers beyond EasyStart.
- Not found or not checked: Lexis/Westlaw list prices; Clio official pricing (403); Spellbook funding; Clio 2024 Legal Trends figures; TR legal-specific survey numbers; SRA's own AI guidance; BCI norms status; Delhi HC AI cases; Adalat AI/Nyay/Manupatra AI; whether Indian court filings tools (e-Courts/eCourts services API) are accessible; Eudia 2026 and Luminance 2026 funding.
- Search tool is US-only and returns summaries; secondary claims weren't always re-opened.

---

## 7. Lessons for an India-first bootstrapped product
1. Price anchor: Western SMB PMS seats are USD 49-150/month and AI adds more; enterprise legal AI is USD hundreds to 1,000+. [INFERENCE] A Gen Z Indian lawyer cannot pay that; target a few hundred INR to low thousands per month, so keep model cost per user low (retrieval over a user's own files, small models for routine tasks, expensive models only on demand).
2. The moat in incumbents is licensed content and a citator (Westlaw, Lexis, vLex, Manupatra via Legora). For a bootstrapper, do not compete on research content; do case tracking, hearings/cause lists, drafting and the lawyer's own knowledge base first, and integrate public judgments (official sources) with citations plus link-outs.
3. Verification is the product: Stanford 17-34% error rates, 1,500+ global sanction cases, and Indian SC "zero tolerance/misconduct" language mean every authority must be resolved to a source document before it can enter a draft; show "unverified" flags; never output a citation not found in the index; log what the AI produced for supervision.
4. Memory as differentiator, copying Harvey's discipline: confirm-before-save, visible, editable, deletable, cited, per-user, never trained on; matter-scoped facts isolated per client; no cross-matter leakage; later shared firm memory (a hard problem even for Harvey).
5. Word and Outlook are the center of drafting worldwide (Spellbook, Smokeball, Harvey, Lexis, Filevine's Pincites buy). In India add WhatsApp, Gmail and PDF/scan handling, which Western vendors ignore. [INFERENCE]
6. Generic-tool drift (Clio: legal-specific use 40% vs 79% overall AI) means free ChatGPT is the real competitor; win on workflow (hearing dates, deadlines, templates in Indian court formats, vernacular) and safety, not raw chat.
7. Segment gap: Harvey and Legora are in Indian top-tier firms; the solo/junior/district-court segment appears unserved by global vendors. [INFERENCE]
8. Compliance: build a confidentiality posture early (no training on client data, Indian data residency options, DPDP Act alignment: not researched here), because ABA 512-style duties and BCI norms are likely to demand it; CRM/advertising later must respect Bar Council advertising restrictions (not researched here; verify).
9. Avoid ABS/services hybrids (Eudia model) in India; stay a pure software tool. [INFERENCE, verify legally]
10. Partnerships: PMS vendors license content (Smokeball-Westlaw, Legora-Manupatra); a bootstrapped player could seek data partnerships or use open court data rather than building content.
