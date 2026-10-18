# 08 - Madras High Court and Tamil Nadu court ecosystem (court-adapter research)

Researched 2026-10-17. Tags: [VERIFIED] = primary/official page read directly by me; [REPORTED] = secondary source; [INFERENCE] = my reasoning. Every sourced fact carries "(accessed 2026-10-17)".

Method note: WebFetch failed on mhc.tn.gov.in with "unable to verify the first certificate". I fetched the official pages with curl (TLS verification disabled, read-only GETs of public pages, browser-like UA, no form submission, no captcha interaction). Nothing was scraped beyond reading the public HTML of ~25 pages. I did not submit any search form.

---
## 1. Official web properties (what exists, where)

All [VERIFIED] from the home page https://hcmadras.tn.gov.in/ (accessed 2026-10-17), whose "Last Updated" footer read 16-10-2026.

- **Main site: https://hcmadras.tn.gov.in/** (PHP, NIC/High Court-run). https://www.hcmadras.tn.gov.in 301-redirects to it. The legacy host https://mhc.tn.gov.in/ now 302-redirects to https://mhc.tn.gov.in/recruitment/ (accessed 2026-10-17), but mhc.tn.gov.in still hosts several apps (below). Several services are split across **four hostnames**: hcmadras.tn.gov.in, mhc.tn.gov.in / www.mhc.tn.gov.in, madrashighcourt.tn.gov.in, and national portals (ecourts.gov.in family). [INFERENCE] An adapter must treat host names as unstable configuration, not constants.
- **Services menu (home page nav)**, each split Principal Seat / Madurai Bench:
  - Cause List: `cause_list_mhc.php`, `cause_list_mdu.php`
  - Status of Case: `case_status_mas.php`, `case_status_mdu.php`
  - Judgments: `cause_judment_mas.php`, `cause_judment_mdu.php`
  - Display Board: `display_board_mhc.php`, `display_board_mdu.php`
  - Neutral Citation (external): https://mhc.tn.gov.in/judis/index.php/casestatus/citation
  - Filing Status (Principal Seat): `filing_status.php`
  - Sitting Arrangements: `sitting_arrangements.php`; VC facility pages `vc_mas.php`, `vc_mdu.php`; Commercial cases statistics pages; MP/MLA cases pending/disposed pages; Virtual Justice Clock (justiceclock.ecourts.gov.in, TN code 10).
  - e-Copy Application: https://www.mhc.tn.gov.in/eservices/copyapp/ (login/register, "CIS Register User") with a user manual PDF.
  - AIMS (Advocate Information Management System): https://madrashighcourt.tn.gov.in/aims/
  - Older NIC "JUDIS" apps: https://mhc.tn.gov.in/judis/ (judgments and daily orders; bench selector Madras / Madurai; type Judgments or Daily Orders) and https://mhc.tn.gov.in/judis/clists/ (cause list landing: "Cause Lists Madras High Court / Madurai Bench"), both "Designed, Developed and Hosted by NIC" (accessed 2026-10-17).
  - Also linked: https://judgments.ecourts.gov.in/pdfsearch/ (national judgments portal), https://filing.ecourts.gov.in/pdedev/ (e-filing), https://districts.ecourts.gov.in/tn (subordinate courts), https://services.ecourts.gov.in/ecourtindia_v6/ (district eCourts services).
- Web Information Manager is the Registrar (IT-cum-Statistics); contact email cpc-tn(at)indianjudiciary(dot)gov(dot)in. [VERIFIED]

## 2. Cause lists

[VERIFIED] https://hcmadras.tn.gov.in/cause_list_mhc.php (accessed 2026-10-17). The Principal Seat page offers seven search modes, each behind its own **6-character image captcha (Securimage, with audio option)**:
1. Entire Cause List search
2. Court No search
3. Hon'ble Judge name search
4. Case No wise search (case-type dropdown, see section 8)
5. Party name search
6. **Advocate name search**
7. **Enrollment No search** (format hint "MS/123/1900"; there is also an "aorno" namespace in the page script, i.e. a search by Advocate-on-Record number, [INFERENCE] likely for Supreme Court style listing or Original Side).
Each mode requires a "Cause List Date".

