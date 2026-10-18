# Indian practice management, case-diary and AI legal-tech landscape

Research date: 2026-10-17. Tags: [VERIFIED] = official/primary page; [REPORTED] = press, secondary, directory, reviews or competitor pages; [INFERENCE] = my reasoning.
Every source below was accessed 2026-10-17. Caveat: web search/fetch here returned summarised page text. Several Play Store pages could not be read (truncated or 404), so install counts are mostly unavailable.

---

## 1. Data plumbing: how these apps get case status and cause lists

**Official portal (eCourts Services).**
- The public portal offers CNR search (16-character alphanumeric CNR), Case Status, Court Orders, Cause List, Caveat Search, Process Details and a court-complex locator. Searches require an image captcha, with an audio captcha as an alternative. The page does not mention any API. [VERIFIED] https://services.ecourts.gov.in/ecourtindia_v6/ (accessed 2026-10-17)
- The official eCourts Services mobile app (NIC, under the e-Committee of the Supreme Court) lets users search by case number, party or advocate name, and keep a "My Cases" list. [VERIFIED] https://apps.apple.com/in/app/id1260905816 (accessed 2026-10-17)
- The app also exists on Google Play and the App Store, linked from the portal. The portal's store links were placeholders, so I could not confirm the Play URL. [VERIFIED] https://services.ecourts.gov.in/ecourtindia_v6/ (accessed 2026-10-17)

**Official API: none for the public.**
- A Python SDK maintainer states "there's no official API" and drives the public portals directly. [REPORTED] https://pypi.org/project/bharat-courts/0.3.1/ (accessed 2026-10-17)
- Open APIs have been described only for Central and State Government departments, using a departmental ID and access key under the National Data Sharing and Accessibility Policy. [REPORTED] (search-result summary of an eCourts progress note) https://en.vikaspedia.in/viewcontent/e-governance/online-legal-services/indian-courts-and-e-governance-initiative (accessed 2026-10-17)
- Phase III of eCourts was approved at Rs 7,210 crore over four years from 2023. I found no public bulk-data or API specification for it. [REPORTED] https://www.impriindia.com/?p=75293 (accessed 2026-10-17)

**How commercial tools work around it.**
- Open-source SDK `bharat-courts` (MIT):
  - It uses session cookies plus AJAX POSTs against the High Court portal.
  - It handles rotating tokens and parses HTML for district courts.
  - It solves captchas with OCR. The page quotes about 75% accuracy on the judgments portal. Manual solving is also supported.
  - Its default live rate limit is a 1.0 s delay between requests. [REPORTED] https://pypi.org/project/bharat-courts/0.3.1/ (accessed 2026-10-17)
- Apify actors advertise eCourts scraping with captcha bypass, OCR and proxy support. [REPORTED] https://apify.com/codingfrontend/ecourts-case-scraper (accessed 2026-10-17)
- Surepass sells a "CNR Search API" (input: CNR; output: parties, advocates, acts, history, orders). It does not name its data source, gives no price, and claims "100% accurate data". Its page does not address consent or lawful purpose. [REPORTED] https://surepass.io/ecourt-cnr-search-api/ (accessed 2026-10-17)
- eCourtsIndia is described as offering a developer API plus an MCP server, with 27.9 crore+ court records. Pricing is unlisted. Capterra shows "$200 starting, usage-based" with 0 reviews. [REPORTED] https://yourstory.com/companies/ecourts-india and https://www.capterra.com/p/10049317/eCourtsIndia/ (accessed 2026-10-17)
- Open datasets: Dattam Labs publishes Indian High Court judgments (25 courts, quarterly updates) and Supreme Court judgments (1950-2025, bi-monthly) on the AWS Open Data registry under CC-BY-4.0. The datasets are built from the eCourts website. [REPORTED] https://registry.opendata.aws/indian-high-court-judgments/ and https://registry.opendata.aws/indian-supreme-court-judgments/ (accessed 2026-10-17)
  - The SDK page says the archive lags real judgments by 2-3 months. [REPORTED] https://pypi.org/project/bharat-courts/0.3.1/ (accessed 2026-10-17)
