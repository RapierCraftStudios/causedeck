# 06 - Tech stack and costs for an Indian legal OS (research, 2026-10-17)

Tags: [VERIFIED] = read on the vendor's own page during this session. [REPORTED] = third-party site, search snippet, or vendor page that was truncated or inconsistent. [INFERENCE] = my reasoning or estimate. Every source line ends "(accessed 2026-10-17)".

Caveat on method: the search tool returns summaries, not full pages. Many vendor pricing pages could not be read in full. Anything not tagged [VERIFIED] should be re-checked before a budget decision. FX assumption used throughout: 1 USD = Rs 90 [INFERENCE; not looked up]. GST (18%) is excluded unless stated.

---

## 1. Cross-platform frameworks (Android-first, iOS, web, desktop, "native feel")

Evidence base here is thin. Search returned agency comparison blogs and little on Tauri 2 in 2026. Most of the judgement below is [INFERENCE].

| Option | Mobile | Web | Desktop | Notes for a 1-3 person team |
|---|---|---|---|---|
| Expo / React Native | Real native widgets; New Architecture is now the default (RN 0.84 reportedly completed the transition) [REPORTED] | react-native-web (shared components, but web UX usually needs its own layout) [INFERENCE] | Windows/macOS via react-native-windows/macos, or Electron/Tauri shell around the web build [INFERENCE] | Largest ecosystem and hiring pool. Best SDK coverage (payments, auth, push, SQLite). One TypeScript codebase can also serve backend and web. |
| Flutter | Own renderer; consistent look, ~60 FPS on heavy UIs [REPORTED] | Canvas-based; weaker SEO, text selection and accessibility [INFERENCE] | Stable on Win/mac/Linux [REPORTED] | Strong for pixel-consistent UI. "Native feel" is emulated, not native. Dart is a second language. Indic text shaping is generally fine but check conjuncts in the renderer [INFERENCE]. |
| Tauri 2 | Mobile exists, but Tauri's own RC post says mobile was over-promised as "first class" and not all plugins were ported [REPORTED]. No 2026 status found. | Web UI in system webview | Excellent: small binaries, Rust core | Best desktop shell. Mobile is the weak link for an Android-first product. |
| Capacitor | WebView wrapper | Native web | Electron-based community options | Fastest path if you already have a web app. Feel is "web in a shell"; offline-first with SQLite plugin is workable. |
| Kotlin / Compose Multiplatform | Native Android is first-rate; iOS UI sharing reached stable mid-2025 [REPORTED] | Wasm (younger) | JVM desktop | Great if the team is Kotlin-fluent. Smaller ecosystem and fewer ready SDKs. KMP adoption reportedly rose from 7% to 23% in 18 months [REPORTED]. |

Sources: https://idealogic.io/blog/react-native-vs-flutter ; https://stora.sh/blog/2026-04-03-react-native-vs-flutter-vs-kotlin-multiplatform-2026 ; https://v2.tauri.app/blog/tauri-2-0-0-release-candidate/ (all accessed 2026-10-17).

Assessment [INFERENCE]: Expo/React Native for mobile, a TypeScript web app sharing logic, and a Tauri (or Electron) shell for desktop gives the most reuse per engineer. The Tauri-desktop plus RN-mobile split is fine because sync, not UI, is the shared layer.

---

## 2. Local-first / offline sync

| Engine | Model | Pricing (verified where stated) |
|---|---|---|
| PowerSync | Postgres (also MongoDB/MySQL) to client SQLite; mature RN/Flutter/web SDKs | Cloud: Free $0 (2 GB synced, 500 MB hosted, 50 peak concurrent, deactivated after inactivity); Pro from $49/mo (30 GB synced, 10 GB hosted, 1,000 peak connections; overage $1/GB synced, $1/GB hosted, $30 per extra 1,000 clients, $25/mo per extra instance); Team from $599/mo; self-hosted Open Edition is free and source-available [VERIFIED] https://www.powersync.com/pricing (accessed 2026-10-17) |
| Zero (Rocicorp) | Query-driven sync, Postgres to client store; reached 1.0 in 2026 [REPORTED] | Open source; hosted pricing not found https://infoq.com/news/2026/06/zero-version-1 ; https://zero.rocicorp.dev/docs/introduction.md (accessed 2026-10-17). Web-first; RN support not confirmed [unknown]. |
| Replicache | Predecessor of Zero; made free to use in 2024, source-available [REPORTED] https://rxdb.info/articles/alternatives/replicache-alternative.html (accessed 2026-10-17). Avoid for new work; Zero is the successor. |
| RxDB | JS NoSQL local DB, replication to any backend, open source core | Core free; premium plugins paid (price not checked) [unknown] |
| ElectricSQL, InstantDB, Triplit | Not covered by any source retrieved. A 2026 review lists Zero, PowerSync, ElectricSQL, InstantDB, Turso as top tier [REPORTED] https://www.letsdatascience.com/news/developers-adopt-local-first-databases-for-performance-94cb2640 (accessed 2026-10-17). Triplit status unknown. |
| SQLite + CRDT (Automerge/Yjs) | Build-your-own; good for collaborative documents (drafts), heavy for relational case data | Free |