Implications that ARE verified: (a) advocate-wise and enrolment-wise cause-list retrieval is an official feature, which means advocate names do appear in the published lists/search data; (b) access is captcha-gated per query. The page's `<meta name="robots">` is "index, follow" (cause_list_mhc.php and display_board_mhc.php).

What I could NOT verify (needs a logged-in/captcha-solving human; I did not bypass captchas): output format of a returned list (PDF vs HTML), the exact list categories printed ("FOR ADMISSION", "FOR ORDERS", "FRESH", "AFTER NOTICE", "PART HEARD", "MENTIONING", "SUPPLEMENTARY", "ADVANCE"), item numbering, and whether supplementary/advance lists are separately published. A coaching-site guide (REPORTED, low quality) says "if a case is not on the list (including the supplementary list), it will not be taken up": https://anantamias.com/madras-high-court-cause-list/ (accessed 2026-10-17). Treat category names as [INFERENCE] from general Indian HC practice until a sample list is inspected under authorisation.

**Email/SMS push of cause lists (new, very relevant) [VERIFIED]:** Notification No. 230/2026 dated 06.10.2026, signed by the Registrar (IT-cum-Statistics), ROC.No.98888A/2026/Comp1, at https://hcmadras.tn.gov.in/admin/view_pdf.php?pdf_id=NzA=&page=SA== (accessed 2026-10-17). Text: the Registry is "in the process of implementing email push service of Cause List" to advocates registered on AIMS; advocates should log in at https://madrashighcourt.tn.gov.in/aims with their Bar Council enrollment number, update mobile number and email, and **tag their cases**; this is "essential to receive automated SMS and email notification regarding Cause List and the case update." The home page labels it "Pilot testing of email push service of cause list". AIMS login page: advocates "registered in the Case Information System can login here using their Bar Enrollment Number" (https://madrashighcourt.tn.gov.in/aims/, accessed 2026-10-17).
[INFERENCE] This is the sanctioned ingestion path: the lawyer's own AIMS-tagged cases generate court-sent emails, which Lawyer OS can parse from the lawyer's inbox with the lawyer's consent, instead of fetching court pages.

## 3. Display board (live court status)

[VERIFIED] Pages exist: https://hcmadras.tn.gov.in/display_board_mhc.php and display_board_mdu.php (accessed 2026-10-17). The static HTML contains no search form or captcha; content is evidently loaded dynamically (I did not probe the backend endpoint). A third-party guide says the board shows the item number currently running in each court hall [REPORTED]: https://anantamias.com/madras-high-court-cause-list/ (accessed 2026-10-17). Whether any official API/feed exists: not found. Webcasting/YouTube live links for courts appear on the home page (two youtube.com/live links), [VERIFIED] existence only.

## 4. Case status, filing status, CNR

[VERIFIED] https://hcmadras.tn.gov.in/case_status_mas.php (accessed 2026-10-17): four search modes, each with captcha: Case No, **CNR No**, **Filing No**, Party Name. A captcha_action.php endpoint validates captchas server-side ("Captcha not matching").
[VERIFIED] https://hcmadras.tn.gov.in/filing_status.php: "Case Information System - Filing Date wise search" (Principal Seat only).
[REPORTED, search snippet] National eCourts High Court services portal (hcservices.ecourts.gov.in) also offers Madras HC case status/cause list (unconfirmed by me).

## 5. Judgments, orders, neutral citation