- Indian Kanoon API (judgment text, not live case status):
  - Prepaid, per request: search Rs 0.50, document Rs 0.20, fragment Rs 0.05, metadata Rs 0.02. Rs 500 free credit at signup. Non-commercial use may get Rs 10,000 free per month after verification. The page may be dated. [REPORTED] https://indiankanoon.org/members/pricing (accessed 2026-10-17)
  - The terms require a clear "powered by IKanoon" attribution and logo. They do not address caching, redistribution or scraping in detail. [VERIFIED] https://api.indiankanoon.org/terms/ (accessed 2026-10-17)

**Legal issues around scraping.**
- I found no Indian court order, and no statement from eCourts or any High Court, specifically on scraping eCourts. The content of the portal's Disclaimer, Copyright and Hyperlinking policies was not retrievable. This is a gap, not a clearance. [VERIFIED for the portal's page list] https://services.ecourts.gov.in/ecourtindia_v6/ (accessed 2026-10-17)
- General Indian analysis says the legal position on scraping is unclear:
  - DPDPA 2023 contains an exemption for personal data "made publicly available", but the term is undefined.
  - Scraping may also run into the privacy policies and terms of target sites. [REPORTED] https://ssrana.in/articles/data-scraping-issues-india/ and https://www.mondaq.com/india/copyright/900156/data-scraping-and-legal-issues-in-india (accessed 2026-10-17)
- Academic researchers openly scrape eCourts with Selenium, so the practice is widespread. [REPORTED] https://ieee-dataport.org/authors/vartul-shrivastava (accessed 2026-10-17)
- [INFERENCE] Party names and case details in eCourts records are personal data. A product that stores and re-serves them to third parties carries more risk than a lawyer tracking their own cases. For a low-cost OS, the safer design is: user-initiated lookups or user-pasted CNRs, polite rate limits, and no bulk republishing. Also consider a licensed provider or the official apps as a fallback. Get a lawyer's opinion before building bulk crawlers.
- [INFERENCE] Captcha-solving automation against a government portal is the part most likely to be treated as circumvention. It is also the most fragile part, since the portal can change captcha or tokens at any time.

---

## 2. Product-by-product

### 2.1 eCourts Services app (official, NIC)
- **Segment:** all litigants, advocates and the public. Free, government. [VERIFIED] https://apps.apple.com/in/app/id1260905816 (accessed 2026-10-17)
- **Features:** case status, cause lists, orders, "My Cases" with backup/restore. [VERIFIED] same source.
- **AI:** none seen.
- **Platforms:** Android and iOS.
- **Ratings:** iOS 2.4/5 from about 2.4k ratings. An earlier search snippet showed 2.9 from about 1.4k, so the rating is falling. Google Play rating and installs not retrievable. A launch-time Bar & Bench report cited 22,000+ downloads for the district-court app. [VERIFIED/REPORTED] https://apps.apple.com/in/app/id1260905816 and https://www.barandbench.com/news/ecourts-services-app-district-taluka-courts (accessed 2026-10-17)
- **Review complaints (App Store, roughly late May to early July):**
  - The calendar view hangs for hours.
  - Saved cases disappear after an update.
  - Google Drive restore fails with "file not found", or restores only district-court cases.
  - Copying case numbers and party details from cause lists was removed.
  - Offline access was removed.
  - Users ask for a rollback. [REPORTED] https://apps.apple.com/in/app/id1260905816 (accessed 2026-10-17)
- **Strengths:** authoritative source and free.
- **Weaknesses:** unstable, no billing, drafting, clients or deadlines.
- **Gap for juniors:** a diary-grade UX (multi-court, offline, export, clean cause-list copy) is exactly what users are asking for.