Assessment [INFERENCE]: A case diary is relational, mostly single-writer per record, and conflicts are rare. PowerSync fits best (SQLite on every platform, Postgres backend, self-host fallback). Use Yjs only for the collaborative draft editor, if at all.

---

## 3. Backend and hosting with Indian residency

| Provider | Facts | Source |
|---|---|---|
| Supabase | Pro $25/mo incl. $10 compute credit (one Micro). Compute: Micro $10, Small $15, Medium $60, Large $110, XL $210, 2XL $410. Pro includes 100k MAU, 100 GB storage ($0.0213/GB over), 250 GB egress ($0.09/GB over). Compute billed hourly per project. [VERIFIED] A Mumbai (ap-south-1) region is offered [INFERENCE from prior knowledge; not confirmed this session]. | https://supabase.com/pricing (accessed 2026-10-17) |
| Neon | Reported Launch $0.106/CU-hour, Scale $0.222/CU-hour, storage $0.35/GB-mo; no minimum since Dec 2025 [REPORTED]. Mumbai region not confirmed. | https://www.jetadmin.io/blog/neon-pricing/amp/ (accessed 2026-10-17) |
| AWS Mumbai (ap-south-1) / Hyderabad (ap-south-2) | RDS db.t4g.micro in Mumbai about $15/mo on-demand [REPORTED, engine unclear]. EC2 and S3 Mumbai rates not retrieved. | https://www.bytebase.com/dbcost/rds/instance/db.t4g.micro/ (accessed 2026-10-17) |
| Cloudflare R2 | $0.015/GB-mo, Class A $4.50/M, Class B $0.36/M, zero egress, free tier 10 GB. [VERIFIED] R2 jurisdictions and India residency not confirmed; Regional Services (limits where TLS is decrypted) added India in 2022 but Customer Metadata Boundary reportedly covers only EU/US [REPORTED]. Data Localization Suite is an enterprise product; price not public [INFERENCE]. | https://developers.cloudflare.com/r2/pricing/ ; https://blog.cloudflare.com/regional-services-comes-to-apac/ (accessed 2026-10-17) |
| DigitalOcean Bangalore (BLR1) | Region exists; entry droplet reported $4-6/mo; managed Postgres from about $15/mo [REPORTED]. Bills in USD only [REPORTED]. | https://www.digitalocean.com/company/blog/introducing-our-bangalore-region-blr1/ ; https://valebyte.com/en/blog/digitalocean-pricing-overview-and-5-cheaper-alternatives-in-2026/ (accessed 2026-10-17) |
| Hetzner | No India region as far as I know [INFERENCE; not verified]. Exclude if residency matters. |
| E2E Networks (Indian cloud) | H100 on demand reported about Rs 249/hr; IndiaAI-subsidised GPU Rs 65-92/hr; hyperscaler Mumbai nearer Rs 1,000/GPU-hr [REPORTED, conflicting, ex-GST]. | https://dev.to/mr_manushukla/gpu-cloud-pricing-in-india-2026-h100-h200-and-b200-rates-compared-bo7 ; https://ecorpit.com/india-gpu-cloud-rental-pricing-h100-b200-2026/ (accessed 2026-10-17) |
| GCP Mumbai/Delhi, Azure India, Firebase asia-south1, Yotta | Not researched successfully. Regions exist [INFERENCE]; prices not retrieved. |

Residency note [INFERENCE]: Storing case data in Mumbai (Supabase/AWS) and keeping object storage in an Indian region is the practical floor. Cloudflare's CDN/proxy would still terminate TLS globally unless Regional Services is bought, so keep it out of the document path or accept that.

