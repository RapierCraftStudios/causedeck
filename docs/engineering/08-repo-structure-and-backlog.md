# 08 — Proposed Repository Structure & First Implementation Backlog

Version 0.1 · 2026-10-17 · Status: Proposed. **No code is written until the Stage 0 gate** ([07 §7](../validation/07-validation-plan.md#7-stage-0-decision-meeting-end-of-week-4)), except spikes T1–T5.

---

## 1. Proposed monorepo layout

A single TypeScript monorepo (pnpm workspaces + Turborepo). Research and decision docs stay in this same repo.

```
lawyer-os/
├── README.md                     # index of research/product docs (exists)
├── DECISIONS.md                  # decision log (exists)
├── ASSUMPTIONS.md                # assumptions register (exists)
├── research/raw/                 # cited research notes (exists)
├── docs/                         # strategy, PRD, MVP, risk, validation, engineering (exists)
│   └── adr/                      # architecture decision records (ADR-0001…), one per tech choice
│
├── apps/
│   ├── mobile/                   # Expo (React Native) app: Android first, iOS via TestFlight
│   │   ├── app/                  # expo-router screens: (onboarding) (tabs)/today|tomorrow|matters|memory|settings
│   │   ├── features/             # feature folders: matters, hearings, voice, orders, drafts, memory, fees, lookup
│   │   └── native/               # config plugins (share-intent, secure store, biometrics)
│   ├── web/                      # Expo web / PWA build target sharing features; desktop = installable PWA
│   └── worker/                   # Node worker: AI jobs (pg-boss), digest, STT, OCR, cite-check, memory extraction
│
├── packages/
│   ├── domain/                   # pure TS: entities, validation (zod), next-date provenance rules, deadline math
│   ├── db/                       # SQL migrations, RLS policies, PowerSync sync rules, typed queries
│   ├── sync/                     # PowerSync client setup + offline queue adapters
│   ├── ai-gateway/               # provider adapters (bedrock-in, sarvam, anthropic), router, budgets, audit log
│   ├── ai-tasks/                 # typed AI functions + prompts + JSON schemas: digestOrder, structureVoiceNote,
│   │                             #   draftClientUpdate, fillTemplate, proposeMemory, extractCitations
│   ├── citations/                # citation regexes (SCC/AIR/SCR/INSC/HC neutral), resolver (Indian Kanoon API)
│   ├── courts/                   # court/forum master data (launch city) + eCourts page parsers (device-side)
│   ├── templates/                # DOCX templates + docxtemplater fill + court format presets
│   ├── ui/                       # design system (tokens, components), Devanagari-safe typography
│   └── config/                   # eslint, tsconfig, prettier presets
│
├── evals/
│   ├── gold/                     # gold sets (orders, voice notes): stored encrypted / out of git (LFS + access control)
│   ├── runners/                  # eval scripts: accuracy, hallucinated-date check, cost/latency report
│   └── reports/                  # dated eval outputs (markdown)
│
├── infra/
│   ├── supabase/                 # project config, region notes, backups/PITR settings
│   ├── powersync/                # sync rules, self-host compose file (escape hatch)
│   ├── vm/                       # worker + analytics VM provisioning (Mumbai)
│   └── runbooks/                 # incident (CERT-In 6h), DPDP breach, restore, key rotation, on-call
│
├── compliance/
│   ├── rule36-checklist.md       # pre-launch feature gate (⚖ counsel-approved)
│   ├── subprocessors.md          # public list
│   ├── data-map.md               # what data, where, retention, purpose
│   └── legal-review-log.md       # counsel questions/answers with dates
│
├── spikes/                       # throwaway Stage 0 spikes T1–T5 (deleted or promoted after)
└── .github/workflows/            # CI: typecheck, test, lint, RLS tests, evals (on prompt/model change), SCA
```

**Conventions**
- Pure domain logic lives in `packages/domain`, with no React or I/O, so it can be fully unit-tested.
- Every AI task is a pure-ish function: `(input, ctx) → schema-validated output + anchors`. Prompts are versioned next to their schema, and a prompt or model change triggers the eval CI job.
- Every tenant table has `owner_id`; `chamber_id` is added in v2. RLS policies and PowerSync sync rules are generated from one policy file.
- No content in analytics events. A lint rule bans logging fields tagged `@sensitive`.

## 2. Core data model (MVP)

```
user(id, name, enrolment_no?, bar_council?, role, home_courts[], prefs jsonb, created_at)
forum(id, name, type[district|hc|sc|tribunal|commission|other], district, state, ecourts_codes jsonb)
matter(id, owner_id, title, forum_id, case_type, case_no, case_year, cnr?, side, stage, status, tags[], created_at)
party(id, owner_id, name, role[client|opposite|counsel_opp|other], phone?, email?, lang?)
matter_party(matter_id, party_id, role)
hearing(id, matter_id, date, purpose?, item_no?, courtroom?, outcome?, notes?, created_from)
next_date(matter_id PK, date, status[confirmed|proposed|unknown|disposed], source_type[manual|voice|order|ecourts], source_ref, confirmed_by, confirmed_at)
date_proposal(id, matter_id, date, source_type, source_ref, quote, page?, created_at, resolved[accepted|rejected])
task(id, matter_id, title, due_date?, done, source_ref)
document(id, matter_id, kind[order|judgment|draft|evidence|other], storage_key, sha256, pages, text_extracted bool, created_at)
order_digest(id, document_id, next_date?, directions jsonb[{text, page, quote}], deadlines jsonb, bench?, model, prompt_version, confirmed bool)
voice_note(id, matter_id, storage_key, duration_s, transcript, structured jsonb, audio_expires_at)
draft(id, matter_id, template_id, version, storage_key, citations jsonb, consistency jsonb, exported_at?)
template(id, owner_id?, name, court_preset, fields jsonb, storage_key)
memory_item(id, owner_id, scope[profile|preference|template|matter], matter_id?, key, value, source_ref, status[proposed|saved|deleted], last_used_at)
memory_embedding(memory_item_id, embedding vector)   -- hard-deleted with item
fee_entry(id, matter_id, kind[agreed|received], amount_paise, mode[upi|cash|bank|other], date, note)
ai_audit(id, owner_id, task, model, provider, region, input_refs jsonb, tokens_in, tokens_out, cost_paise, user_action[confirmed|edited|rejected|none], created_at)
entitlement(owner_id, plan, valid_until, source[pilot|razorpay|play])
```

## 3. Milestones (Stage 1: weeks 5–16, 1–2 builders)

| Milestone | Weeks | Theme | Exit demo |
|---|---|---|---|
| **M0** | Stage 0 (wks 0–4) | Spikes + foundations | T1–T5 reports; repo scaffold; CI; ADRs 0001–0006 |
| **M1** | 5–7 | Diary core, offline | Add matters, set next dates, Tomorrow/Today, reminders, offline, all on a ₹10k Android phone |
| **M2** | 8–10 | Voice + orders (AI pipeline v1) | Record a hearing → confirmed next date + tasks; share an order PDF → anchored digest; client update shared to WhatsApp |
| **M3** | 11–13 | Memory, templates, citations, lookup | Memory screen; adjournment draft in DOCX using memory; citation check; consistency check; device-side eCourts lookup (if cleared) |
| **M4** | 14–16 | Hardening + pilot launch | Pentest fixes, export/delete, AI audit view, founding-member payment, onboarding polish; 30 pilot users live |

## 4. Backlog with acceptance criteria

Format: **ID — Story** (size S/M/L) · *Acceptance criteria* (Given/When/Then or checklist). PRD refs in brackets.

### M0 — Foundations & spikes (Stage 0)
- **E0-1 — Monorepo scaffold & CI** (M)
  - pnpm + Turborepo; `apps/mobile`, `apps/web`, `apps/worker`, `packages/*` per §1.
  - CI runs typecheck, lint, unit tests and an SCA scan on every PR. Main branch is protected.
- **E0-2 — ADRs** (S)
  - ADR-0001 client framework, 0002 sync engine, 0003 DB and region, 0004 LLM routing and residency, 0005 STT/OCR, 0006 court-data approach.
  - Each records the alternatives, the evidence links to raw/06, and a revisit trigger.
- **E0-3 — Spike T1: device-side eCourts lookup** (M)
  - A throwaway Expo screen with a WebView to official case-status pages.
  - Parses next date, stage and orders list from the result DOM for district, HC and SC.
  - Report has a success rate over 30 lookups per type and the failure modes. A ⚖ question has been sent to counsel.
- **E0-4 — Spike T2: order digest eval** (M)
  - The gold-set schema is defined. At least 100 orders are labelled (target 200 by the gate).
  - The runner reports next-date accuracy, directions recall, hallucinated-date count, p95 latency and ₹/digest for two providers.
- **E0-5 — Spike T3: Hinglish STT** (S)
  - 30 noisy voice notes are transcribed.
  - Report has WER plus date-capture accuracy after structuring.
- **E0-6 — Spike T5: perf baseline** (S)
  - 500 seeded matters on a low-end Android device.
  - Cold start, Tomorrow render time and sync time are recorded.

### M1 — Diary core, offline (weeks 5–7)
- **E1-1 — Auth & onboarding** (M) [FR-P1, UJ-1]
  - Google and email magic-link sign-in work on Android and web.
  - Onboarding captures role, home courts (from the launch-city master list) and reminder time.
  - Median time from first open to the first matter added is under 3 min in internal tests.
- **E1-2 — Schema, RLS & sync rules** (L) [FR-P2]
  - Migrations for the §2 MVP tables.
  - RLS on all tenant tables. PowerSync sync rules are scoped to `owner_id`.
  - **Tenancy tests:** user B cannot read or write user A's rows via SQL, REST or sync. The test fails CI if broken.
- **E1-3 — Matters CRUD + quick-add + timeline** (M) [FR-M1–M3, M5]
  - Quick-add with title, forum and date in ≤ 3 taps after the form opens.
  - The timeline shows hearings, notes, documents and fees in date order.
  - Custom forums can be added.
- **E1-4 — Canonical next date with provenance** (M) [FR-H1, H5, H6]
  - Each matter has 0 or 1 confirmed next date with a source type and reference.
  - A new proposal that conflicts with a confirmed date shows a conflict banner and does **not** overwrite. The user chooses.
  - Matters with no next date, or with a past date and no recorded outcome, appear in Needs Attention.
- **E1-5 — Today/Tomorrow views** (M) [FR-H2]
  - Grouped by forum, then courtroom, with item number and stage shown when present.
  - A per-matter checklist ("carry") is editable.
  - Renders in < 300 ms with 500 matters on the reference device, offline.
- **E1-6 — Reminders** (M) [FR-H3]
  - Evening-before push at the user's time and a morning summary.
  - Post-hearing nudge at 6 pm if a hearing had no outcome recorded.
  - Notifications show counts only, never party names, unless the user opts in.
  - Works when the app is killed (scheduled local notifications + server fallback).
- **E1-7 — Offline & sync conflict policy** (M) [FR-P2]
  - Create, edit and delete offline, then sync on reconnect.
  - Field-level last-writer-wins, except next date, which goes through proposal and confirmation.
  - An automated test simulates two devices editing the same matter and verifies there is no next-date loss.
- **E1-8 — App lock & local encryption** (S) [FR-P3]
  - Biometric or PIN lock with a configurable timeout. The local DB is encrypted.
  - Remote sign-out from settings revokes the other device's sessions within 1 min.

### M2 — Voice, orders, updates (weeks 8–10)
- **E2-1 — AI gateway** (L)
  - Provider adapters for Bedrock India and Sarvam, plus first-party Anthropic behind a flag that is off by default.
  - Per-task model routing. Per-user monthly budget with an 80% alert and a hard stop for the free tier.
  - Every call writes an `ai_audit` row with model, region, tokens and ₹ cost.
  - "India-only AI mode" is on by default and enforced. Non-India providers are unreachable while it is on, and a unit test proves it.
- **E2-2 — Document ingest** (M) [FR-D1, D2]
  - The Android share sheet accepts PDF and images into a chosen matter; web accepts drag-drop.
  - The text layer is detected, OCR is used as fallback, and pages are counted. Files are stored in the India region with sha256 dedupe.
- **E2-3 — Order digest** (L) [FR-D3, H7]
  - Output schema: next date, directions[], deadlines[], bench, outcome.
  - **Every** field carries a page and a verbatim quote. Fields without a quote are dropped.
  - A date that does not appear in the source text is rejected by a validator; the hallucinated-date check is post-hoc string matching.
  - The user confirms or edits each proposed date, and confirmation creates the next date or tasks.
  - On the gold set: next date ≥ 98%, directions recall ≥ 90%, hallucinated dates = 0.
- **E2-4 — Voice note capture & structuring** (L) [FR-V1–V4]
  - Record up to 3 min offline. The upload queue retries.
  - The transcript is shown with the structured fields (outcome, next date, directions, tasks), and the date needs a tap to confirm.
  - Raw audio is auto-deleted after 30 days (configurable). The transcript remains until the user deletes it.
  - p95 end-to-end ≤ 20 s for a 1 min note.
- **E2-5 — Typed quick note** (S) [FR-V3]
  - The same structuring path as voice. Works offline as plain text and structures later.
- **E2-6 — Client update draft & share** (M) [FR-CL1, CL2]
  - Generates ≤ 400 characters in the client's language (EN or HI) from the latest confirmed hearing.
  - The user edits, then shares via an OS share or WhatsApp deep link.
  - **No** server-side sending exists in the codebase, and a code-review checklist item covers it.
  - The draft never includes other matters' data, enforced by a test.

### M3 — Memory, templates, citations, lookup (weeks 11–13)
- **E3-1 — Memory v0** (L) [FR-ME1–ME6]
  - AI-proposed memories appear as a confirm card with Save, Edit or Dismiss. Nothing is saved without confirmation.
  - The Memory screen lists items by scope with source and last-used date. Edit, delete and pause all work.
  - Retrieval for a matter includes only that matter's facts plus user-scope items, enforced in SQL. A cross-matter leakage test with synthetic data must find zero leaks.
  - Deleting an item hard-deletes its embedding within 24 h (job + test).
- **E3-2 — Templates & DOCX export** (L) [FR-T1–T3, T5, T6]
  - 3 system templates for the launch city, reviewed by a practising advocate.
  - User DOCX upload with `{{field}}` placeholders is validated.
  - The model fills only `{{narrative:*}}` blocks. The output schema has no citation field, and any authority-like string in model output is flagged.
  - Export to DOCX and PDF with court preset formatting. The "AI-assisted" flag is in the document properties.
- **E3-3 — Citation checker** (M) [FR-T4]
  - Detects SCC, AIR, SCR, INSC neutral citations, the launch HC's neutral citation format, and "X v. Y" names.
  - Resolves via the Indian Kanoon API and caches by citation string.
  - Shows ✔ (with link), ✖ or ?. Exporting a draft with any ✖ requires a typed acknowledgement, which is logged.
  - Precision test: 100 known-good and 30 fabricated citations; false ✔ = 0, recall of real citations ≥ 90%.
  - IK attribution is shown as their terms require.
- **E3-4 — Draft consistency check** (S) [FR-T8]
  - Flags party names, case number, court and dates in the draft that differ from the matter record, and flags annexure references with no matching document.
  - Runs on export.
- **E3-5 — Device-side eCourts lookup** (L) [FR-C1–C3] *(only if T1 + counsel clear it)*
  - The user opens a lookup from a matter. An in-app browser loads the official page and the user solves the captcha.
  - With consent, the parser reads next date, stage and orders. Results become proposals (never auto-confirmed) with source and fetch timestamp.
  - Order PDFs download only when the user taps.
  - No server-side request to eCourts exists in the codebase.
- **E3-6 — Fee log** (S) [FR-CL3]
  - Entries for amounts agreed and received, with mode and date. The matter shows the outstanding amount, and a list shows outstanding across matters.
  - Amounts are stored in paise.

### M4 — Hardening & pilot launch (weeks 14–16)
- **E4-1 — Export & delete** (M) [FR-P4, J15]
  - One-tap export to a ZIP of JSON, CSV, original files and drafts, with a link valid for 24 h.
  - Account deletion removes all rows, files and embeddings within 30 days, with a confirmation email. The process is documented in data-map.md.
- **E4-2 — AI audit view** (S) [FR-P8]
  - The user sees a list of AI actions with task, model, region, date and their own action. It can be exported.
- **E4-3 — Founding-member entitlement** (S) [FR-P5]
  - A Razorpay payment link payment, recorded via webhook, unlocks Pro until the end date. A manual admin override exists.
  - No in-app purchase flow that breaches store policy (checked against current Play policy).
- **E4-4 — Security hardening & pentest** (L)
  - OWASP MASVS-L1 checklist complete. Secrets are in a manager. 2FA is on all consoles.
  - External pentest done; all high and critical findings fixed and retested.
- **E4-5 — Runbooks & compliance artefacts** (M)
  - CERT-In 6 h incident runbook with a named owner. DPDP breach runbook drafted.
  - 180-day India log retention configured. Sub-processor list and data map published.
  - The Rule 36 checklist has been applied to every shipped feature and signed off by counsel ⚖.
- **E4-6 — Onboarding polish & help** (M)
  - First-run checklist (add 5 matters, set reminder, try a voice note).
  - In-app FAQ and WhatsApp support link.
  - Activation instrumented without capturing content.
- **E4-7 — Pilot launch** (S)
  - 30 users from the Stage 0 waitlist are onboarded in person or by call.
  - The weekly metrics dashboard (WCH, activation, retention, AI acceptance, ₹/user) is live.

## 5. Definition of done (all stories)
- Typecheck, lint and tests pass. RLS and tenancy tests pass.
- No sensitive fields in logs or analytics; this is linted.
- AI stories: the eval suite passes its thresholds, and prompt and model versions are recorded.
- Accessibility labels are present. Devanagari rendering has been checked where text can be Hindi.
- Docs are updated: the PRD reference is ticked, and an ADR is added if a tech choice changed.
- For any feature that touches clients, profiles, messaging or external parties, the **Rule 36 checklist** is applied.

## 6. Initial ADR list (to write in M0)
| ADR | Title | Proposed decision |
|---|---|---|
| 0001 | Client framework | Expo/React Native + web; PWA for desktop |
| 0002 | Offline sync | PowerSync (Cloud → self-host option) |
| 0003 | Database & residency | Postgres in Mumbai (Supabase; confirm region) with RLS + pgvector |
| 0004 | LLM routing & residency | Bedrock India profile; India-only mode default; gateway abstraction |
| 0005 | Speech & OCR | Sarvam primary; vision-LLM fallback |
| 0006 | Court data | Device-side, user-driven lookup only; no server-side automation (⚖) |
| 0007 | Memory architecture | Typed rows + pgvector; matter-scoped retrieval in SQL; no memory SaaS |
| 0008 | Payments | Razorpay links → subscriptions; Play alternative billing evaluation |