### 2.2 Provakil (PVKL Tech Services Pvt Ltd, Pune)
- **Segment:** individual advocates, chambers, law firms, plus banks/NBFCs and enterprise legal and CLM. [VERIFIED] https://provakil.com/advocates (accessed 2026-10-17)
- **Features:**
  - Alerts on listings, orders and judgments; daily cause lists by email and WhatsApp.
  - New-case-against-client alerts and keyword/conflict search.
  - Timelines, notes and labels; timesheets and invoices.
  - Automatic client updates by SMS/email; document repository and task assignment.
  - Integrations with MS Word, Google Drive, M365, Zoho, SAP, Salesforce and others. [VERIFIED] same source.
- **Coverage claims:** "19,000+ forums" on the advocates page. The App Store listing says all High Courts, district courts, consumer forums and tribunals. [VERIFIED/REPORTED] https://provakil.com/advocates and https://apps.apple.com/mx/app/provakil/id1111933293 (accessed 2026-10-17)
- **AI:** the advocates page mentions AI-powered litigation management. AI Contract Intelligence (risk detection, summaries, obligations) and an AI CLM product are described on separate pages. How the AI works is not explained. [VERIFIED] https://provakil.com/advocates (accessed 2026-10-17)
- **Pricing:** not published. Free trial and "Book a Demo". The iOS app is free with in-app purchases. [VERIFIED/REPORTED] same sources.
- **Platforms:** Android and iOS plus web. [VERIFIED] https://provakil.com/advocates (accessed 2026-10-17)
- **Funding:** I could not find funding information. [UNKNOWN]
- **Reviews:** G2 "High Performer" (vendor-promoted). Reviewers cite delayed updates and glitches, and slow support. Another source notes dependence on eCourts for update delays. These are quoted on a competitor's comparison page, so weak evidence. [REPORTED] https://provakil.com/casestudy/can-legal-technology-really-transform-a-top-law-firm and https://wp-cdn.volody.com/?p=7837 (accessed 2026-10-17)
- **Strengths:** broadest coverage claim, WhatsApp cause lists, billing included.
- **Weaknesses:** demo-gated pricing, enterprise orientation.
- **Gap:** no visible self-serve low-price tier for juniors. [INFERENCE]

### 2.3 MyKase (Manupatra)
- **Segment:** independent lawyers, law firms, corporate legal teams. [VERIFIED] https://www.mykase.in (accessed 2026-10-17)
- **Features:** matter management dashboard; litigation tracking "across 10,000+ Indian courts"; IPR management; proactive new-filing alerts; notice management; knowledge management. Cloud-based, with encryption and role-based access. [VERIFIED] same source.
- **AI:** none stated on the page.
- **Pricing:** not on the page ("Price on Request" on directories). [VERIFIED/REPORTED] https://www.mykase.in and https://techjockey.com/category/law-firm-software/cloud (accessed 2026-10-17)
- **Strengths:** brand backed by a legal database company.
- **Weaknesses:** sales-led, no visible solo-friendly pricing.

### 2.4 Legodesk
- **Segment:** debt collection and recovery at banks, NBFCs, fintechs and ARCs. [VERIFIED] https://www.legodesk.com (accessed 2026-10-17)
- **Features:** bulk notice automation (SARFAESI, S.138, arbitration) from LMS data with RPAD tracking; case tracking across "19,000+ courts"; a network of 5,000+ advocates; MIS dashboards. [VERIFIED] same source.
- **Pricing:** none public. Self-reported results are marketing.
- **Relevance:** a corporate matter-flow product that sends work to advocates. For juniors it is a possible work source, not a competitor. [INFERENCE]

### 2.5 Legistify (LegisTrak)
- **Segment:** enterprise legal operations (contracts, matters, IP). Claims 300+ large enterprise customers. [REPORTED] https://inc42.com/buzz/legistify-raises-funding (accessed 2026-10-17)
- **Funding:** $4M Series A in September 2023, with Indiamart, Titan VC and GSF; over $5M total. No later round found. [REPORTED] https://india.entrepreneur.com/news-and-trends/legistify-raises-4-million-in-series-a-funding/459609 (accessed 2026-10-17)
- **Pricing:** not found. [UNKNOWN]