---

## 4. LLM APIs

### Anthropic (first-party price table, [VERIFIED]) https://platform.claude.com/docs/en/about-claude/pricing (accessed 2026-10-17)

| Model | Input $/MTok | Output $/MTok | Cache read $/MTok | Cache write 5m |
|---|---|---|---|---|
| Fable 5.1 | 10 | 50 | 0.25 | 12.50 |
| Opus 5.5 | 4 | 20 | 0.20 | 5 |
| Opus 5 / 4.8 | 5 | 25 | 0.50 | 6.25 |
| Sonnet 5.5 | 2 | 10 | 0.10 | 2.50 |
| Sonnet 5 | 2 | 10 | 0.20 | 2.50 |
| Sonnet 4.6 | 3 | 15 | 0.30 | 3.75 |
| Haiku 5.5 (prompts <=100k) | 0.10 | 0.50 | 0.01 | 0.125 |
| Haiku 5.5 (>100k) | 0.50 | 2.50 | 0.05 | 0.625 |
| Haiku 4.5 | 1 | 5 | 0.10 | 1.25 |

- Batch API gives 50% off [REPORTED by several blogs; page also notes multipliers stack with batch].
- Claude 4.7 and later use a new tokenizer producing about 30% more tokens for the same text; Indic scripts may inflate further [VERIFIED for the 30%; Indic effect is INFERENCE].
- First-party data residency option is `inference_geo: "us"` at 1.1x; there is no India option on the first-party API [VERIFIED]. Regional/multi-region endpoints on Bedrock/Vertex carry a 10% premium over global [VERIFIED].
- Sonnet 5's $2/$10 became permanent; the planned rise to $3/$15 did not happen [VERIFIED on same page].

### Claude on Amazon Bedrock, India in-country (key finding)
AWS announced (29 Sep 2026) India geographic cross-Region inference: Claude Opus 5, Sonnet 5 and Haiku 4.5, routed only between Mumbai (ap-south-1) and Hyderabad (ap-south-2), profile IDs like `in.anthropic.claude-sonnet-5`. Billing is tracked in the source region. Bedrock states zero data retention by default (some models may allow human review if content is flagged). No per-token prices in the post. [VERIFIED for availability]. Price assumed list +10% regional premium [INFERENCE].
Source: https://aws.amazon.com/blogs/machine-learning/amazon-bedrock-expands-claude-model-availability-to-india-cross-region-inference/ (accessed 2026-10-17). Sonnet 5.5 and Haiku 5.5 are not listed for the India profile in that post.

### Google Gemini
Developer API paid tier (content not used for training on paid tier for most models): Gemini 3.1 Pro Preview $2/$12 (<=200k); 3.1 Flash-Lite $0.25/$1.50; 2.5 Flash $0.30/$2.50; 3.8 Flash $0.75/$3.75 until Dec 31 2026 then $1.50/$7.50; Batch -50%. [VERIFIED] https://ai.google.dev/gemini-api/docs/pricing (accessed 2026-10-17). Vertex AI India region/data residency: not confirmed; Vertex has Mumbai and Delhi regions but model availability per region is unknown [INFERENCE].

### OpenAI
Residency: per-request regional processing added 21 Aug 2026; India listed as storage-only, processing not local (only US, EU, UAE process locally); 10% uplift on residency endpoints for models released after 5 Mar 2026 [REPORTED, single blog] https://ecorpit.com/openai-per-request-regional-processing-india-storage-only-2026/ (accessed 2026-10-17). Model price figures from blogs conflict; not used.

### Indian models: Sarvam
Official price page (pay-as-you-go, INR per 1M tokens in/cached/out): Sarvam 105B Rs 15 / 5 / 60; Gemma 4 Rs 35 / 10 / 90; GLM 5.3 Flash Rs 13.5 / 2.5 / 45; DeepSeek V4.1 Flash Rs 25 / 0.5 / 105 [VERIFIED via page fetch; note a separate search snippet showed Sarvam-105B at Rs 4 / 2.5 / 16, so pricing may have changed; treat as REPORTED-conflicting]. https://www.sarvam.ai/api-pricing (accessed 2026-10-17). Sarvam hosts open-weight models in India, so it can serve as a residency-friendly LLM host. Krutrim and BharatGen: not researched successfully [unknown].

