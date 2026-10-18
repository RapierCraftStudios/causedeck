# 09 — Capture & Automation Subsystem (formerly "Zero-Entry / Quality-of-Life OS")

Version 0.2.1 · 2026-10-17 · Status: **Subsystem spec under [10 — System architecture](10-lawyer-os-system-architecture.md)**. The product framing in D-016 is superseded by D-024.

> **Read this first (v0.3).** This document no longer defines the product. Lawyer OS is an intelligent operating layer ([10](10-lawyer-os-system-architecture.md)). This file is the normative spec for its **capture and automation subsystem**: channels, the automation ladder L0–L5, approval boundaries, failure recovery, audit, offline behaviour, privacy controls and cost. Three updates apply:
> - Input policy is lawyer-owned first. Client-message forwarding is out by default (D-029).
> - Launch markets are Madras HC and Bengaluru, not Delhi (D-025).
> - Time saved is a secondary metric (D-030).
>
> Sections 2 and 10 (daily workflow map, smallest loop) remain valid as the **capture view** of the OS loop described in [PRD §5](03-prd.md#5-the-core-os-loop-mvp-vertical-slice). · Related: [Thesis](../strategy/02-product-thesis-and-segmentation.md) · [PRD](03-prd.md) · [MVP](../mvp/04-mvp-definition.md) · [Validation](../validation/07-validation-plan.md) · [Risks](../risk/06-risk-register.md)

> **Founder direction (2026-10-17):** lawyers pay because the product makes their life easier, not because it is another database or AI feature. They should spend almost no time entering data. Lawyer OS automates as much non-courtroom work as can be done safely. The lawyer stays the decision-maker and the advocate in court. There is no autonomous filing, no legal advice, no unsupervised commitment to a client, and no unverified citation.

Evidence tags as elsewhere: `[V]` verified, `[R]` reported, `[I]` inference. ⚖ = needs Indian legal review. Most workflow detail below is `[I]`, built from desk research ([01 §4](../strategy/01-research-report.md#4-indian-lawyer-workflows-what-we-know-vs-what-were-assuming), [05b §2](../../research/raw/05b-workflows-deep-dive.md)). It **must be validated** in the Stage 0 time-and-motion study (E1 in [07](../validation/07-validation-plan.md)).

---

## 1. Design principle: "Capture once, confirm once, never re-type"

The lawyer already *receives* almost every fact we need:
- clerk messages and client forwards on WhatsApp;
- order PDFs;
- cause lists;
- registry emails;
- their own voice;
- old drafts on a laptop.

Today the lawyer re-types these facts into a diary, a notes app, a calendar and their memory. **Lawyer OS should ingest what already arrives and turn it into structured practice data.** The lawyer's job shrinks to:
1. **Drop** anything into Lawyer OS (share, forward or speak). One action, no form.
2. **Glance and confirm** what matters (dates, outward messages). One tap.
3. **Decide and advocate.** This stays fully human.

Target experience metrics, which are hypotheses to validate:
- **≤ 1.5 taps per captured item** on average.
- **≥ 80% of fields populated without typing.**
- **≥ 45 minutes of admin saved per court day.**

---

## 2. The complete daily workflow map

Each step is classified as:
- **A**: automate (system does it, visible and undoable)
- **C**: automate, then **confirm** (system proposes, human approves)
- **H**: must stay **human**

"Today" is how the step is likely done now `[I]`. "Inputs we can capture" lists the raw sources.

### 2.1 Evening before court (≈ 7–10 pm)
| # | Step | Today `[I]` | Inputs we can capture | Class | What Lawyer OS does | Human role |
|---|---|---|---|---|---|---|
| E1 | Find out what is listed tomorrow | Open court site / eCourts app; clerk's WhatsApp; check printed list | Cause-list PDF (shared from site or WhatsApp group); clerk's message; advocate-wise list from eCourts app (screenshot or PDF) | **A** (match) / **C** (new matter) | Parse the list on the device and match rows to matters by case no. / CNR / party / advocate name. Mark matched matters "Listed tomorrow, Court 12, Item 37". **Unmatched rows that carry the lawyer's name become "new matter?" proposals** | Confirm new matters (1 tap each) |
| E2 | Note item numbers, courtrooms, bench | Copy into diary | Same | **A** | Fill item, court hall and bench from the list | — |
| E3 | Decide what to carry and prepare | Mental checklist, file pulling | Last order digest, open tasks, documents attached | **A** | Build the **Tomorrow brief**: per matter, last order in 2 lines, open directions, documents to carry, client contact, time-sensitive deadlines | Read, adjust checklist |
| E4 | Coordinate with senior / clerk / juniors | Phone, WhatsApp | — | **C** | Draft a "tomorrow plan" message (who attends where) for the lawyer to share | Decide allocation; send |
| E5 | Tell clients to attend / bring documents | Calls, WhatsApp | Matter + client contacts | **C** | Draft per-client reminder messages (EN/HI) and queue them for **lawyer-sent** sharing | Edit and send personally |
| E6 | Legal preparation for arguments | Read file, research | — | **H** (assist only) | Surface the matter's documents and the lawyer's own notes. Link out to research tools. No legal conclusions | Prepares arguments |

### 2.2 Morning & commute
| # | Step | Today `[I]` | Inputs | Class | What Lawyer OS does | Human role |
|---|---|---|---|---|---|---|
| M1 | Re-check for list changes / supplementary lists | Check site again, clerk calls | Supplementary list PDF; clerk's WhatsApp | **A** / **C** | Re-match on any newly shared list. Diff-alert: "Supplementary list adds Sharma v. State (Item 64)" | Acknowledge |
| M2 | Morning summary | Diary glance | Local data | **A** | 7 am summary: courts, counts, first item, clashes ("two matters at 10:30 in different complexes") | Decide priorities |

### 2.3 In court
| # | Step | Today `[I]` | Inputs | Class | What Lawyer OS does | Human role |
|---|---|---|---|---|---|---|
| C1 | Wait for item; track board | Stand in court, ask clerk, watch display board | Public display board (some courts) | **A** (opt-in, v1 ⚖) | "Court 12 at item 31; you are 37" alert | — |
| C2 | Appear and argue | — | — | **H** | — | **Always human** |
| C3 | Note what happened | Scribble in diary; memory | **Voice note**; photo of a handwritten note | **C** | Transcribe and structure (outcome, next date, directions, tasks) | Confirm next date (1 tap) |

### 2.4 After the hearing (same day)
| # | Step | Today `[I]` | Inputs | Class | What Lawyer OS does | Human role |
|---|---|---|---|---|---|---|
| P1 | Record next date | Write in diary | Voice note; later order PDF; eCourts status | **C** (date-critical) | Propose the next date with its source. Conflict check across sources. Never auto-overwrite a confirmed date | Confirm |
| P2 | Create to-dos from directions | Memory, diary margin | Voice note; order PDF | **A** (internal tasks) / **C** (deadline dates) | Create tasks automatically, e.g. "File reply", "Pay process fee", "Apply certified copy". Deadline dates need confirmation | Confirm deadlines |
| P3 | Update the client | Phone call / WhatsApp | Structured hearing outcome | **C** (outward) | Draft the update in the client's language. Send only via the lawyer's own share action | Edit, **send personally** |
| P4 | Inform senior | Call / WhatsApp | Same | **C** | Draft senior summary | Send |
| P5 | Download & file order | Visit site later; clerk | Order PDF (shared / user-fetched) | **A** (attach) / **C** (dates) | Auto-attach to matched matter; digest with page anchors; cross-check against voice-note date | Confirm if conflict |

### 2.5 Office work (afternoon/evening)
| # | Step | Today `[I]` | Inputs | Class | What Lawyer OS does | Human role |
|---|---|---|---|---|---|---|
| O1 | Intake of new work from clerks, seniors, clients | WhatsApp, calls | Forwarded messages, documents, voice | **C** | Inbox item → proposed new matter (parties, court, case no., documents) + conflict hint | Confirm matter; decide to accept engagement |
| O2 | Routine drafting (adjournment, exemption, vakalatnama particulars, notices, list of dates) | Copy old Word file | Matter data, memory, templates, existing drafts | **C** | Pre-filled draft from the lawyer's template. Narrative blocks only. Consistency check | Review, sign, file (human) |
| O3 | Substantive drafting & legal strategy | Lawyer | — | **H** (assist only) | Organise facts and documents. Citation checker on lawyer-inserted authorities. No generated law | **Human** |
| O4 | Filing, defects, certified copies | Clerk, registry visits, e-filing portal | Registry emails / SMS screenshots / defect memos | **A** (track) / **C** (dates) | Track status from forwarded emails and screenshots: "defect raised on 12 Oct", "certified copy applied 3 Oct". Reminders | Cure defects; file (**human only**) |
| O5 | Fees: record receipts, chase dues | Memory, UPI app | Voice ("received ₹5,000 from Sharma"); UPI screenshot share | **C** | Fee entry proposal (amount, client, matter). Outstanding list. Draft polite reminder for the lawyer to send | Confirm; send reminders personally |
| O6 | Client calls & questions | Phone | Voice note after the call | **C** | Turn the call note into tasks and memory facts | Advise client (**human**) |
| O7 | Research | Indian Kanoon, bar library | — | **H** (link out) | Pre-filled search links. Store the lawyer's research notes in the matter | **Human** |
| O8 | Calendar / personal schedule | Phone calendar, diary | Calendar (ICS) | **A** | Publish hearings and deadlines to the lawyer's calendar (ICS feed). Import from calendar is v1 | — |

### 2.6 Weekly / periodic
| # | Step | Class | What Lawyer OS does |
|---|---|---|---|
| W1 | Review matters without dates / stale matters | **A** | "Needs attention" list: no next date, past date with no outcome, no client update in 30 days |
| W2 | Limitation / compliance horizon | **C** ⚖ | Upcoming deadlines from confirmed directions; limitation tracker in v1, using a counsel-reviewed rule table |
| W3 | Fees outstanding review | **A** | Weekly outstanding summary (private to the lawyer) |
| W4 | Practice insight | **A** | "You saved ~6.5 h this week; 41 items captured; 3 deadlines caught". This also feeds the value metric |

### 2.7 Must always remain human (permanent)
1. Appearing, arguing and negotiating in court or with opposing counsel.
2. Giving legal advice to clients; any statement of legal position to a client.
3. Accepting or declining engagements; fee agreements; any commitment on the lawyer's behalf.
4. Filing, e-filing submission, signing, verifying pleadings and affidavits.
5. Choosing and verifying authorities; legal research conclusions.
6. Sending any message to a client, court, registry, opposing party or third party.
7. Final confirmation of date-critical facts (next date, limitation, compliance deadlines), except as a measured v1 experiment (§4.3).

---

## 3. Capture channels

| Channel | How it works | Cost to user | Privacy note | Release |
|---|---|---|---|---|
| **In-app voice** | Hold-to-talk, offline queue | 0 taps beyond record | Audio TTL 30 days | **MVP** |
| **Android share sheet** ("Share to Lawyer OS") | From WhatsApp (messages, PDFs, images, forwarded voice notes), Gmail, Files, browser, UPI app | 2 taps | Stays inside our India-hosted stack; user-initiated | **MVP** |
| **Camera / photo** | Diary pages, notice boards, handwritten notes, printed cause lists | 1–2 taps | OCR in India (Sarvam) | **MVP** |
| **Cause-list PDFs** | Shared PDF; or one-tap **device-side fetch** of the public list for the lawyer's courts ⚖ | 0–2 taps/day | Parsed on device; only matched rows stored | **MVP** (shared) / **MVP-late** (device fetch, if cleared) |
| **Email forward-in** | Unique private address (e.g. `u-xxxx@in.<domain>`) for forwarding registry, e-filing, client emails | 2 taps | Inbound processed in India region `[I: verify provider region]`; sender allow-list | **MVP-late** |
| **Bulk import of existing documents** | Web drag-drop of a folder of old orders and drafts; Google Drive picker | One-time | Per-file processing; can exclude folders | **MVP** (web, ≤ 200 files) |
| **Calendar out** | Private ICS feed of hearings and deadlines | One-time | Feed URL is a secret; revocable | **MVP** |
| **Calendar in** (Google / Outlook read) | OAuth import of hearing-like events | One-time | Sensitive OAuth scope; Google verification needed `[I]` | v1 |
| **WhatsApp bot number** (forward to Lawyer OS on WhatsApp) | WhatsApp Business Platform; user forwards to our number | 2 taps, no app switch | Messages pass through Meta's Cloud API infrastructure, likely outside India `[I]`. Explicit opt-in + disclosure ⚖ | v1 (opt-in), after counsel + privacy review |
| **Gmail / Outlook mailbox sync** | Read-only label sync | One-time | Restricted Gmail scopes need a paid security assessment `[I: verify cost]`; heavy | Later |
| **SMS / notification reading** | — | — | **Excluded.** Play restricts SMS permissions to default handlers `[I: verify]`; too invasive | Never |
| **Contacts upload** | — | — | **Excluded.** Third-party data; not needed | Never |

**Concierge pilot exception (no code):** the pilot uses a team phone running the **WhatsApp Business *app***. Messages between users on WhatsApp are end-to-end encrypted to that device `[I: verify current WhatsApp Business app encryption terms]`. Processing happens with India-hosted tools under written consent, and the data is deleted when the pilot ends (see [07 §E2](../validation/07-validation-plan.md)).

---

## 4. The automation ladder & approval boundaries

### 4.1 Automation ladder
| Level | Name | What the system may do | Examples | Allowed? |
|---|---|---|---|---|
| **L0** | Manual | Nothing; user types | Free-text note | Always available (fallback) |
| **L1** | Capture | Store the raw input against the inbox or a matter; no interpretation | Voice note saved offline; PDF shared in | ✅ |
| **L2** | Extract & propose | Structure the input into proposals with source anchors; **no state change until accepted** | Next date from an order; new matter from a cause-list row; fee entry from a voice note | ✅ (default for anything date-critical, financial or identity-defining) |
| **L3** | Auto-apply internal, reversible changes | Apply low-risk changes that affect only the lawyer's own workspace; logged in the activity feed with **one-tap undo** | Attach order to the matched matter; add item number and courtroom from a cause list; create an undated task; update a party's phone from a forwarded vCard; mark a matter "listed tomorrow" | ✅ when confidence ≥ threshold and the change is reversible and internal |
| **L4** | Prepare outward action for approval | Fully prepare something that leaves the workspace; human must **send / export / sign** | Client update; senior summary; fee reminder; draft application; calendar invite | ✅. **Send is always the lawyer's own action** |
| **L5** | Autonomous outward or legal action | Act on the world without the human | Auto-send to client; auto-file; give advice; accept engagement; insert authorities; pay fees | ❌ **Prohibited** (PR-1…PR-7) |

### 4.2 Approval boundary matrix
| Data / action class | Default level | Why | Confidence gate |
|---|---|---|---|
| Next hearing date | **L2** | Missing a date is the worst failure (risk A1) | Always a proposal; conflict check |
| Compliance deadlines, limitation | **L2** ⚖ | Legal consequence | Always a proposal; rule shown |
| New matter creation | **L2** | Identity of matter and client; conflict check | Always a proposal |
| Matching an input to an existing matter | **L3** if ≥ 0.9 match score with an exact case-no./CNR match; else **L2** | Reversible; mis-match is recoverable | Exact identifier match required for L3 |
| Attaching documents | **L3** | Reversible, internal | Requires an L3 match |
| Item no. / courtroom / bench from a cause list | **L3** | Same-day, internal, verifiable | Exact case-no. match |
| Undated tasks from directions or notes | **L3** | Internal; deletable | Confidence ≥ 0.8 |
| Party / contact details | **L2** for new people; **L3** for adding a phone/email to a known party | Identity data | — |
| Fee entries | **L2** | Financial record; BCI client-money rules (Rules 25–30) | Always a proposal |
| Memory items | **L2** (confirm-before-save, D-005) | Lawyer controls memory | — |
| Client / senior / third-party messages | **L4** | Outward communication; Rule 36 optics; no unsupervised commitments | Never auto-sent |
| Drafts & exports | **L4** | Professional responsibility; citations | Citation check + consistency check before export |
| Filing, advice, acceptance, payment, authorities | **L5 ❌** | Professional conduct; SC 2026 misconduct rulings | Not built |

### 4.3 Corroborated auto-confirm (v1 experiment only, off by default)
If **two independent sources** agree on a next date, for example the order PDF text plus the user-run eCourts status or the following cause list, a v1 setting *may* auto-confirm it at L3. It would carry an "auto-confirmed (2 sources)" badge, an undo, and a notification. Ship this only if:
- the pilot data show zero disagreements between sources that were wrong in both;
- users opt in.

**Not in the MVP.** (D-022)

### 4.4 Confidence & thresholds
- Each extraction returns field-level confidence plus a **verbatim source anchor** (page/quote, transcript span, list row). A field without an anchor is dropped. A date that does not appear in the source text is rejected.
- Thresholds are tuned on the gold set and tracked per field. When an L3 action is undone, its threshold is raised automatically.
- Low-confidence or unanchored items land in **"Needs you"** in the inbox. They are never dropped silently.

---

## 5. Failure recovery

| Failure | Detection | Recovery UX | System response |
|---|---|---|---|
| Wrong matter matched (L3) | User undo / reassign; later contradicting input | "Moved to wrong matter? → Reassign" from the activity feed; bulk undo for one capture | Undo cascades (attachments, tasks, list data); raise the threshold for that pattern |
| Wrong date proposed | User edit at confirm; conflict with another source | Conflict banner with both sources side by side | Log as an eval case (with consent); never overwrite a confirmed date |
| Unreadable input (bad scan, noisy audio) | Low OCR/STT confidence | "Couldn't read this. Retake, type the key line, or keep as an attachment" | Store raw at L1; no guessing |
| Duplicate captures (same order forwarded twice) | sha256 / near-duplicate text | Auto-merge at L3 with undo | — |
| AI/provider outage | Gateway errors | Captures queue with a "processing later" badge; the diary keeps working | Retry with backoff; failover only to allowed providers (India-only mode respected) |
| Offline in a basement courtroom | No connectivity | Capture and local edits continue; Tomorrow brief is available from local data | Sync on reconnect; extraction runs then |
| Sync conflict | PowerSync conflict | Field-level merge; next date goes through the proposal flow | Test-covered |
| Cause list format changed | Parser yield drops / zero matches | "We couldn't read today's list for Court X. Open the list" fallback | Parser health monitor; per-court fixtures |
| Missed reminder delivery | Push receipt missing | Local scheduled notifications as the primary path; server push as backup | Missed-reminder incident = post-mortem |
| Over-automation distrust | High undo rate | Per-feature "ask me first" toggle (downgrade any L3 to L2) | Per-user automation dial |
| Prompt injection inside forwarded content | Instruction-like text in inputs | No effect: AI has no tools, outputs are schema-validated, and L4/L5 never auto-execute | Flag suspicious inputs |

**Daily safety net:** an end-of-day "What Lawyer OS did today" digest lists every L3 action (undoable for 7 days) and every pending L2 proposal.

---

## 6. Auditability

- **Activity log (user-visible):** every capture → extraction → action, with input source, model and version, region, confidence, level (L1–L4), who confirmed, time, and an undo link. Exportable (CSV/JSON).
- **Provenance on every datum:** dates, tasks, fees, parties and memory items link back to the exact input (document page/quote, transcript span, cause-list row, email message ID).
- **Outward-action log:** every L4 item records "prepared by system", "edited by lawyer (diff)", "shared by lawyer at time". This supports supervision duties and any future BCI AI-disclosure norms (risk L9).
- **AI audit table** (`ai_audit`) as in [08 §2](../engineering/08-repo-structure-and-backlog.md#2-core-data-model-mvp), extended with `automation_level`, `auto_applied`, `undone_at`.
- **Retention:** activity logs for the account's life (user can export or delete); security logs for 180 days in India (CERT-In) and ≥ 1 year (DPDP readiness).

## 7. Offline behaviour (Android-first, low connectivity)

| Function | Offline | Notes |
|---|---|---|
| View diary, Tomorrow/Today, matter files | ✅ Full | Local SQLite |
| Voice / photo / share capture | ✅ Queued | Encrypted local queue; size cap with warning |
| Cause-list matching | ✅ If the PDF is on the device and text-based | Parser runs on device (deterministic); AI fallback queued |
| AI extraction (voice, orders, forwards) | ⏳ Queued | On-device regex pre-parse shows "date mentioned: 14/11?" hint only, never as a proposal |
| Confirmations, edits, undo | ✅ | Synced later; next date uses the proposal/confirm merge |
| Client update drafts | ⏳ (AI) / ✅ (template-only fallback) | Template-only text works offline |
| Reminders | ✅ | Locally scheduled notifications |

## 8. Privacy controls (on top of D-005, D-009)

1. **Per-channel opt-in.** Each capture channel is off until enabled, with a plain-language note on where data goes.
2. **India-only AI mode** is on by default and enforced at the gateway.
3. **Sensitive-matter flag** (e.g. POCSO, matrimonial, medical). It disables AI processing for that matter and excludes it from bulk imports and briefs shared outward.
4. **Raw-input TTLs:**
   - audio: 30 days;
   - forwarded raw text: 30 days after extraction unless pinned;
   - non-matched cause-list rows: never stored (parsed on device, discarded).
5. **Minimal third-party data.** Only parties relevant to the lawyer's matters are stored. No contact-book upload, no SMS or notification reading, and no cross-user people search.
6. **Notification privacy.** Counts only by default; party names only when opted in.
7. **No training, no selling.** Captured content is never used to train models (ours or vendors'). Eval reuse needs explicit per-item consent.
8. **Visibility & control.** The lawyer can see, export or delete any capture and its derived data; derived embeddings are hard-deleted within 24 h.

## 9. Cost implications of zero-entry

Zero-entry multiplies inputs: every capture is processed, not only the ones the user chooses to digest. The figures below are estimates from the [MVP unit costs](../mvp/04-mvp-definition.md#6-expected-operating-costs), India-resident route.

| Input type | Volume / Pro user / month `[I]` | Processing | Est. ₹ |
|---|---|---|---|
| Voice notes (1 min) | 30 | STT + Haiku structuring | 27 |
| WhatsApp/text forwards | 60 | Haiku (short) | 14 |
| Order / document PDFs | 25 (30% scanned, ~4 pp) | Text layer → Haiku; OCR when scanned | 45 |
| Cause lists | 22 | **Deterministic on-device parse/match**; Haiku only for ambiguous rows | 11 |
| Photos / screenshots (diary, UPI receipts) | 20 | OCR + Haiku | 16 |
| Emails forwarded | 15 | Haiku | 5 |
| Briefs (evening + morning) | 44 | Deterministic templating; optional 2-line Haiku summary | 9 |
| Client/senior update drafts | 20 | Haiku | 7 |
| Template drafts | 8 | Sonnet-class | 22 |
| Citation checks | 20 | IK API | 14 |
| Memory proposals (batched) | — | Haiku batch | 3 |
| **Total** | | | **≈ ₹173 / month** (≈ ₹90 if Haiku 5.5-class becomes available in-region) |

**Implications:**
- The **cost lever is deterministic-first**: cause-list matching, dedupe, regex dates and template briefs run without an LLM. AI handles only unstructured text.
- **Price must reflect convenience value.** A munshi reportedly costs ₹15–30k/month `[R, vendor claim]`. Saving ≥ 3 h/week is worth far more than ₹500/month to an independent lawyer, which is a hypothesis (H-WTP2). The price-test arms are revised to **₹399 / ₹699 / ₹999 per month** (D-021). At ₹699 (≈ ₹576 net of GST and fees), contribution after ₹173 is ≈ 70%.
- **The free tier must be capture-capped** (e.g. 40 automated captures/month, manual unlimited) to stay ≤ ₹10/user/month.
- **Bulk import** (one-time, up to 200 files) costs ≈ ₹150–300 per user. Treat it as onboarding CAC, and cap it on free.

---

## 10. The smallest automation loop (concierge pilot target)

**Loop name:** *"Forward it, forget it"*, the hearing-day loop.

```
  (evening)  cause list PDF / clerk message ──► auto-match ──► 8 pm TOMORROW BRIEF
                                                                    │
  (in court) ◄──────────────────────────────────────────────────────┘
  (after)    voice note  /  forwarded order  ──► extract ──► 1-tap confirm next date
                                                         ├─► tasks auto-created (L3)
                                                         ├─► client update drafted (L4, lawyer sends)
                                                         └─► follow-up queue (dues, replies, copies)
```

**Why this loop:**
- It hits the highest-frequency jobs (J1, J2, J5, J8) every court day.
- It replaces the most re-typing: diary entries, notes, client calls.
- It needs only three inputs the lawyer already has: the cause list, their voice, and the order.
- It can be run **by hand** in a concierge pilot with no code (§E2 in [07](../validation/07-validation-plan.md)).

**What "dramatic time saved" must look like** (pilot pass thresholds, see H-TIME):
- ≥ **45 min saved per court day** in median self-timed admin, compared with the baseline week;
- ≥ **80% fewer manual diary entries**;
- **zero** missed listings and ≥ **50% fewer** missed or late follow-ups compared with baseline;
- ≤ **1.5 taps** (or replies) per captured item.

**What is deliberately left out of the loop:** drafting beyond client updates, research, fees, bulk import, email. These are added only after the loop proves its value.