### 2.6 SpotDraft (CLM)
- **Segment:** in-house legal teams, mostly mid-market and growth-stage companies. [VERIFIED] https://www.spotdraft.com/pricing (accessed 2026-10-17)
- **Features:** AI contract repository extracting 1,000+ metadata types; redlining; e-sign; clickwrap. Implementation included. [VERIFIED/REPORTED] same source and https://pulse2.com/spotdraft-54-million-series-b/amp/ (accessed 2026-10-17)
- **Pricing:** by users or contract volume, no figures published. [VERIFIED] https://www.spotdraft.com/pricing
- **Funding:** $54M Series B (Feb 2025; Vertex Growth, Trident), $26M Series A (Mar 2023), 250+ employees. [REPORTED] https://pulse2.com/spotdraft-54-million-series-b/amp/ (accessed 2026-10-17)
- **Gap:** not a litigation or solo product. Irrelevant to a junior advocate's diary needs. [INFERENCE]

### 2.7 Lucio
- **Segment:** law firms, in-house teams, researchers. Products: Assistant, Word add-in, Outlook add-in. [VERIFIED] https://www.lucioai.com (accessed 2026-10-17)
- **Features:** research across law, a firm's own documents and knowledge; document review; drafting and redlines; integrations with Dropbox, SharePoint, OneDrive, NetDocuments. Outputs have source citations. [VERIFIED] same source.
- **Security claims:** no training on customer data; SOC 2 Type II, ISO 27001:2022, GDPR. [VERIFIED claim by vendor] same source.
- **Pricing:** that page lists $149/user/month with no minimum seats. WARNING: a search summary said the Indian Lucio is custom/enterprise-priced and that a $149 figure on Slashdot belongs to a different US "Lucio AI". The domain lucioai.com may not be the Bengaluru company. Treat the price as unconfirmed for the Indian company. [VERIFIED page / UNRESOLVED identity] https://www.lucioai.com and https://slashdot.org/software/p/Lucio-AI/ (accessed 2026-10-17)
- **Funding (Indian Lucio):** $5M seed led by DeVC (founded 2022, Bengaluru). Company claims 200+ organisations, 3,000+ lawyers and 9 jurisdictions. [REPORTED] https://www.barandbench.com/dealstreet/lucio-raises-5m-to-build-ai-native-workspace-for-lawyers and https://entrackr.com/snippets/legal-tech-startup-lucio-raises-5-mn-led-by-devc-10536460 (accessed 2026-10-17)
- **Gap:** Word/Outlook-centric and USD- or enterprise-priced. No diary, hearing or billing for a solo. [INFERENCE]

### 2.8 Jhana.ai
- **Segment:** Indian lawyers and firms (AI paralegal). Founded 2021 at Harvard. [REPORTED] https://barandbench.com/amp/story/news/three-harvard-graduates-jhana-ai-lawyers-in-india (accessed 2026-10-17)
- **Funding:** $1.6M seed led by Together Fund (Sept 2024). The company claims a database of 15M+ legal documents. [REPORTED] https://entrackr.com/2024/09/ai-paralegal-startup-jhana-raises-1-6-mn-in-seed-round (accessed 2026-10-17)
- **Pricing:** conflicting. Preqin lists Free; Basic Rs 3,300/month; Pro Rs 5,000/month; Enterprise from Rs 54,000/month for 15 users. Two comparison sites say prices are not published. Treat the INR figures as unverified. [REPORTED] https://www.preqin.com/data/profile/asset/jhana-labs-private-limited-/705294 and https://vaquill.ai/alternative/jhana (accessed 2026-10-17)
- **Note:** my fetch of jhana.ai returned content describing a different entity, so I could not verify the vendor's own page. [UNKNOWN]
- **Gap:** research and drafting, not case ops. [INFERENCE]