### Open-weight self-hosting
Cheapest India GPU is E2E / IndiaAI-subsidised (above). One H100 at Rs 249/hr on-demand is about Rs 1.8 lakh/month (about $2,000) running 24/7 [INFERENCE from REPORTED rate]. That only beats API pricing at very high, steady volume; at the scale below, APIs are cheaper [INFERENCE]. Llama/Qwen/Mistral/Gemma Indic quality is not verified here.

### Embeddings
OpenAI text-embedding-3-small $0.02/MTok (batch $0.01) is the only figure consistent across sources; others conflicting [REPORTED] https://www.costbench.com/software/embedding-apis/openai-embeddings/ (accessed 2026-10-17). Embedding cost is negligible (< Rs 5/user/month). Residency-wise, prefer a self-hosted open model (e.g. multilingual-e5/bge-m3) on the same Mumbai VM [INFERENCE].

### Zero data retention
Bedrock default ZDR (above) is the cleanest documented route for India. Gemini paid tier excludes training use, which is not the same as zero retention [VERIFIED for training exclusion]. First-party Anthropic ZDR is an enterprise arrangement [INFERENCE].

---

## 5. OCR / document processing / speech

| Service | Price | Indic support | Source |
|---|---|---|---|
| Google Document AI (Enterprise OCR) | $1.50/1,000 pages (1-5M/mo), $0.60 above; Layout Parser $10/1,000; Form Parser $30/1,000 [REPORTED, official page truncated] | Multi-language; Devanagari support not confirmed from source | https://cloud.google.com/document-ai/pricing (accessed 2026-10-17) |
| Azure Document Intelligence Read | About $1.50/1,000 pages [REPORTED, official page blank] | Hindi support not confirmed | https://aiproductivity.ai/pricing/azure-document-intelligence (accessed 2026-10-17) |
| AWS Textract | Not retrieved | Historically Latin-script only (English, Spanish, Italian, Portuguese, French, German); no Hindi found [REPORTED, 3-year-old AWS answer] https://repost.aws/questions/QUVeFLYhy8RFWKRH0H94fXVA/is-there-a-way-to-specify-language-while-detecting-text-in-aws-textract (accessed 2026-10-17). Do not rely on Textract for Hindi. |
| Sarvam Vision / Document AI | Digitisation Rs 0.50/page; extraction Rs 1.00/page [VERIFIED] https://www.sarvam.ai/api-pricing (accessed 2026-10-17). Vision itself had no listed price. | 22 Indian languages + English; vendor-reported Hindi word accuracy 95.9, overall 87.4 on its own benchmark, Vision 2.1 (24 Sep 2026) adds tables, forms, Indic handwriting [REPORTED, vendor-sourced] https://www.sarvam.ai/blogs/sarvam-vision-2-1 (accessed 2026-10-17). No "Sarvam Parse" product found. |
| Tesseract / open-source | Free; Hindi and other Indic traineddata exist [INFERENCE]; quality on stamped, skewed court scans is typically poor [INFERENCE] | | |
| Gemini / Claude vision as OCR | Token-priced; strong on mixed scripts [INFERENCE]; check residency | | |

Speech-to-text: Sarvam STT Rs 0.49/min (about Rs 29.4/hr), diarization Rs 0.59/min, per page fetch [VERIFIED]; an earlier snippet said Rs 30/hr and Rs 45/hr with diarization, so rates may have changed. Source: https://www.sarvam.ai/api-pricing and https://smallest.ai/blog/sarvam-ai-speech-to-text-pricing (accessed 2026-10-17). Adalat AI is a nonprofit court-transcription tool (reportedly 3,000+ courts, 15+ languages) and is not a purchasable API as far as found [REPORTED] https://yourstory.com/socialstory/2026/01/adalat-ai-india-overburdened-justice-system-technology (accessed 2026-10-17). Whisper and AI4Bharat models: not verified here; Whisper is generally weaker on Indic [INFERENCE].

---

## 6. Payments and subscriptions