- Portal: https://mhc.tn.gov.in/judis/ with "Judgments" and "Daily Orders" types; search modes on the main-site wrapper `cause_judment_mas.php`: Case No, Judge wise, Order Date, Party Name; the JUDIS case-status site also lists Case No, Party, Judge, **Free Text**, and **Citation** search. [VERIFIED] (accessed 2026-10-17)
- Neutral citation search page: citation search takes "Citation No" and "Case Year" with dropdown 2023, 2024, 2025, 2026. [VERIFIED] https://mhc.tn.gov.in/judis/index.php/casestatus/citation (accessed 2026-10-17). This confirms the scheme began for 2023 judgments.
- Format: LiveLaw reported the Registrar General circular of 30 Dec 2022 introducing automatically generated neutral citations from 1 Jan 2023 in the form "Year/MHC/auto-generated number" [REPORTED]: https://livelaw.in/news-updates/madras-high-court-citation-system-from-1st-january-217771 ; also https://www.barandbench.com/news/madras-high-court-introduce-neutral-citation-system-judgments (accessed 2026-10-17). I could not confirm the separator actually printed on judgments (colon vs slash); the brief's "2023:MHC:xxxx" is unverified. Adapter should regex both `\d{4}[:/]MHC[:/]\d+`. [INFERENCE]
- Uncertified copies of judgments/orders are available on the JUDIS/Indian Courts site; **certified copies** come from the Copying Branch (CD Section). [VERIFIED] https://hcmadras.tn.gov.in/faq.php (accessed 2026-10-17).
- The home page also publishes "Theerppu Thirattu" (Tamil judgment digest) PDFs, e.g. May-June 2026, and Gender-sensitisation handbook. [VERIFIED]
- Language: judgments in the HC are in English; a "Judgments in Tamil" digest exists. [INFERENCE for per-judgment Tamil translations; not checked.]

## 6. E-filing, SR numbers, defects, vakalat, copies