### 2.9 CaseMine (AMICUS)
- **Segment:** lawyers, plus free credits for students (10 credits/month), prosecutors and judges (50). [VERIFIED] https://www.casemine.com/pricing (accessed 2026-10-17)
- **Pricing (INR, own page):**
  - Essential: Rs 12,999/year or Rs 1,399/month auto-pay. AI search, no AMICUS credits.
  - AI Pro: Rs 29,999/year or Rs 2,999/month. 250 AMICUS credits/month, CaseIQ, 50 MB uploads.
  - AI Premium: Rs 41,999/year or Rs 3,999/month. 500 credits/month, web search, 100 MB uploads, US/UK/Ireland cases.
  - Struck-through list prices show discounts. [VERIFIED] https://www.casemine.com/pricing (accessed 2026-10-17)
- **AI mechanism:** credit-metered generative features on top of a judgment corpus with citation tools. Internals not published. [INFERENCE]
- **Gap:** research priced for firms. A credit model is a useful pricing reference. A student tier exists but no early-career advocate tier. [INFERENCE]

### 2.10 Supreme Today AI
- **Segment:** legal professionals and law firms. Web plus Android/iOS app. [VERIFIED] https://www.supremetoday.ai (accessed 2026-10-17)
- **Features:** AI research, case law and statutes, drafting aids, summaries and citations, saved history, court news. [VERIFIED] same source.
- **Pricing:** not on the landing page ("Packages" link). [VERIFIED] same source.

### 2.11 Draft Bot Pro and other AI drafting tools
- Draft Bot Pro: AI drafting and research app. Built by Delhi-based Rare Labs per a vendor-written blog. Claims 1,02,000 users. Drafts from uploaded reference PDFs plus a typed request using a multi-step "agentic" flow. "#1" claim is self-described. Pricing not found. [REPORTED] https://desikaanoon.in/why-indian-lawyers-are-turning-to-specialized-legal-ai-for-verifiable-drafting-and-research/ and https://thedailyworkflow.com/compare/draft-bot-pro---%231-accurate-legal-ai-for-indian-lawyers-vs-contract-aura (accessed 2026-10-17)
- NyayAssist (research, drafting, case management) is listed in a directory. [REPORTED] https://www.legaltechnologyhub.com/vendors/nyayassist/ (accessed 2026-10-17)
- NyayGPT and Kanoon Mitra: I found no credible sources. [UNKNOWN]

### 2.12 Adalat AI (court-side)
- **Segment:** courts and judges, not advocates. Nonprofit offering speech recognition and transcription in Indian languages, case management and paperless workflows. [REPORTED] https://www.barandbench.com/news/law-policy/legal-tech-nonprofit-adalat-ai-joins-y-combinator (accessed 2026-10-17)
- **Scale:** over 6,000 courtrooms in 11 states. Selected for Y Combinator Fall 2026 (announced 22 Aug 2026). [REPORTED] same source.
- **Funding:** CB Insights lists about $340K at grant stage, undated and unverified. [REPORTED] https://www.cbinsights.com/company/adalat-ai/ (accessed 2026-10-17)
- **Relevance:** it improves digitised orders and transcripts at the source, which may later improve case-data quality. [INFERENCE]

### 2.13 LawRato, Vakilsearch, LegalKart
- LawRato: lawyer-discovery marketplace; lawyers set fees; the platform takes a charge. Data is mostly from 2016. A 2026 Stanford CodeX entry lists transaction fees, services and advertising. [REPORTED] https://yourstory.com/2016/02/lawrato and https://techindex.law.stanford.edu/companies/16257 (accessed 2026-10-17)
- Vakilsearch: business-compliance and documentation services, funded by Kalaari. [REPORTED] https://yourstory.com/2016/04/legal-startups (accessed 2026-10-17)
- LegalKart: no data found. [UNKNOWN]
- [INFERENCE] These are client-acquisition channels, not practice-management tools. Their lead model is a possible integration or competitive reference for "client intake".