- Razorpay: 2% flat platform fee on domestic instruments (UPI listed as "zero MDR, 2% platform fee"), no setup/AMC; international cards up to 3%; GST 18% on the fee, not the transaction. Subscription cards: 0.9% plus platform fees [ambiguous]; UPI Autopay/e-mandate pricing "on request" [VERIFIED page, with ambiguity]. https://razorpay.com/pricing/ (accessed 2026-10-17). A Razorpay blog separately cites 0.99% subscription fee [REPORTED].
- Cashfree: UPI Autopay reported Rs 7.5 mandate creation + Rs 5 per presentation (Rs 15 under Rs 1,000) [REPORTED, fitgap listing]; 1.6% promo expired 31 Jul 2026; standard about 1.95-2% [REPORTED]. https://www.cashfree.com/docs/payments/subscription/introduction ; https://www.cashfree.com/docs/help/account/pricing (accessed 2026-10-17).
- Stripe India: invite-only since May 2024, access limited [REPORTED, competitor blogs]; not a practical option. https://www.skydo.com/blog/stripe-payment-links-india-fees-features (accessed 2026-10-17).
- RBI e-mandate framework (consolidated 21 Apr 2026): recurring payments up to Rs 15,000 may proceed without per-transaction AFA after an AFA-validated registration; above that AFA is needed; Rs 1 lakh exception for insurance, mutual funds, credit-card bills; 24-hour pre-debit notification [REPORTED, news and law-firm summaries; no RBI primary document read]. https://conventuslaw.com/report/rbis-digital-payments-e-mandate-framework-2026-consolidated-directions-for-recurring-digital-transactions/ ; https://rocketpay.co.in/blog/rbi-e-mandate-recurring-payments-15000 (accessed 2026-10-17). A Rs 500-3,000/month legal SaaS plan is far below Rs 15,000, so UPI Autopay/card mandates are straightforward.
- Google Play: standard subscription service fee 15%; in India, users choosing alternative billing cut the developer fee by 4 percentage points; developer must integrate alternative billing APIs and report transactions within 24 hours [REPORTED from Google support pages, snippet] https://support.google.com/googleplay/android-developer/answer/13306652 ; https://support.google.com/paymentscenter/answer/112622 (accessed 2026-10-17). Google Play supports UPI Autopay for subscriptions [REPORTED] https://www.deccanherald.com/technology/google-play-store-now-supports-upi-autopayment-for-app-subscription-fees-in-india-1162628.html (accessed 2026-10-17).
- Apple: Small Business Program 15% commission for developers under $1M proceeds [REPORTED]. https://appbot.co/blog/app-developers-apple-google-small-business-programs/ (accessed 2026-10-17). No India-specific alternative-payment rule found.
- Practical [INFERENCE]: sell on the web via Razorpay/Cashfree (about 2.4% incl. GST) and treat app-store billing as an optional convenience. Whether a B2B productivity tool can legally route purchases outside Play Billing depends on Play policy for digital services; verify before launch.

---

## 7. Messaging