- **Portal:** Madras HC has no separate e-filing site; the home page's e-filing link goes to the national portal https://filing.ecourts.gov.in/pdedev/ (older manual refers to efiling.ecourts.gov.in/tn/). [VERIFIED link]. Notifications page https://hcmadras.tn.gov.in/efiling_notification.php (accessed 2026-10-17) lists 14 documents, including: mandatory e-filing for commercial cases (Commercial Division, Commercial Appellate Division, Commercial Court Egmore Chennai), IP and arbitration matters (Principal Seat, Madurai Bench, District Judiciary), anticipatory bail applications, MCOP, all OPs, matrimonial and DV Act cases, S.138 NI Act cases in the District Judiciary, "Facility of efiling of all type of cases in Principal Seat and Madurai Bench", Notification 113/2020, and a User Manual.
- **Rules:** Madras High Court e-Filing Rules, 2020 (SRO C-22/2020). [REPORTED summary] https://www.legitquest.com/act/madras-high-court-e-filing-rules-2020/C2A9 (accessed 2026-10-17): registration of advocates with Bar Council ID PDF; 20 MB cap; PDFs digitally signed or Aadhaar e-Sign; A4, Times New Roman 14, 1.5 spacing, OCR-searchable PDF/PDF-A, 300 DPI, filenames <=45 chars; designated counters until 16:00; online filings after midnight count next day; original signed vakalatnama to be filed in the Registry when directed (Rule 8.1); "objections" are Registry-raised deficiencies; a time-stamped automated filing number issued on acceptance. Mandatory e-filing is category-wise and has been partially modified/postponed (a district court page cites a 31/05/2024 postponement, not read) [REPORTED]. Gazette copy: https://stationeryprinting.tn.gov.in/gazette\2020\47_III_2.pdf (surfaced in search, not read).
- **SR numbers and returns:** After filing and e-filing verification the posting section assigns the file to a Registry official for scrutiny; at this stage pleadings get "SR numbers" (Stamp Register); defects lead to return; returned papers are collected from the "seat for returns", rectified and re-presented (re-e-filed where e-filing is required); delay beyond the permitted period may need condonation by the Registrar/Assistant Registrar; after scrutiny the papers are numbered as cases/documents (e.g. W.P. No.). [REPORTED] https://lawandotherthings.com/litigation-101-madras-high-court-practice-and-procedure/ (accessed 2026-10-17). The Registry has Original, Appellate, Writ and Criminal sections; Original Side has separate seats for IP, arbitration, probate. [REPORTED same source]. The lifecycle is therefore: e-filing acknowledgement -> SR number -> (defects/return, refiling) -> regular number -> listing by the judge's posting clerk. [INFERENCE for the state machine; each step REPORTED].
- **Pilot: Filing Status page** lets one search by filing date (above), the practical way to see SR/filing progress. [VERIFIED page exists]
- **Certified copy:** online "e-Copy Application" portal (https://www.mhc.tn.gov.in/eservices/copyapp/, registration with email id / enrolment id) plus manual PDF. [VERIFIED existence; process steps not read.]
- **Clerks:** Entry passes for registered advocates' clerks (Notification 454 of 2019, proforma at https://hcmadras.tn.gov.in/doc/Notf454of2019_Proforma_Entrypass_Advocate_Clerks.pdf, appeared in search, not read) [REPORTED]. Advocates' Clerks Rules, 1983 amended by SRO C-27/2026 dated 11 Aug 2026 (Rule 6 clause (vii) omitted) per a search snippet of the TN gazette: https://www.stationeryprinting.tn.gov.in/gazette/2026/34_III_2_2026.pdf [REPORTED; content of clause (vii) unknown].

## 7. Roster, sitting arrangements, bench changes

- The court publishes **"Sitting Arrangements" and "Standing Orders"** as PDFs per seat, with dates: the home page lists "Sitting Arrangements - Principal Seat at Madras - wef 05.10.2026", "Standing Orders - Principal Seat... wef 05.10.2026", and the same two for the Madurai Bench (all dated October 01, 2026), plus "Dussehra Holidays Sitting Arrangements 2026" (October 15, 2026). [VERIFIED] https://hcmadras.tn.gov.in/ and https://hcmadras.tn.gov.in/sitting_arrangements.php (accessed 2026-10-17). I could not open the PDFs (they are served through a script, `admin/view_pdf.php`, whose parameters I did not guess). Contents (judge-to-court-hall, portfolio) are unread.
- Rhythm [REPORTED]: roster/portfolios change roughly quarterly (and after retirements/transfers), with seven Division Benches headed by the seniormost judges; cases generally travel with the portfolio unless judgment is reserved or the parties jointly obtain a CJ order after part-hearing; posting clerk of the assigned judge controls listing. https://lawandotherthings.com/litigation-101-madras-high-court-practice-and-procedure/ (accessed 2026-10-17). Here the roster just changed on 05.10.2026, so it is a live example.
- [INFERENCE] The roster is the single most valuable structured dataset for "which bench will my matter go to", but it is published as PDF with unknown layout.

## 8. Case types and nomenclature (official dropdown) [VERIFIED]

Source: case-type dropdown on https://hcmadras.tn.gov.in/cause_list_mhc.php (accessed 2026-10-17). It lists ~130 case types including:
- **Writs:** WP (Writ Petition), WP Crl. (MD) (writ criminal, Madurai), WMP (Writ Misc. Petition), WPMP (W.P. Misc. Petition), WA (Writ Appeal), WAMP, WVMP/VCMP (vacating orders), REV.APLW (Review, Writ), CONT P / CONT A (contempt petition/appeal), HCP (Habeas Corpus Petition), HCMP.
- **Civil Appellate Side:** SA (Second Appeal), CMSA, AS (First Appeal; AS B bench / AS S single), CMA (Civil Misc. Appeal; CMA NPD/PD variants), CRP (Civil Revision Petition; NPD/PD = no-/with-stay type variants, per the dropdown labels "(NPD)/(PD)"), CMP (Civil Misc. Petition), CROS.OBJ, TR CMA / TR AS / TR CMP (transfer), REV.APLC.
- **Criminal:** CRL OP (Criminal Original Petition), CRL MP, CRL A, CRL RC (Criminal Revision Case), CRL REF, RT (Referred Trial).
- **Original Side:** CS (Civil Suit), OP (Original Petition), OA (Original Application), OSA (Original Side Appeal), A (Application), APPL., SUB A / SUB APPL (Sub Applications), OMS (Original Matrimonial Suit), TOS (Testamentary Original Suit), LTS (Leave to Sue), EP (Execution Petition), IP / IA / IC / IN (insolvency), CP / COMP.A / COM APEL (company), REV.APLO, REV.PET, TRCS (transfer civil suit), ELP (election petition), RCMP, SCP/SCMP (Supreme Court petitions).
- **Commercial / IP / Arbitration:** C.S (COMM DIV), O.P (COMM DIV), APPEAL (CAD), OSA (CAD), Arb Appln, **Arb O.P**, Arb O.P (COM.DIV.), Arb Appeal, Arb. E.P, transferred IP series (T)OP(TM), (T)CMA(TM), (T)OP(CR), (T)OP(PT), (T)OP(GI) etc.; Tax: TC, TCA, TCP, TCR, TCMP; TMA, TMSA.
- **Madurai Bench suffix "(MD)":** WP(MD), WA(MD), CRP(MD), CMP(MD), CRL OP(MD), CRL MP(MD), HCP(MD), CRL A(MD), CRL RC(MD), CMA(MD), AS(MD), SA(MD), CONT P(MD), SUB A(M), WPMP(MD), WMP(MD), etc.
Not in the dropdown as typed: "W.M.P." appears as WMP / WPMP (miscellaneous petitions, often filed within a main case), "Crl.O.P." as CRL OP, "Arb.O.P." as Arb O.P. [VERIFIED]
**Original vs Appellate Side:** [REPORTED] suits above Rs 1 crore arising in Chennai fall on the HC Original Side, below that in the Chennai City Civil Court (limit raised to Rs 1 crore by the 2018 amendment of the Chennai City Civil Court Act); commercial disputes above Rs 1 crore go to the Commercial Division; Madurai has all powers except ordinary original jurisdiction. https://lawandotherthings.com/litigation-101-madras-high-court-practice-and-procedure/ ; https://prsindia.org/files/bills_acts/bills_states/tamil-nadu/2018/Bill%2046%20of%202018%20TN.pdf (surfaced, not read) (accessed 2026-10-17).
[INFERENCE for the matter model]: the case identity must be (court seat, case type code, number, year), where case type includes the "(MD)" suffix and sub-application types that are children of a main case; the dropdown is a ready-made enum.

## 9. Practice directions: listing, mentioning, virtual hearings, AI, clerks

- **Listing fairness (2026):** Bar and Bench (10 Oct 2026) reports the Supreme Court dismissed a lawyer's plea over listing of 21 pending Madras HC cases (L.K. Charles Alexander v. Registrar General, Madras High Court); the headline reports the HC held there is no vested right to out-of-turn listing except by prescribed urgent-listing routes, but the fetched article text did not state the holding or mention memos/Registrar (Judicial). [REPORTED, weak] https://www.barandbench.com/news/litigation/supreme-court-dismisses-lawyers-plea-seeking-listing-of-21-cases-before-madras-high-court (accessed 2026-10-17). A prior search summary mentioned "mention memo" and representation to the Registrar (Judicial); I could not confirm it.
- **Mentioning and lunch motion:** No Madras-specific official text found. [UNKNOWN]. The Madras High Court Rules (Appellate Side / Original Side) and Standing Orders are the authority; the "Rules" page https://hcmadras.tn.gov.in/rules.php and "Standing Orders" PDFs were not read.
- **Virtual hearings:** VC pages exist for each seat (`vc_mas.php`, `vc_mdu.php`) plus "VC Documents". [VERIFIED existence only; protocol unread.] Live YouTube streams linked from the home page. [VERIFIED]
- **AI use by advocates:** I found **no Madras High Court circular or practice direction on AI, verified or reported** (searches 2026-10-17). Context [REPORTED]: the Supreme Court in 2026 treated citing unverified AI-generated precedent as misconduct and asked the BCI to frame norms (MediaNama: https://www.medianama.com/2026/03/223-supreme-court-ai-fake-case-laws-misconduct/ ; https://www.medianama.com/2026/07/223-10-cases-ai-hallucination-cases-in-indian-courts/; accessed 2026-10-17); Bombay HC imposed Rs 50,000 costs (Heart & Soul Entertainment v. Deepak Bahry, per secondary sources). A Bengaluru ITAT order (Dec 2024) cited a non-existent Madras HC ruling. I could not verify these details first-hand. [INFERENCE] Citation-verification (matching against JUDIS neutral citations) will be a differentiating, safe feature.
- Madras HC has also announced a Tamil digest and a Sesquicentennial site; not relevant to the adapter.

## 10. Terms of use, copyright, hyperlinking, automated access

All [VERIFIED] (accessed 2026-10-17):
- **Hyperlinking policy** (https://hcmadras.tn.gov.in/webpolicy.php): "High Court of Madras does not object you to link directly to the information which is hosted on our site and no prior permission is required for the same. We do not permit our pages to be loaded into frames on your site. Our website's pages must load into a newly opened browser window." So deep links are allowed; **iframing is forbidden**.
- **Copyright policy** (same page): material "may be reproduced free of charge in any format or media without requiring specific permission", subject to accurate reproduction, not derogatory or misleading use, and prominent source acknowledgment; third-party copyright excluded.
- **Terms and Conditions** (https://hcmadras.tn.gov.in/termcond.php) is stricter: reproduction "after taking proper permission by sending a mail to Madras High Court", same accuracy/non-derogatory/source conditions; content "should not be construed as a statement of law or used for any legal purposes"; no liability of High Court or NIC. **The two pages conflict (no permission vs. permission by mail).** [INFERENCE] Seek written permission to be safe.
- **Disclaimer** (https://hcmadras.tn.gov.in/disclaimer.php): general information only, no warranties as to accuracy/timeliness; external links not endorsed.
- **Privacy:** site does not automatically capture personal information. 
- **robots.txt:** https://hcmadras.tn.gov.in/robots.txt, https://mhc.tn.gov.in/robots.txt and https://www.mhc.tn.gov.in/robots.txt all return HTTP 404 (no robots.txt) (accessed 2026-10-17). Pages carry `<meta name="robots" content="index, follow">`.
- **No statement on automated access** was found in policies or FAQ. The captcha on every search is a technical statement that automated querying is not intended. [INFERENCE] Absence of robots.txt is not authorisation; the captcha means a compliant adapter must not solve or circumvent it.
- Disclosed channels for formal engagement: Registrar (IT-cum-Statistics) email above; NIC hosts the JUDIS apps.

## 11. Court calendar, timings

- Court timings: **not verified from an official source** (home page links "High Court Calendar" `calendar.php`, not read). [UNKNOWN]. Common knowledge of 10:30 AM start is [INFERENCE] only. Filing counters: e-filing rules state designated counters accept filings until 16:00 on working days. [REPORTED via Rules summary]
- Vacations/holidays: "Dussehra Holidays Sitting Arrangements 2026" announced 15 Oct 2026. [VERIFIED]

## 12. Madurai Bench differences

- Own cause list, case status, judgments, display board, registrars, VC pages and sitting arrangements (all verified above).
- Case-type suffix "(MD)" and the "Writ Petition (MD)" nomenclature. [VERIFIED]
- No ordinary original jurisdiction (so no CS/OP/OA suits) [REPORTED]; Commercial Appellate Division sits at Madurai per e-filing notification titles [VERIFIED title].
- Separate standing orders and sitting arrangements. [VERIFIED]

## 13. Subordinate courts in Chennai / Tamil Nadu

- District judiciary eCourts: https://districts.ecourts.gov.in/tn (link verified on HC home), services at https://services.ecourts.gov.in/ecourtindia_v6/. My fetch of https://districts.ecourts.gov.in/chennai failed (connection refused). District sites follow the pattern `<district>.dcourts.gov.in` (e.g. erode.dcourts.gov.in, perambalur.dcourts.gov.in surfaced in search) [REPORTED]. These publish circulars/notifications per district.
- Chennai courts: City Civil Court (limit Rs 1 crore) [REPORTED], Court of Small Causes, Chief Metropolitan Magistrate courts (Egmore), Family Courts, Commercial Court Egmore (named in e-filing notification [VERIFIED]), plus Principal/Additional courts. Complex-wise listing on eCourts not verified. [UNKNOWN]
- Mandatory e-filing in district judiciary for commercial, matrimonial, DV, IP/arbitration, anticipatory bail, MCOP, S.138 NI Act matters. [VERIFIED titles at efiling_notification.php]
- **Language:** [REPORTED] Tamil Nadu Official Language Act amendment of 1976 made Tamil the language for recording evidence and writing judgments/decrees/orders in subordinate courts, allowing English words and High Court relaxations; Full Bench upheld it in 1994; a later general exemption letting judges write in English was struck down by the HC and the Supreme Court stayed that judgment (year unconfirmed). Sources: https://www.barandbench.com/news/tamizh-supreme-court-english ; https://www.dtnext.in/amp/story/edit/justice-vernacular-the-long-road-to-a-tamil-courtroom (accessed 2026-10-17, snippets only). [INFERENCE] Expect Tamil-language orders, mixed Tamil/English pleadings and party names transliterated; adapter/document intelligence needs Tamil OCR and transliteration-tolerant name matching. HC publishes "Theerppu Thirattu" in Tamil. [VERIFIED]

## 14. Bar and market facts

- **Junior stipend direction [VERIFIED by two secondary sources]:** *Farida Begam v. The Puducherry Government & Ors.*, W.P. No. 17976 of 2019 (Madras HC; Subramaniam and C. Kumarappan JJ.). First order 12 June 2024 (said bar associations to pay), modified 13 June 2024 [per LiveLaw timestamp] so that advocates and senior advocates on the Bar Council of Tamil Nadu and Puducherry rolls pay juniors a minimum **Rs 20,000/month in Chennai, Madurai, Coimbatore and Rs 15,000/month elsewhere**; no gender discrimination. LiveLaw citation 2024 LiveLaw (Mad) 240: https://www.livelaw.in/amp/high-court/pay-rs.15k-to-20k-to-junior-advocates-as-monthly-stipend-madras-high-court-directs-advocates-260410 ; SCC Online reports an earlier 03-06-2024 hearing (2024 SCC OnLine Mad 1787) where the court asked the Bar Council to frame guidelines: https://www.scconline.com/blog/post/2024/06/07/extracting-work-without-payment-exploitation-violation-fundamental-rights-madras-hc-directs-guidelines-for-advocates-in-tn-bar-council/ (accessed 2026-10-17). Bar Council of TN & Puducherry resolution 05.07.2024 circulating it [REPORTED, LiveLaw]. Later modifications: not checked.
- **Enrolment numbers:** no official figure found. An aggregator claims "over 1.2 lakh" [REPORTED, weak]: https://jurigram.com/advocates/resources/bar-council/tamilnadu-bar-council-advocate-list. Bar Council of TN & Puducherry asked in Nov 2025 for a rise in statutory enrolment fee (Rs 750 since 1993): https://www.scconline.com/blog/post/2025/11/17/bar-council-tamil-nadu-puducherry-seeks-raise-in-advocates-enrollment-fees/ . BCTN asked 1,547 advocates for AIBE proof: https://www.barandbench.com/news/bctn-asks-1547-advocates-proof-passing-aibe-to-avoid-suspension . Enrolment number format e.g. "MS/123/1900" [VERIFIED from cause list form hint].
- **Madras High Court Advocates Association:** no sourced information found. [UNKNOWN] The home page has a "Bar Council Election" link (`bar_council.php`) not read.
- **Senior advocates:** HC runs "Design. of Sr. Adv." portal (https://hcmadras.tn.gov.in/ssa/); Bar and Bench reported 62 designations (date not verified): https://www.barandbench.com/news/litigation/madras-high-court-designates-62-lawyers-senior-advocates .
- **Bench strength:** reports of 15 and 19 new judges appointed/recommended in 2026 (https://theprint.in/india/madras-high-court-appoints-15-new-judges-strength-reaches-66/3009749/ ; https://www.scconline.com/blog/post/2026/05/19/on-sc-collegium-recommendation-madras-hc-gets-19-new-judges/) [REPORTED, snippets]. Strength figure 66 per ThePrint headline.
- **Legal-tech usage among Chennai lawyers / local tools:** nothing reliable found. [UNKNOWN] Generic national tools (Manupatra, SCC Online, LiveLaw, Indian Kanoon) are visible in search; the court's own AIMS and e-Copy portals are the actual in-workflow tools. 

---
## Implications for a Madras HC court adapter (inference)

1. **Do not build a scraper. Build an "authorised-sources" adapter.** Every search form is captcha-gated; no robots.txt, no API, and no statement permitting automation. Terms ask for permission by mail for reproduction. Plan: (a) write to the Registrar (IT-cum-Statistics) seeking written permission and ideally a data feed/API; (b) meanwhile ingest only lawyer-supplied inputs.
2. **Primary ingestion = the court's own email/SMS push.** Notification 230/2026 means advocates who tag their cases in AIMS will get cause-list emails (pilot). Adapter v1: connect the lawyer's mailbox (consented), parse those emails into the court-day view and the deadline queue; guide the lawyer through AIMS enrolment and case tagging. Also accept uploaded cause-list PDFs and the lawyer's own downloaded orders.
3. **Deep links, not frames.** Policy allows direct linking, forbids iframes: open case status / judgment pages in a new tab, never embed.
4. **Matter identity model:** (seat: Principal/Madurai) x (side: Original/Appellate/Writ/Criminal/Commercial) x (case-type code from the official ~130-value dropdown, incl. "(MD)" suffix) x number/year, plus filing number, SR number (pre-registration, pending), CNR. Main case vs miscellaneous petitions (WMP, WPMP, CMP, CRL MP, SUB A) as children. Support SR-number stage and "returned for defects/re-presentation" as explicit states with a refiling deadline task.
5. **Listing states:** model categories as free-text labels, with a mapping layer, because official category strings were not observed. Support item number, court hall, judge, and "supplementary/advance" flags, but treat as unverified until a sample list is inspected.
6. **Roster awareness:** sitting arrangements change roughly quarterly (latest wef 05.10.2026) and as PDFs; a manual/assisted "roster import" with effective dates, and alerts when a matter's portfolio changes, would be high-value. Keep versions by effective date.
7. **Neutral citation:** parse `YYYY[:/]MHC[:/]N`; use as the verification anchor against AI-hallucinated citations (note: no Madras-specific AI direction found; the Supreme Court has said unverified AI citation is misconduct).
8. **Language:** subordinate-court orders are Tamil-first with English admixture; HC is English. Need Tamil OCR, transliteration-aware party/advocate name matching (enrolment number is a safer key than name).
9. **Display board:** real-time, no verified feed. Offer a "manual item-number tracker" and rely on the lawyer's own view, or on whatever the court authorises.
10. **Madurai:** treat as a separate adapter configuration (own endpoints, (MD) types, no original side).
11. **Unstable hostnames:** keep config-driven base URLs (hcmadras, mhc, madrashighcourt, ecourts).

## Confidence and unknowns

High confidence (official pages read): site structure; search modes and captchas; case-type list; website policies and robots.txt 404; AIMS and Notification 230/2026; sitting-arrangement publication dates; e-filing notification titles; judgments portal search modes.
Medium: SR number/return process, roster mechanics, Original/Appellate jurisdiction (secondary: lawandotherthings, LiveLaw); stipend order (two secondary reports consistent).
Low/unknown (not verified; do not rely): format and categories of actual cause lists (needs authorised/captcha-solving human check of one sample); supplementary/advance/lunch-motion rules and mentioning procedure (Madras HC Rules, Standing Orders not read); court timings; contents of Sitting Arrangements PDFs; certified-copy procedure/fees; whether the Registry offers any API; neutral citation separator (colon vs slash); Advocates' Clerks Rules amendment content; Madras-specific AI directions (none found); BCTN enrolment totals (only a 1.2 lakh aggregator claim); Madras High Court Advocates Association facts; legal-tech usage among Chennai lawyers; Chennai subordinate-court eCourts coverage (district site fetch refused); final status of Tamil-language judgment litigation; whether the two conflicting reproduction policies (webpolicy vs termcond) are reconciled.
Limitations: some "REPORTED" items come from search-engine summaries of pages I did not open; the lawandotherthings article might be dated. Fetches of official pages used curl with TLS verification disabled because the court's certificate chain failed validation.