### 2.14 Play Store case-diary long tail
A Play search for "advocate diary" returned (ratings as displayed; downloads not shown): [REPORTED] https://play.google.com/store/search?q=advocate%20diary&c=apps&hl=en_IN (accessed 2026-10-17)
| App | Developer | Rating |
|---|---|---|
| Advocate Diary - AdvoDesk | V2s Dev | 3.9 |
| Lawyer Diary & Handbook | Eclipticon | 4.0 |
| Lawyer Case Diary | Brand Raptor | 4.2 |
| Lawyer Diary & Case Management | SHT Software | 4.8 |
| Lawyers Diary Pro | FrontierX | 4.5 |
| LD - Lawyer Diary | LD Solutions Diary | 4.2 |
| Lawyer Diary: Case Management | Generation Next | 3.0 |
Others (Digital Lawyer Diary, My Lawyer Diary, Court Diary, CourtBoard, AdvocatePro and more) showed no rating.

- Another "Advocate Diary" app (package com.aswdc_advocatediary) shows 10,000+ installs on a mirror, last updated Aug 2024. It covers parties, lawyers, judges and hearings, with no cause-list feature seen. [REPORTED] https://apkcombo.com/advocate-diary/com.aswdc_advocatediary/ (accessed 2026-10-17)
- Directory prices (weak evidence): Advocates Diary about Rs 400/month (annual) or $4/month; Legal XGen Rs 2,000/month; another "Advocate Diary" Rs 4,800/year; Indian Mesh Rs 10,000/year. [REPORTED] https://technologycounter.com/products/advocates-diary and https://techjockey.com/industry/legal (accessed 2026-10-17)
- Official court apps also include a case diary: Delhi High Court's app has a personal case diary, and Rajasthan HC's app has "My Diary". [REPORTED] https://indialegallive.com/constitutional-law-news/courts-news/delhi-high-court-launches-mobile-application/ and https://hcraj.nic.in/hcraj/androidhelp.html (accessed 2026-10-17)
- [INFERENCE] The tail is crowded with undifferentiated single-developer apps. Review texts for them could not be retrieved. Likely complaint categories (ads, no sync, no cause-list import) are unverified here.

---

## 3. AI risk context relevant to product design
- In 2026 the Supreme Court set aside an NCLT judgment resting on non-existent AI-generated precedents (Pooja Ramesh Singh v. J&K Bank, 2026 INSC 668). Reports say it treated unverified fake citations as advocate misconduct and told the Bar Council of India to frame AI-use guidelines and disciplinary measures. Dates and details differ between sources, so check the judgment. [REPORTED] https://moneylife.in/article/supreme-court-sets-aside-nclt-judgement-for-relying-on-hallucinated-aigenerated-citations/80952.html and https://www.freepressjournal.in/amp/mumbai/ai-generated-fake-judgments-under-fire-as-supreme-court-bombay-hc-warn-lawyers (accessed 2026-10-17)
- [INFERENCE] Citation-linked, verifiable output and a visible "verify before filing" step are product requirements, not extras. Lucio already markets source citations.

---

## 4. Cross-cutting findings and gaps for young solo/junior advocates [INFERENCE unless cited]
1. Pricing opacity: the case-ops vendors (Provakil, MyKase, Legodesk, Legistify, SpotDraft) publish no prices. The only public INR price points are CaseMine (Rs 1,399-3,999/month), Jhana (unverified Rs 3,300-5,000/month) and directory-listed diaries (Rs 400/month-ish). A transparent Rs 300-1,000/month tier looks unoccupied, but verify demand.
2. The official app is the reference for data but has declining ratings and trust issues (lost saved cases, removed offline mode).
3. Nobody visibly combines diary, cause-list, drafting memory, billing and client intake at solo price.
4. Lawyer-specific AI memory (style, past drafts, client facts) is not advertised by any product found. Lucio mentions "personalization" in its funding plans. [REPORTED] https://inc42.com/buzz/ai-powered-legal-tech-startup-lucio-raises-5-mn (accessed 2026-10-17)
5. The data layer is the main risk: no official API, a captcha-gated portal, and unclear legal status of automated access. Prefer user-initiated sync and licensed or official channels. Do not build the business on an uncontracted scraper.
6. Verification-first AI is the compliance posture the courts are signalling.