- WhatsApp Business Platform: per delivered template pricing by category since 1 Jul 2025. India INR rates reported by BSPs: marketing Rs 0.8631 (up from Rs 0.7846 on 1 Jan 2026), utility Rs 0.115, authentication Rs 0.115; plus GST and BSP platform fees [REPORTED, none read from Meta's own rate card]. https://docs.gallabox.com/pricing-and-billing/whatsapp-pricing/rate-card.md ; https://whautomate.com/whatsapp-business-api-pricing-india (accessed 2026-10-17). Meta's doc [VERIFIED]: INR billing since 1 Jan 2026; WABAs must migrate to INR by 31 Dec 2026 or message delivery stops from 1 Jan 2027; service-window messages free; utility templates inside an open 24h window free. https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing.md (accessed 2026-10-17). One BSP says from 1 Oct 2026 utility templates in an open window and replies beyond 1,000 free per number become charged [REPORTED, conflicts with Meta doc retrieved] https://baat.ai/blog/whatsapp-api-pricing-india (accessed 2026-10-17).
- SMS (TRAI DLT): entity and template registration mandatory; transactional/OTP reported Rs 0.10-0.30 per segment plus 18% GST; DLT may need a refundable deposit (about Rs 5,000+) [REPORTED, vendor blogs]. https://www.messagecentral.com/blog/a2p-sms-pricing-india (accessed 2026-10-17).
- Email: SES and Resend pricing not retrieved. Expected under $1 per 10k emails for SES [INFERENCE, from prior knowledge, unverified].

---

## 8. Memory patterns for per-lawyer LLM memory

- Hosted memory: Mem0 reported $19 / $79 / $250 per month tiers (a free tier is reported by one source, denied by another); Zep Flex about $125/mo (50,000 credits); Letta Cloud and LangMem pricing not found [REPORTED, aggregators]. https://costbench.com/software/ai-memory-context/mem0/ ; https://www.agenticwire.news/article/mem0-zep-letta-agent-memory (accessed 2026-10-17).
- Confidentiality problem [INFERENCE]: sending client facts to a US memory SaaS defeats Indian residency and privilege expectations. Mem0, Letta and LangMem are open source and self-hostable; Zep's self-host story is weaker (unverified).
- Recommended pattern [INFERENCE]: keep memory in your own Postgres (pgvector) in Mumbai, partitioned by lawyer_id with row-level security. Store three layers: (a) explicit preferences/style facts the lawyer can view, edit and delete; (b) matter-scoped notes; (c) embedded chunks of the lawyer's own documents. Do not mix client matters across memory retrieval, and never share memory across lawyers or firms. Encrypt per-tenant (envelope keys) and offer "forget" with real deletion including embeddings. Let a small model (Haiku-class) extract memory updates asynchronously and batch them at 50% off.

---

## 9. Court data acquisition

- No official public developer API from eCourts; the portals are services.ecourts.gov.in (district), hcservices.ecourts.gov.in (High Courts), sci.gov.in (Supreme Court); eCourts Services mobile app and UMANG also expose status; NJDG publishes aggregates [REPORTED] https://www.vaquill.ai/blog/best-indian-case-law-apis-for-developers-2026 (this page turned out to cover a US API only, so the "no official API" claim rests on the search summary, not the page); https://lawarticle.in/check-online-case-status-ecourts-portal-guide/ (accessed 2026-10-17).
- Scraping needs CAPTCHA solving; third-party scrapers use Tesseract-style solvers [REPORTED] https://apify.com/codingfrontend/ecourts-case-scraper (accessed 2026-10-17). Terms of use and legal risk are unverified.
- Commercial APIs: Surepass eCourts API (national coverage, bulk search, sandbox on free account; price not public, "contact sales") [VERIFIED page] https://surepass.io/ecourts-api/ ; eCourtsIndia (API with free credits, per-endpoint price not public) [REPORTED] https://www.capterra.com/p/10049317/eCourtsIndia/ ; Meon also advertises one [REPORTED] https://meon.co.in/ecourts-api (accessed 2026-10-17). API Setu and Legalkart: nothing found.
- Cost estimate [INFERENCE, no source]: Rs 1-5 per lookup. A lawyer with 40 live matters refreshed weekly is about 160 lookups a month, or Rs 160-800 per user per month. That could exceed every other cost line. Needs a negotiated bulk price, CNR-based caching shared across users (many lawyers appear in the same case), or user-supplied manual entry plus cause-list ingestion.

---

## 10. Cost model (monthly, steady state)

Assumptions [INFERENCE unless noted]:
- Active user = paying lawyer. FX Rs 90/USD. Prices ex-GST.
- Per user per month: 60 chat/drafting requests (6k input, 1k output tokens) plus 20 document summaries (30k input, 1.5k output), so about 1.0M input and 0.09M output tokens.
- Model mix 70% Haiku 5.5-class, 30% Sonnet 5.5-class, with caching on about 40% of input. Anthropic-list cost works out to about $0.73; Bedrock India with 10% premium about $0.80 (about Rs 72).
- OCR 100 pages/user at Sarvam Rs 0.50 = Rs 50. Embeddings and storage (2 GB on R2) about Rs 5. WhatsApp 20 utility templates plus 2 SMS OTPs about Rs 5. Total variable about Rs 132 (about $1.46) per user.
- Excluded: court-data API (section 9), payment fees (about 2.4% of revenue via Razorpay, 15% on any Play-billed sales), GST, staff, legal/compliance.

| Line (USD/mo) | 100 users | 1,000 users | 10,000 users |
|---|---|---|---|
| Supabase Pro + compute (Micro/Medium/Large; multiple projects/replicas at 10k) | 25 (Micro credit covers compute) | 75 | 250 |
| PowerSync Pro (+ overages: synced 5 / 50 / 500 GB) | 49 | 80 | 670 (self-host Open Edition could cut this) |
| Object storage (R2, 0.2 / 2 / 20 TB) | 3 | 30 | 300 |
| App store fees (Apple $99/yr; Play $25 once), domain, monitoring, email | 25 | 55 | 330 |
| Fixed subtotal | 102 | 240 | 1,550 |
| AI + OCR + messaging at about $1.46/user | 146 | 1,460 | 14,600 |
| Total USD | about 250 | about 1,700 | about 16,150 |
| Total INR | about Rs 22,500 | about Rs 1.53 lakh | about Rs 14.5 lakh |
| Per user per month | about $2.5 / Rs 225 | about $1.7 / Rs 153 | about $1.6 / Rs 145 |

Sensitivity [INFERENCE]: AI is 85-90% of spend. A heavy user at 3x token usage on Sonnet-class only would be about $6-7/month. Routing most traffic to Haiku 5.5 ($0.10/$0.50) and using Batch for summaries could halve the AI line. At a plausible Rs 500-1,500/month price per lawyer, gross margin looks healthy even in the heavy case, but court-data API costs could change that and are unpriced.

---

## Recommended stack for a bootstrapped team (inference)

1. Client: Expo/React Native (Android first, iOS from same code), TypeScript web app sharing the data layer, Tauri shell for desktop later. Keep UI per platform thin; put logic in shared TypeScript packages.
2. Offline: PowerSync with SQLite on every client; start on Free/Pro, keep the self-hosted Open Edition as the cost and residency escape hatch. Yjs only for the draft editor if collaboration is needed.
3. Backend: Postgres (Supabase Mumbai or a plain Mumbai VM/RDS) with pgvector and row-level security; object storage in an Indian region (S3 Mumbai preferred over R2 if you want clean residency; R2 is cheaper but jurisdiction needs checking).
4. AI: Claude via Bedrock India profile (Sonnet 5 for drafting, Haiku 4.5 for routine tasks), because it is the only documented in-India, zero-retention route for frontier models. Keep an abstraction layer so Sarvam-hosted open models can take Indic-heavy or cost-sensitive tasks. Use prompt caching and batch aggressively.
5. OCR: Sarvam Document AI/Vision for Indic scans, Google Document AI or a vision LLM as fallback; test on real High Court orders before committing. Skip Textract for Hindi.
6. Memory: own pgvector tables, per-lawyer namespaces, user-visible and deletable memory; no third-party memory SaaS.
7. Payments: Razorpay (or Cashfree) subscriptions with UPI Autopay on the web; Play Billing only if required.
8. Messaging: WhatsApp utility templates for hearing reminders via a low-markup BSP, plus in-app push; SMS only for OTP after DLT registration.
9. Court data: start with user-entered CNR numbers, shared caching, and one commercial API on a negotiated bulk price; avoid building your own CAPTCHA scraper on day one.
10. Spend control: per-user token budgets, Haiku-first routing, nightly batch jobs for summaries.

---

## Confidence and unknowns

- High confidence [VERIFIED]: Anthropic prices and data-residency rules; Bedrock India in-country availability for Opus 5, Sonnet 5, Haiku 4.5; Supabase, PowerSync, R2 prices; Razorpay 2% fee; Sarvam per-unit prices (with a conflicting earlier snippet).
- Medium [REPORTED]: WhatsApp INR rates (BSP pages, not Meta's rate card; Oct-2026 free-window changes conflict); Play 15% and 4% India alt-billing cut; RBI e-mandate thresholds (no primary RBI text); Gemini prices (page read, but promo pricing changes by date).
- Low or unknown: Supabase/Neon Mumbai availability confirmation; AWS EC2/S3 Mumbai rates; Vertex and Azure OpenAI India model availability; Krutrim and BharatGen; Textract and Azure Read Hindi support; ElectricSQL/Instant/Triplit status; Tauri 2 mobile maturity in 2026; Zep/Letta/LangMem pricing; SES/Resend prices; Cloudflare DLS pricing and R2 jurisdiction for India.
- Biggest financial unknown: court-data API pricing (Surepass, eCourtsIndia, Meon all unpublished). Biggest legal unknowns: eCourts terms of use for automated access, DPDP Act obligations for lawyer-client data and any Bar Council confidentiality rules, and whether Play policy forces Play Billing for a legal SaaS.
- FX (Rs 90/USD), token-usage and OCR-volume assumptions are mine and drive the table; re-run with real telemetry after a pilot.
