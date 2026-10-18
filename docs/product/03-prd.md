# 03 — Product Requirements Document: Lawyer OS

Version 0.1 · 2026-10-17 · Status: Draft for validation · Related: [Thesis](../strategy/02-product-thesis-and-segmentation.md) · [MVP](../mvp/04-mvp-definition.md) · [Risks](../risk/06-risk-register.md) · [Decisions](../../DECISIONS.md)

> This PRD covers the **long-term product** and tags every requirement with its release: **MVP** (M), **v1** (≈ 6 months after MVP), **v2** (chamber + compliant CRM), **Later**. The [MVP document](../mvp/04-mvp-definition.md) carries the ruthless cut.

---

## 1. Problem statement
Young Indian litigators handle dozens to hundreds of matters across several courts. Each court's next dates, item numbers and directions change daily. The information is spread across the eCourts portal (behind a captcha and unstable), cause-list PDFs, WhatsApp messages from clerks, paper diaries and order PDFs. Missing a date or a compliance direction damages the client and the lawyer's standing.

Drafting means reusing old Word files. Client updates are ad hoc calls. Fees are tracked in memory. Free AI tools help with drafting but now carry *misconduct* risk if they invent citations. No affordable tool joins these together or learns the lawyer's own way of working.

## 2. Goals & non-goals

**Goals**
- G1. No missed hearings. Every active matter always shows a correct, confirmed next date with its source.
- G2. Cut the daily admin overhead (diary, cause list, updates) by at least 30 minutes per lawyer per day [target, to validate].
- G3. Give AI help that is safe for court use: grounded in the lawyer's own material, with no fabricated authority.
- G4. Build a lawyer-owned, exportable memory of their practice: matters, preferences, templates and history.
- G5. Stay affordable for Gen Z lawyers and profitable on a lean cost base.

**Non-goals** (see D-001, D-006, D-007)
- Legal-research corpus or citator; outcome prediction or judge analytics.
- Any prospect marketing, lead generation, directory, ratings or advertising tooling.
- Consumer-facing legal advice.
- E-filing submission on the user's behalf (Later at the earliest, and only as hand-off).