---

## 5. Confidence & unknowns
- High confidence: eCourts portal features and captcha; absence of a public official API (stated by SDK maintainers and a competitor, not by eCourts itself); CaseMine INR pricing (own page); Lucio and SpotDraft funding (multiple outlets); Provakil's feature list (vendor page).
- Medium: Jhana pricing (conflicting); Adalat AI scale (press summary); Play ratings (single search page).
- Unknown or unverified:
  - Google Play install counts and ratings for eCourts, Provakil and most diary apps. The Play pages did not load.
  - Pricing for Provakil, MyKase, Legodesk, Legistify, SpotDraft, SupremeToday, Draft Bot Pro and LegalKart.
  - Whether lucioai.com is the Indian Lucio (the $149 figure may belong to a different company).
  - Jhana's own pricing page (fetch returned unrelated content).
  - Provakil funding.
  - NyayGPT, Kanoon Mitra, LawPro, Casedekho, TrialDesk: no credible sources found.
  - The text of eCourts' Disclaimer and Terms regarding automated access, and any court ruling on scraping eCourts.
  - Per-app review complaints for the Play diary long tail (ads, sync); only the official app's complaints were retrieved.
- Several claims came through search-result summaries rather than full page reads. Re-check key prices before using them in a business case.

## 6. Summary table
| Product | Segment | Price (INR) | AI | Platforms | Funding | Note |
|---|---|---|---|---|---|---|
| eCourts Services (NIC) | All users | Free | None | Android, iOS | Govt | iOS 2.4/5; sync and restore complaints |
| Provakil | Advocates to enterprise | Not published; trial | Yes, unspecified | Android, iOS, web | Unknown | Claims 19,000+ forums; delayed-update complaints on G2 |
| MyKase (Manupatra) | Solo to corporate | Not published | None stated | Web (cloud) | Corporate | 10,000+ courts claim |
| Legodesk | Collections/NBFC | Not published | Not stated | Web | Unknown | Notice automation; advocate network |
| Legistify | Enterprise legal ops | Not found | Not stated | Web | $4M Series A (2023) | 300+ enterprise claim |
| SpotDraft | In-house CLM | Quote-based | Yes, metadata extraction | Web | $54M Series B (2025) | Not litigation |
| Lucio | Firms, in-house | Unconfirmed ($149/user/month on lucioai.com) | Research, review, drafting | Web, Word, Outlook | $5M seed | Identity of price page unresolved |
| Jhana | Lawyers | Unverified Rs 3,300-5,000/mo | AI paralegal | Web | $1.6M seed (2024) | Conflicting price sources |
| CaseMine | Lawyers, students | Rs 1,399-3,999/mo or Rs 12,999-41,999/yr | AMICUS credits | Web | Not checked | Own price page |
| Supreme Today AI | Lawyers, firms | Not on landing page | Research, drafting | Web, Android, iOS | Not checked | -- |
| Draft Bot Pro | Lawyers, students | Not found | Agentic drafting | App | Not found | Self-reported 1.02 lakh users |
| Adalat AI | Courts | n/a (nonprofit) | Speech, transcription | Court systems | Grants; YC F26 | 6,000+ courtrooms |
| Play diary apps | Solo advocates | About Rs 400/mo to Rs 4,800/yr (directories) | Mostly none | Android | Indie | Ratings 3.0-4.8 |