## 3. Users
Primary: **S1 junior in a chamber**, **S2 young independent litigator**. Funnel: **S3 law student / intern**. Expansion: **S4 senior with a small chamber** (v2). See [segmentation](../strategy/02-product-thesis-and-segmentation.md#4-segmentation).

## 4. Jobs-to-be-done

| ID | When… | I want to… | So that… | Segment | Release |
|---|---|---|---|---|---|
| J1 | it's evening before court days | see every matter listed tomorrow, by court, bench, item number and what to carry | I walk in prepared and never miss a listing | S1, S2 | M |
| J2 | a hearing just ended | record what happened in under 60 seconds (voice or tap) | the next date, directions and tasks are captured before I forget | S1, S2 | M |
| J3 | an order or judgment is uploaded | get the next date, directions and compliance deadlines extracted with the source line | I don't have to read 20 pages on my phone to find the operative part | S1, S2 | M |
| J4 | I add a new matter | enter it in seconds (CNR paste, eCourts lookup, order photo, or manual) | the diary is complete without data-entry pain | S1, S2 | M |
| J5 | a client asks "what happened?" | generate a short update in English or Hindi and send it myself on WhatsApp | clients stay informed without long calls | S2 | M |
| J6 | I need a routine document (adjournment, exemption, vakalatnama particulars, notice) | draft it from *my* template with the matter facts filled in | it's done in minutes, in my style, with no invented law | S1, S2 | M (2–3 templates) → v1 |
| J7 | I'm finalising a draft with case citations | check every citation exists and links to the real judgment | I don't commit misconduct by citing hallucinated cases | S1, S2 | M (late) |
| J8 | I start working on a matter again after weeks | see the matter timeline, last order digest, open tasks and remembered facts | I'm up to speed in a minute | S1, S2 | M |
| J9 | I teach the app my preferences (courts I practise in, drafting style, salutation formats) | have it remember them, and see and edit what it remembers | outputs fit my practice without repeating myself | S1, S2 | M (basic) |
| J10 | a limitation or compliance period starts | get a calculated deadline with the rule shown, which I confirm | I don't miss limitation | S2 | v1 ⚖ |
| J11 | I receive fees by UPI or cash | log them against the matter and see outstanding amounts | I know who owes what | S2 | M (fee log) → v1 (invoices with GST/RCM) ⚖ |
| J12 | a new person approaches me for a case | record the enquiry and run a conflict check against my matters and parties | I avoid conflicts and keep intake organised | S2 | v1 |
| J13 | I lead a chamber | see all matters, who's attending, and what happened today | I supervise juniors without phone calls | S4 | v2 |
| J14 | I work on a laptop | use the same diary and drafts on a large screen, offline-tolerant | drafting and planning are comfortable | S1, S2 | M (web/PWA) → Later (native desktop) |
| J15 | I want to leave the product | export everything (matters, notes, documents, memory) in open formats | I own my practice data | All | M |

## 5. User journeys

### UJ-1 Onboarding (target ≤ 7 minutes to first value)
1. Sign in with Google or a passkey (phone OTP fallback).
2. Choose role (junior / independent / student) and pick home courts from a list (e.g. "Delhi HC", "Saket District Court").
3. Add matters through any of four paths:
   - (a) paste CNR(s) for an eCourts lookup, triggered by the user;
   - (b) photograph a diary page or a cause-list printout, then OCR, then confirm rows;
   - (c) upload a recent order PDF, then extract;
   - (d) manual quick-add with title, court, next date and stage.
4. Set the reminder time (default 8 pm the day before) and the morning summary (7 am).
5. First value: the **Tomorrow** screen fills in. The app prompts the user to try a voice note after the next hearing.

### UJ-2 Evening prep ("Tomorrow")
Notification at 8 pm: "5 matters tomorrow — Saket (3), Delhi HC (2)". The Tomorrow view is grouped by court and courtroom. Each card shows:
- matter title, item number (if known) and stage;
- the last order digest in 2 lines;
- open tasks, with documents to carry as a checklist;
- the client's phone (tap to call).

The user can add a note or assign the matter to a colleague. Assignment comes in v2; in the MVP it is "share card to WhatsApp".

### UJ-3 After the hearing (target ≤ 60 seconds)
1. Open the matter, tap the mic, speak: *"Arguments part heard, Respondent to file reply in 2 weeks, next date 14 November, carry the original agreement."*
2. Speech-to-text runs, then structuring. The app shows fields: **Outcome**, **Next date: 14 Nov 2026 ⚠ confirm**, **Directions**, **Tasks** (carry original agreement; reminder for respondent's reply by 31 Oct).
3. The user taps Confirm. The next date is now canonical, and the source is shown as "voice note, 17 Oct, 12:41".
4. Optional: "Draft client update" produces a 3-line message in English or Hindi. The user edits it and taps share, which opens WhatsApp. The app never sends to clients on its own.

### UJ-4 Order arrives
1. The user shares the order PDF from the browser or WhatsApp into the app (Android share sheet), or the app finds it via a user-triggered eCourts lookup.
2. Text extraction runs, using OCR if needed. The digest shows the operative directions, next date, compliance deadlines and bench, each with a **page and quote anchor**.
3. If the extracted date differs from the diary date, a conflict banner appears ("Order says 14 Nov; diary says 12 Nov. Which is correct?").

### UJ-5 Template draft + citation check
1. In a matter, the user taps **Draft**, chooses a template (e.g. "Application for adjournment — Delhi District Courts"), and the fields are pre-filled from the matter and from memory (counsel name, enrolment number, court format preferences).
2. The model fills the narrative sections only. Authorities are never generated; the user can paste them.
3. Citation check runs on export: each citation is shown as ✔ (linked), ✖ not found, or ? ambiguous. Export with a ✖ requires an explicit acknowledgement, which is logged.
4. Export to DOCX/PDF, or share.

### UJ-6 Memory
- After a few uses the app suggests: "Save preference: *You sign as 'Advocate for the Petitioner' with enrolment D/1234/2025*?" The user can choose [Save] / [Edit] / [Dismiss].
- The **Memory** screen lists Profile, Preferences, Templates and per-matter Facts. Each item shows its source and last-used date, and can be edited or deleted. A global "pause memory" toggle is available.

### UJ-7 Fee log (MVP) → invoice (v1)
Log a payment (amount, mode UPI/cash/bank, date, matter). The matter shows fees agreed, received and outstanding. In v1: generate an invoice with GSTIN, an RCM legend for business clients and SAC code (⚖ CA review), and a client-expense ledger separate from fees (BCI Rules 25–30).

## 6. Functional requirements

Priority is MoSCoW **within the release**. IDs are stable so the backlog can reference them.

### 6.1 Matters & parties
| ID | Requirement | Rel. | Pri |
|---|---|---|---|
| FR-M1 | Create, edit and archive a matter: title, court/forum, case type/number, CNR (optional), year, side (petitioner/respondent/etc.), stage, client(s), opposing parties, opposing counsel, tags | M | Must |
| FR-M2 | Matter timeline: hearings, orders, notes, voice notes, documents and payments in chronological order | M | Must |
| FR-M3 | Quick-add with only title + court + next date | M | Must |
| FR-M4 | Bulk add by pasting several CNRs or from a photographed list (OCR, then a confirm grid) | M | Should |
| FR-M5 | Court / forum master list with district, establishment and courtroom; user can add custom forums (tribunals, commissions, arbitration) | M | Must |
| FR-M6 | Party/contact records shared across matters; conflict search (fuzzy) | v1 | Must |
| FR-M7 | Matter assignment to chamber members; roles (owner, editor, viewer) | v2 | Must |

### 6.2 Hearings, dates, reminders
| ID | Requirement | Rel. | Pri |
|---|---|---|---|
| FR-H1 | Each matter has exactly one **canonical next date** with a provenance record (manual / voice / order digest / eCourts lookup, plus timestamp) | M | Must |
| FR-H2 | **Tomorrow** and **Today** views grouped by court/courtroom, with item number, stage and checklist | M | Must |
| FR-H3 | Configurable reminders: evening-before push, morning summary, overdue "no update recorded after hearing" nudge | M | Must |
| FR-H4 | Calendar view (week/month) plus export as ICS feed (private URL) | M | Should |
| FR-H5 | Conflict detection when date sources disagree; never auto-overwrite a user-confirmed date | M | Must |
| FR-H6 | Matters with no next date (disposed / sine die / unknown) shown in a "needs attention" list | M | Must |
| FR-H7 | Compliance deadlines from directions (e.g. "reply in 2 weeks"), calculated from the order date, user-confirmed | M | Should |
| FR-H8 | Limitation calculator from a counsel-reviewed rule table | v1 | Should ⚖ |
| FR-H9 | WhatsApp reminder to *self* (utility template) as a push alternative | v1 | Could |
| FR-H10 | **Live item position**: for courts that publish a public display board, the user can opt in to have the app poll it while they are in court and alert them when the board is N items from theirs ("Court 12 is at item 31, you are 37"). This is evidence-light but likely high-value (05b §2a) | v1 | Should ⚖ (spike T4) |
| FR-H11 | Certified-copy and registry-defect tracker per matter (applied on, received on, defects raised or cured), feeding the limitation exclusion inputs | v1 | Should |

### 6.3 Court data (see D-003)
| ID | Requirement | Rel. | Pri |
|---|---|---|---|
| FR-C1 | User-initiated lookup by CNR for the user's own matters. The captcha is shown to and solved by the user, or a relay is used only if counsel clears it. Results are shown with source and fetch time | M | Should ⚖ |
| FR-C2 | Parse the case-status page into structured fields (next date, stage, last orders list) | M | Should |
| FR-C3 | Download linked order PDFs on user action and attach them to the matter | M | Should |
| FR-C4 | Cause-list ingestion from a user-supplied PDF (court cause list): match listed items to the user's matters by case number / advocate name | v1 | Should |
| FR-C5 | Licensed court-data API adapter (if the economics work) | Later | Could |
| FR-C6 | The system must work fully with zero automated court data (manual + PDF + voice) | M | Must |

### 6.4 Documents & orders
| ID | Requirement | Rel. | Pri |
|---|---|---|---|
| FR-D1 | Attach PDFs, images and DOCX to a matter (share sheet on Android/iOS, drag-drop on web) | M | Must |
| FR-D2 | Text extraction (PDF text layer first, OCR fallback incl. Hindi) | M | Must |
| FR-D3 | **Order digest**: next date, directions, compliance deadlines, bench and outcome, each with page + quote anchors, all user-confirmable | M | Must |
| FR-D4 | Version history for user drafts (each export or save creates a version; diff view on web) | M | Should |
| FR-D5 | Translation of orders (Hindi ↔ English), labelled "unofficial machine translation" | v1 | Could |
| FR-D6 | Chat with a matter's documents (RAG scoped to one matter, page-cited) | v1 | Should |
| FR-D7 | Redaction helper for sensitive party names (minors, victims) | v1 | Could |

### 6.5 Notes & voice
| ID | Requirement | Rel. | Pri |
|---|---|---|---|
| FR-V1 | Voice note (≤ 3 min) per matter, offline capture with later upload | M | Must |
| FR-V2 | Transcription (English, Hindi, Hinglish) + structuring into outcome / next date / directions / tasks; editable; date requires confirmation | M | Must |
| FR-V3 | Typed quick-note with the same structuring | M | Must |
| FR-V4 | Raw audio auto-deleted after N days (default 30), configurable | M | Must |

### 6.6 Drafting & citation safety
| ID | Requirement | Rel. | Pri |
|---|---|---|---|
| FR-T1 | Template library: system templates (2–3 at MVP) + user templates (upload DOCX with {{fields}}) | M | Must |
| FR-T2 | Field fill from the matter + memory; model fills only marked narrative blocks | M | Must |
| FR-T3 | **No model-generated authorities.** The output schema forbids citations unless they are user-inserted | M | Must |
| FR-T4 | **Citation checker**: detect citations (SCC, AIR, SCR, INSC neutral citations, HC neutral citations, case names), resolve them via Indian Kanoon API or official sources, mark ✔/✖/? with links; export with ✖ requires a logged acknowledgement | M | Should |
| FR-T5 | DOCX and PDF export preserving court formatting (margins, font, line spacing presets per court) | M | Must |
| FR-T6 | "AI-assisted" disclosure stamp in document properties, plus an optional footer | M | Should |
| FR-T7 | Style learning from uploaded past drafts (user-approved clause bank) | v1 | Could |
| FR-T8 | **Draft consistency check**: flag party names, dates, case numbers and annexure references in a draft that don't match the matter record. This targets copy-paste errors from old drafts (05b §2e). Deterministic first, AI-assisted later | M (late) | Should |

### 6.7 Memory (see D-005)
| ID | Requirement | Rel. | Pri |
|---|---|---|---|
| FR-ME1 | Memory classes: Profile, Preferences, Templates/Playbooks (user scope); Matter facts (matter scope) | M | Must |
| FR-ME2 | Confirm-before-save for any AI-proposed memory | M | Must |
| FR-ME3 | Memory screen: list, search, edit, delete, pause; shows source and last used | M | Must |
| FR-ME4 | When a memory influences output, it is cited inline ("used: your preferred prayer format") | M | Should |
| FR-ME5 | Retrieval hard-filtered: matter facts are retrievable only within their matter | M | Must |
| FR-ME6 | Hard delete, including derived embeddings, within 24 h of the user deleting | M | Must |
| FR-ME7 | Chamber-shared playbooks (owner-controlled) | v2 | Should |

### 6.8 Clients, updates, fees
| ID | Requirement | Rel. | Pri |
|---|---|---|---|
| FR-CL1 | Client contact per matter (name, phone, email, preferred language) | M | Must |
| FR-CL2 | Draft client update from the latest hearing (EN/HI); user edits; share via OS share sheet / WhatsApp deep link. **No automated sending to clients** | M | Must |
| FR-CL3 | Fee agreement + payment log (amount, date, mode, matter); outstanding summary | M | Should |
| FR-CL4 | Invoice generation with GST/RCM handling; separate client-expense ledger (BCI Rules 25–30) | v1 | Should ⚖ |
| FR-CL5 | Inbound enquiry log + conflict check (no auto-replies, no marketing) | v1 | Could ⚖ |
| FR-CL6 | Read-only client portal / status link authored by the advocate | v2 | Could ⚖ |
| FR-CL7 | Payment links (UPI) for fees, collected directly to the advocate's account (not via a platform wallet) | v2 | Could ⚖ |

### 6.9 Platform & account
| ID | Requirement | Rel. | Pri |
|---|---|---|---|
| FR-P1 | Android app (primary; ~94% of Indian mobile web traffic per StatCounter, Sep 2026), iOS app, and web app (responsive + installable PWA) from one codebase. Tuned for low-RAM Android | M | Must (Android, web) / Could (iOS: TestFlight for pilot only) |
| FR-P2 | Offline-first: full diary readable and editable offline; sync on reconnect; conflict policy = last-writer-wins per field, except canonical next date (requires confirmation) | M | Must |
| FR-P3 | App lock (biometric/PIN), encrypted local store, remote sign-out of devices | M | Must |
| FR-P4 | Full export (JSON + CSV + original files + DOCX drafts) and account deletion | M | Must |
| FR-P5 | Subscription via web checkout (Razorpay/UPI Autopay); Play Billing if policy requires | M (late) | Must |
| FR-P6 | Hindi UI localisation | v1 | Should |
| FR-P7 | Native desktop shell (Tauri) with file-system integration for Word drafts | Later | Could |
| FR-P8 | Audit log of AI actions per user (prompt type, model, sources used, user confirmations) viewable by the user | M | Must |

### 6.10 Explicitly prohibited functionality (guardrails, permanent)
- PR-1 Public directory, profile listing, ratings or reviews of advocates hosted by us.
- PR-2 Outbound messaging to non-clients; campaign tools; lead capture/scoring; ad or SEO tooling; social-post schedulers.
- PR-3 Referral fees, revenue share or commissions linked to legal fees.
- PR-4 Model-generated citations without verification; auto-filing.
- PR-5 Training models on customer content; selling or sharing data.
- PR-6 Consumer-facing legal Q&A.

## 7. Non-functional requirements

| Area | Requirement (MVP unless noted) |
|---|---|
| **Performance** | Cold start < 2.5 s on a ₹10–15k Android device (e.g. 4 GB RAM); Tomorrow view < 300 ms from local DB; voice-note structuring p95 < 20 s; order digest p95 < 40 s for 20 pages |
| **Offline** | All diary reads and writes offline; queued AI jobs run when online; no data loss across 7 days offline |
| **Reliability** | Backend availability 99.5% monthly (MVP), 99.9% (v1); RPO ≤ 24 h (PITR preferred), RTO ≤ 8 h; zero canonical-date loss (sync tests) |
| **Accuracy** | Order digest next-date extraction ≥ 98% on the gold set; directions recall ≥ 90%; voice note date ≥ 97% (always user-confirmed); citation checker false "✔" rate ≤ 0.5% |
| **Security** | TLS 1.2+; AES-256 at rest; Postgres RLS on all tenant tables; per-tenant envelope encryption for documents (v1); OWASP MASVS-L1 for mobile; secrets in a manager; 2FA on all admin consoles; external pentest before paid launch |
| **Privacy** | Data minimisation; India-region primary storage and logs (D-009); AI vendors must be no-training + zero/short retention; sub-processor list public; DPDP processor terms; user export and delete within 30 days (delete memory/embeddings within 24 h) |
| **Compliance** | CERT-In: 6 h incident reporting runbook, 180-day logs in India, NTP sync; DPDP breach runbook (Board + principals; 72 h report) before May 2027 |
| **Cost** | Variable AI + infra ≤ ₹100 per Pro user per month at launch (India-resident route), ≤ ₹60 by month 6; ≤ ₹10 per free user per month; alerts at 80% of the per-user AI budget (see [MVP §6](../mvp/04-mvp-definition.md#6-expected-operating-costs)) |
| **Accessibility** | WCAG 2.1 AA on web; Android TalkBack labels; dynamic type; Devanagari rendering verified |
| **Localisation** | English UI at MVP; date formats DD/MM/YYYY; Hindi UI in v1; content (updates, digests) in EN/HI at MVP |
| **Observability** | Privacy-safe product analytics (self-hosted, no content); error tracking with PII scrubbing; AI eval dashboard |
| **Portability** | Open export formats; no proprietary lock-in in data model; LLM gateway abstraction |

## 8. Privacy & security assumptions
(Assumptions are tracked in [ASSUMPTIONS.md](../../ASSUMPTIONS.md); the legal points need ⚖ review.)
1. The **advocate is the Data Fiduciary** for client and matter data. Lawyer OS is a **Data Processor** under a DPA. For account, billing and analytics data, Lawyer OS is the fiduciary.
2. Matter data is treated as **privileged and confidential by default** (BSA s.132; BCI Rules 17, 24). Staff access to content is off by default. Support access requires user-granted, time-boxed consent, and that access is logged.
3. **India residency** is used for the primary DB, object storage, logs and backups. LLM inference goes India-resident through Bedrock in-country where available. Any non-India processor is disclosed, uses zero-retention terms, and can be turned off by the user ("India-only AI mode").
4. **No training** on customer content by us or vendors; this is a contractual and technical control.
5. Court records contain third-party personal data. We store only what the user adds or fetches for their own matters, and we never provide cross-user search.
6. The device is the weakest link: app lock, encrypted SQLite, and no sensitive content in notifications by default.
7. The platform is not a legal adviser. No privilege attaches to communications between the user and the platform's AI. The ToS must be clear about this.

## 9. Architecture principles
1. **Local-first, server-authoritative.** SQLite on device for instant UX and offline use. Postgres (India) is the source of truth. Sync goes through PowerSync (self-hostable).
2. **One TypeScript codebase**: Expo/React Native for Android, iOS and web; PWA for desktop; shared domain packages. Native desktop only when it earns its place.
3. **Boring core, swappable edges.** Plain Postgres (+ pgvector, RLS); an adapter for each external dependency (LLM, STT, OCR, court data, payments, messaging).
4. **AI as a pipeline, not an agent.** Each AI feature is a typed function with a JSON schema in and out, citations or anchors required, and a user confirmation step. No autonomous tool use in the MVP.
5. **Cheapest adequate model first.** Route by task: Haiku-class for extraction and structuring, Sonnet-class only for drafting. Cache prompts. Run non-urgent jobs in batch. Budget per user.
6. **Provenance everywhere.** Every date, direction and memory carries its source (document + page/quote, voice note, manual, eCourts + fetch time).
7. **Tenancy by construction.** Every row has `owner_id` (later `chamber_id`). RLS plus sync rules derive from the same policy. Matter-scoped retrieval is enforced in SQL, not in prompts.
8. **Privacy by default.** Content is excluded from analytics, raw audio has a TTL, no third-party SDKs that phone home with content.
9. **Degrade gracefully.** If court lookup, AI or sync fail, the diary still works.
10. **Everything exportable.**

High-level component view:
```
[Android/iOS app (Expo)]  [Web/PWA (Expo web)]
        │  SQLite + PowerSync client  │
        └──────────────┬──────────────┘
                       ▼
          PowerSync service (sync rules)          ┌─────────────────────────┐
                       │                          │ AI gateway (worker)     │
                       ▼                          │  - route/budget/log     │
   Postgres (Mumbai) + pgvector + RLS  ◄────────► │  - Bedrock India (Claude)│
      │ object storage (S3 Mumbai)                │  - Sarvam STT / OCR      │
      │ job queue (pg-boss)                       │  - IK API (cite check)   │
      ▼                                           └─────────────────────────┘
   Edge/API (Node/TS): auth, uploads, court-lookup relay (⚖), payments webhooks
```

## 10. Success metrics

### North-star metric
**Weekly Confirmed Hearings (WCH):** the number of hearings per week whose outcome and next date were recorded and confirmed in Lawyer OS. It captures habit and trust together.

### Metric tree & targets (first 6 months after MVP launch; targets are hypotheses)
| Layer | Metric | Definition | Target |
|---|---|---|---|
| Acquisition | Signups / week | New verified accounts | 150/wk by month 3 |
| Activation | **Activated user** | ≥ 10 matters added AND ≥ 1 hearing confirmed within 7 days | ≥ 40% of signups |
| Engagement | WAU/MAU | — | ≥ 60% |
| Engagement | Hearings confirmed per active user per week | — | ≥ 5 |
| Retention | Week-8 retention of activated users | Active in week 8 | ≥ 45% |
| Trust / quality | Next-date accuracy | Confirmed date ≠ actual date reported or detected | ≤ 0.5% of hearings |
| Trust / quality | AI digest acceptance | % digests confirmed with ≤ 1 field edit | ≥ 85% |
| Trust / quality | Citation checker misses | Verified ✔ later found wrong | 0 known |
| Monetisation | Free → Pro conversion (S2 activated) | Within 60 days | ≥ 8% |
| Monetisation | Paying users | — | 300 by month 6 |
| Economics | AI + infra cost / Pro user / month | — | ≤ ₹100 at launch → ≤ ₹60 by month 6 |
| Economics | Gross margin | (Revenue − variable costs) / revenue | ≥ 70% |
| Satisfaction | "Very disappointed" if gone (Sean Ellis) | Among activated users | ≥ 40% |
| Safety | Rule-36 / privacy incidents | — | 0 |

### Guardrail metrics
- Missed-reminder incidents (reminder not delivered before a hearing): 0 tolerated. Each one gets a post-mortem.
- Support first response within court-day hours: ≤ 2 h.
- Data-subject requests closed within SLA: 100%.

## 11. Release criteria for MVP launch (summary)
- All "Must" FRs tagged M are shipped and tested.
- Gold-set accuracy targets met.
- Pentest high and critical findings fixed.
- Counsel sign-off on ToS, DPA and privacy policy, the court-lookup approach and ambassador terms (⚖).
- 30 pilot users have used it for ≥ 3 weeks with WCH trending up.

## 12. Open questions
1. Device-side vs relayed eCourts lookup: which is legally cleaner and technically more reliable? (⚖, spike T1)
2. Does the chamber (S4) buy before the solo (S2)? This would change pricing and the v2 order.
3. Is iOS needed at the MVP for the Delhi HC segment, or can it wait?
4. Should the Hindi UI come forward to the MVP if the launch is outside Delhi or Mumbai?
5. Indian Kanoon API: are commercial verification lookups permitted? (A-17)
