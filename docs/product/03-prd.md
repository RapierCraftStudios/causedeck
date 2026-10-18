# 03 — Product Requirements Document: Lawyer OS

Version 0.3 · 2026-10-17 · Status: Draft for validation
Related: [Thesis](../strategy/02-product-thesis-and-segmentation.md) · [System architecture](10-lawyer-os-system-architecture.md) · [Capture & automation subsystem](09-zero-entry-automation-design.md) · [Launch markets](../strategy/11-launch-markets-madras-hc-bengaluru.md) · [MVP](../mvp/04-mvp-definition.md) · [Risks](../risk/06-risk-register.md) · [Decisions](../../DECISIONS.md)

> **Framing (D-024).** Lawyer OS is an intelligent operating layer for how advocates practise in Indian courts. It is delivered as a secure, multi-tenant, India-hosted SaaS (D-032).
>
> This PRD covers the **whole OS**, and every requirement is tagged with its release:
> - **M**: MVP vertical slice for Madras HC and Bengaluru
> - **v1**: about 6 months after the MVP
> - **v2**: about 12–18 months
> - **Later**
>
> **The MVP is a vertical slice of Lawyer OS, not a data-entry product.** Every layer is present in thin form. v0.3 replaces v0.1 and v0.2; earlier requirement IDs are mapped in §14.

---

## 1. Problem
Indian litigators run high-stakes practices on fragmented information:
- court-specific cause lists, shifting halls and items, roster changes, and late or illegible orders;
- complex matter structures: IAs, connected matters, appeals, and unnumbered SR stages;
- several appearance capacities;
- obligations created at every hearing and tracked only in memory.

Preparation happens the night before, from scattered sources. When a junior or clerk leaves, their context leaves with them. The result is underprepared appearances, missed obligations, cognitive overload and broken continuity.

Free court apps show raw status. Research tools show law. Generic AI invents citations. **No product operates the practice.**

## 2. Goals, deferrals, and permanent exclusions

### 2.1 Goals (full OS; the MVP slice delivers each in thin form)
- **G1 Prepared appearances.** Before every listed appearance, a current brief exists. It covers where the matter stands, the last order, open obligations, documents needed, and the lawyer's own notes.
- **G2 Kept obligations.** Every obligation from orders, hearings, registry defects or the lawyer's own commitments is captured with provenance. It is owned, reminded and closed deliberately.
- **G3 A calm court day.** One operating view of today and tomorrow across courts and halls: items, stages, clashes, delegation, and what to carry.
- **G4 Continuity.** Any matter can be picked up in minutes, whether by the lawyer after weeks away or by a colleague at handover.
- **G5 A practice that compounds.** Memory makes matching, briefs and drafts better with use.
- **G6 Trust.** Nothing outward happens without the lawyer. AI never invents law. Data stays private, isolated and India-hosted.
- **G7 Low effort in.** Lawyer-owned inputs are captured with minimal typing. This is a design constraint, not the value proposition.

### 2.2 Deferred for sequencing (on the OS roadmap, not abandoned; D-034)
- Licensed research integration.
- Full drafting studio and Word add-in.
- Fees, invoicing and the client-money ledger.
- Limitation engine.
- Live display-board tracking.
- Device-retrieved and official or licensed court feeds.
- Madurai, Dharwad and Kalaburagi benches, and other states.
- Native desktop app.
- Advocate-authored client status links.
- Intake and conflict check.
- Practice analytics.
- Opt-in WhatsApp bot channel.
- Calendar OAuth read.

### 2.3 Permanently excluded
- Public solicitation or marketing of lawyers, lead-gen, directories, ratings (D-006).
- Autonomous legal advice or consumer legal Q&A (D-007).
- Unverified or generated citations (D-004).
- Unsupervised filing, or any L5 action (D-017).
- Unauthorised court scraping (D-003, D-028).
- Judge analytics or bench profiling (D-027).
- Training on customer content.

## 3. Users, roles, tenants
- **Workspaces (tenants):** Solo (Advocate plan or free Junior) and Chamber (seats). A user can belong to several workspaces and switches between them explicitly.
- **Roles:**
  - **Owner:** chamber head or solo advocate; full access.
  - **Advocate:** appears and drafts; sees assigned or all matters, as the owner decides.
  - **Junior:** appears "for" the advocate, maintains lists; sees assigned matters and can capture and propose.
  - **Clerk:** handles listings, tasks, documents and registry follow-ups. **Cannot see strategy notes or matter memory** by default.
  - **Viewer:** read-only.
- **Primary payers:** independent advocates (S2) and young chambers (S4) at Madras HC and Karnataka HC (Bengaluru). **Distribution carriers:** juniors (S1).

## 4. Jobs-to-be-done

| ID | Engine | When… | I want… | So that… | Rel. |
|---|---|---|---|---|---|
| J-P1 | Prepare | tomorrow's list is out | a **brief per listed matter**: stage, last order and directions, open obligations, documents to carry, my notes, what happened last time | I walk in prepared | **M** |
| J-P2 | Prepare | I open a matter | its **timeline** across proceedings (main, IAs, connected, appeals), with every listing, hearing, order and filing event | I understand it in a minute | **M** |
| J-P3 | Prepare | I need context from documents | relevant passages surfaced from the matter's documents, with page anchors ("the interim order on 12 Aug said…") | I don't dig through PDFs | **M** |
| J-E1 | Execute | it's the court day | one **court-day view**: halls, items, stages, clashes, who appears where, what to carry | the day runs calmly | **M** |
| J-E2 | Execute | a hearing ends | to record the outcome by **voice in under a minute** and confirm the next date | nothing is lost between court and office | **M** |
| J-E3 | Execute | items move in court | to know when my item is near | I don't miss a call | v1 ⚖ |
| J-F1 | Follow-up | an order arrives | its directions turned into **obligations with dates, owners and source lines**, which I confirm | nothing is dropped | **M** |
| J-F2 | Follow-up | I'm planning the week | an **action and deadline queue**: counters, rejoinders, defect cures, certified copies, process fees, notices, compliance; overdue first | I keep every obligation | **M** |
| J-F3 | Follow-up | a client, senior or briefing counsel needs an update | a **drafted update** in English, Tamil or Kannada that I edit and send myself | communication is fast and accurate | **M** |
| J-F4 | Follow-up | a filing is returned or defective | the return or defect and its cure deadline **tracked** from the registry email, memo or my voice note | unnumbered matters don't stall | **M** |
| J-C1 | Continuity | I hand a matter over, or come back to it after weeks | a **handover note** generated from the graph and memory | the matter never goes dark | **M** |
| J-C2 | Continuity (chamber) | I lead a chamber | to **delegate** tomorrow's appearances and see outcomes as they are captured | I supervise without phone calls | **M** (Chamber plan) |
| J-M1 | Memory | I work the same way repeatedly | the OS to **propose** remembering preferences, aliases, court notes and matter facts, which I confirm, see, edit and delete | it gets more useful over time | **M** |
| J-D1 | Drafting | I need a routine document (adjournment or mention memo, letter to the client) | a **template draft** filled from the graph and memory, with no generated authorities | routine drafting is quick and safe | **M** (2 templates) → v1 |
| J-D2 | Drafting | my draft cites cases | **citation verification** with links | I avoid misconduct risk | **M** |
| J-S1 | Platform | I start using it | to be productive on day one: courts chosen, matters imported from my lists, orders, calendar and diary, nothing typed twice | onboarding is painless | **M** |
| J-S2 | Platform | I care about confidentiality | to see where data lives, who can see what and what the AI did, and to export or delete everything | I can trust a cloud service | **M** |
| J-R1 | Research | I need authorities | to jump to research tools with the issue pre-filled, and keep my research notes in the matter | research fits my workflow | M (link-out) → v2 (licensed integration) |
| J-B1 | Business | fees are due | fee tracking and invoices (GST/RCM) | my books are current | v1 ⚖ |

## 5. The core OS loop (MVP vertical slice)

```
 CAPTURE (lawyer-owned)          UNDERSTAND                  OPERATE                          COMPOUND
 cause-list PDF ───────┐      court adapter (A1) ──► MATTER GRAPH ─► PREPARE: brief per listing ─┐
 order/judgment PDF ───┼──►   document intelligence ─► (proceedings,   EXECUTE: court-day view,   │
 voice note ───────────┤      speech + structuring      listings,       hearing capture            ├─► LAWYER MEMORY
 calendar / diary ─────┤      matching ─────────────►   orders,        FOLLOW-UP: obligations,    │   (confirm-before-save)
 email / WA export* ───┘      (proposals w/ anchors)    obligations)    client drafts, defects      │        │
 manual correction ◄──────────── confirm / correct ◄─────────────────── CONTINUITY: timeline,     ─┘        │
                                                                         handover, delegation  ◄────────────┘
 * opt-in, privacy-gated (D-029)
```

## 6. User journeys (MVP)

### UJ-1 Onboarding: solo advocate, Madras HC (target: first court-day view within 24 h)
1. Sign up with Google or email and create a Solo workspace. The screen explains that data is stored in India.
2. Set up the practice profile (M1): enrolment number and bar council, courts (Madras HC Principal Seat plus other forums from the catalogue), practice areas, languages.
3. **Import without retyping:**
   - forward the last 3–5 cause lists that show the lawyer's name, or the Registry's email push once the lawyer is registered on AIMS (see [11](../strategy/11-launch-markets-madras-hc-bengaluru.md));
   - share recent orders;
   - optionally add a calendar `.ics` file or photos of diary pages.
4. The adapter matches rows and orders to proceedings and groups them into matters, e.g. a main petition with its W.M.P.s, or a connected batch. The lawyer approves, merges or splits them in **one confirm grid**.
5. First output: the court-day view and briefs for the next listed day, plus a starting obligation queue drawn from recent orders.

### UJ-2 Onboarding: chamber, Bengaluru (assisted, 45 min)
1. The owner creates a Chamber workspace, invites juniors and the clerk, and assigns roles. The clerk role starts restricted.
2. Bulk import from the chamber's recent Karnataka HC lists, orders, and a shared diary or Excel sheet. Matters at the City Civil Court, Mayo Hall and commercial courts come in as A0 forums.
3. The owner sets delegation defaults and the brief format.
4. The team's evening court-day view is live from day 1.

### UJ-3 Evening: prepare
1. The lawyer or clerk shares tomorrow's cause list, or it arrives through a sanctioned channel.
   - The adapter fills hall, item, stage and bench for matched proceedings (L3).
   - It proposes unmatched rows that carry the lawyer's or chamber's names (L2).
   - It flags matters expected but not listed.
2. At 8 pm the **court-day view** is ready, grouped by hall in item order. It flags clashes across halls and complexes and, in a chamber, suggests who should appear where.
3. Each listing gets a **brief** containing:
   - the stage (e.g. "For Admission" or "Part Heard");
   - the last order in 2–3 lines, with a link to the page;
   - open obligations and their status ("counter not yet filed; due 20 Oct");
   - documents to carry;
   - the matter-memory synopsis;
   - what happened at the last hearing;
   - the lawyer's private court notes (M4).
4. The lawyer adjusts the carry list or notes. The chamber owner confirms delegation, and each junior sees their own list.

### UJ-4 Court day: execute
1. At 7 am the view shows any supplementary-list changes.
2. During the day the lawyer works from the court-day view: tap a listing to open its brief, read document context, add quick notes.
3. After each hearing, a voice note (English, Tamil, Kannada or mixed) becomes **structured outcome proposals**: what happened, next date, stage after, directions and obligations, and tasks. The lawyer confirms the date and obligations on one screen.
4. The chamber owner sees outcomes fill in through the day.

### UJ-5 An order arrives
1. Share the order PDF from the court website download, email or WhatsApp.
2. Document intelligence reads the header (bench, date, case numbers, neutral citation) and the operative directions, each with page and quote anchors.
3. It cross-checks the order against the voice-note outcome. If they differ, it raises a conflict card.
4. Directions become proposed obligations, which the lawyer confirms. An update to the matter-memory synopsis is proposed.

### UJ-6 Follow-up
- The **action and deadline queue** sorts items into overdue, this week and later. Each item shows its source, owner and a drafted next step: a task, a letter to the client, or a reminder to the clerk.
- **Defect and return tracking:** a forwarded registry email (opt-in) or a voice note creates a defect obligation with its cure deadline.
- **Client update drafts** are written in the client's preferred language (M6). The lawyer edits and shares them; Lawyer OS never sends.

### UJ-7 Continuity
- A **matter timeline** across all proceedings.
- A one-tap **handover note** covering synopsis, stage, last orders, open obligations, upcoming listings, key documents and open questions. It is shared inside the workspace.
- A returning lawyer sees "What changed since you last opened this."

### UJ-8 Memory review
Once a month, a "What Lawyer OS has learned about your practice" screen lets the lawyer prune, edit and confirm memories. Tenure metrics are tracked.

### UJ-9 Court data fails
If an adapter's yield looks wrong, the app shows a banner: "Couldn't read today's Karnataka HC list for Hall 3. Open the official list, or share it again." The status page shows adapter health. The OS keeps working on the last known data, clearly marked as such.

## 7. Functional requirements

Priority is MoSCoW within each release. The full automation-level rules are in [09 §4](09-zero-entry-automation-design.md#4-the-automation-ladder--approval-boundaries).

### 7.1 Court layer (CL)
| ID | Requirement | Rel. | Pri |
|---|---|---|---|
| CL-1 | Forum catalogue for the launch markets: Madras HC (Principal Seat; Original and Appellate sides), Karnataka HC (Principal Bench), and Chennai and Bengaluru subordinate courts, tribunals and commissions at A0 | M | Must |
| CL-2 | **Court-adapter framework**: versioned config and parsers, golden fixtures, health monitors, deployed server-side ([10 §5](10-lawyer-os-system-architecture.md#5-court-adapter-strategy-extensible)) | M | Must |
| CL-3 | **Madras HC A1 adapter** covering: cause-list parsing (list types, stage headings, items, halls, benches, advocate names); the official case-type list of about 130 values including the "(MD)" suffix; SR numbers; order header and operative-part parsing; neutral citation | M | Must |
| CL-4 | **Karnataka HC A1 adapter** with the same scope and Karnataka nomenclature | M | Must |
| CL-5 | **A0 generic parsing** for other forums: LLM-assisted, with mandatory anchors and confirmation | M | Must |
| CL-6 | **Access-mode registry** for each adapter and resource (user-supplied, device-user-triggered, official, licensed or none) with counsel notes, enforced in code | M | Must ⚖ |
| CL-7 | Deep links to official case-status and order pages, opened in the system browser. **No framing** of court pages (Madras HC policy) and no scraping | M | Should |
| CL-8 | **Sanctioned push ingestion**, e.g. the Madras HC Registry's cause-list email and SMS push for AIMS-registered advocates, forwarded to the lawyer's private intake address | M (late) | Should ⚖ |
| CL-9 | A2: user-triggered retrieval of public lists and orders on the device | v1 | Should ⚖ |
| CL-10 | Court calendars (working days, vacations, vacation benches); roster and sitting-arrangement change detection from shared PDFs | v1 | Should |
| CL-11 | Live item tracking from public display boards, where permitted | v1 | Could ⚖ |
| CL-12 | Madurai Bench; Dharwad and Kalaburagi benches; more states | v2 | Should |

### 7.2 Matter graph (MG) — see [10 §2](10-lawyer-os-system-architecture.md#2-the-matter-graph)
| ID | Requirement | Rel. | Pri |
|---|---|---|---|
| MG-1 | Matter ↔ Proceedings: main petition, IAs and miscellaneous petitions, connected and tagged matters, appeal and lower-court links, and the SR (unnumbered) → numbered transition | M | Must |
| MG-2 | Listings, Hearings/Appearances (capacity: AoR, arguing, "for" another advocate, proxy), Orders, Obligations, Tasks, Documents, People and role edges, Communications, Authorities | M | Must |
| MG-3 | **Provenance and confirmation state on every node and edge** | M | Must |
| MG-4 | One canonical next date per proceeding; conflict cards; never overwritten automatically | M | Must |
| MG-5 | Obligations are never closed silently: only by a completed task, a lawyer action, or "not applicable" with a reason | M | Must |
| MG-6 | Merge and split matters and proceedings; de-duplication | M | Must |
| MG-7 | Engagement, fee and filing entities | v1 | Should |

### 7.3 Capture (CA) — see [09](09-zero-entry-automation-design.md)
| ID | Requirement | Rel. | Pri |
|---|---|---|---|
| CA-1 | Capture inbox: share sheet (PDF, image, text, audio), in-app voice, camera; offline queue | M | Must |
| CA-2 | Cause-list PDFs supplied by the user, routed to the adapter | M | Must |
| CA-3 | Order and judgment PDFs, routed to document intelligence | M | Must |
| CA-4 | The lawyer's own documents (pleadings, drafts), plus a bulk web import of up to 200 files | M | Must |
| CA-5 | Calendar: ICS import (one-time or periodic file) and a private ICS export feed | M | Must |
| CA-6 | Diary photos → OCR → proposals | M | Should |
| CA-7 | **Email forward-in**: a private address with a sender allow-list for registry, e-filing, cause-list push and briefing-counsel mail | M (late) | Should ⚖ |
| CA-8 | **WhatsApp "Export chat" import** of *internal* chats only (chamber or clerk groups), with preview, per-message exclusion and a sensitive-matter check. **Client chats are excluded by default** | M (late) | Could ⚖ |
| CA-9 | Manual entry and correction everywhere (L0 is always available) | M | Must |
| CA-10 | Per-channel opt-in; a sensitive-matter flag turns AI off for that matter | M | Must |
| CA-11 | Calendar OAuth read; opt-in WhatsApp bot | v1 | Could ⚖ |
| CA-12 | Never read SMS, notifications or contacts; no silent background capture | — | **Prohibited** |

### 7.4 Document intelligence (DI)
| ID | Requirement | Rel. | Pri |
|---|---|---|---|
| DI-1 | Use the text layer first and fall back to OCR (English, Tamil and Kannada scripts); detect language | M | Must |
| DI-2 | Classify documents: order, judgment, cause list, pleading, IA, annexure, correspondence, registry memo | M | Must |
| DI-3 | Extract from orders: bench, date, case numbers, neutral citation, operative directions, next date, stage cues, each with **page and quote anchors**. Reject any date that is unanchored or absent from the source | M | Must |
| DI-4 | Retrieve document context for briefs: matter-scoped, page-anchored passages | M | Must |
| DI-5 | Unofficial machine translation (Tamil/Kannada ↔ English), labelled as such | v1 | Should |
| DI-6 | Chat over a matter's documents (matter-scoped, cited) | v1 | Should |

### 7.5 Prepare (PR)
| ID | Requirement | Rel. | Pri |
|---|---|---|---|
| PR-1 | **Preparation brief** per listing: stage, last order, open obligations, carry list, synopsis, last-hearing summary, court notes, documents | M | Must |
| PR-2 | **Matter timeline** across proceedings | M | Must |
| PR-3 | Brief format follows M2 preferences; editable; lawyer can mark it "prepared ✓" | M | Must |
| PR-4 | Research link-outs with pre-filled queries; research notes stored in the matter | M | Should |
| PR-5 | Licensed research integration; argument and issue notes linked to verified authorities | v2 | Could |

### 7.6 Execute (EX)
| ID | Requirement | Rel. | Pri |
|---|---|---|---|
| EX-1 | **Court-day view** (today and tomorrow) organised by complex → hall → item, with stages, clashes and carry lists | M | Must |
| EX-2 | Diffs for supplementary and changed lists | M | Must |
| EX-3 | **Hearing capture by voice** (English, Tamil, Kannada or mixed) producing outcome, next date, stage after, directions and tasks, confirmed on one screen | M | Must |
| EX-4 | Chamber delegation: assign appearances; each junior sees their own list; the owner sees outcomes live | M (Chamber) | Must |
| EX-5 | Reminders: evening, morning, and "outcome missing" after a hearing | M | Must |
| EX-6 | Live item tracking | v1 | Could ⚖ |

### 7.7 Follow-up (FU)
| ID | Requirement | Rel. | Pri |
|---|---|---|---|
| FU-1 | **Obligation and deadline queue**: from orders, hearings, defects and internal commitments, with owner, due date, source and status | M | Must |
| FU-2 | Tracking for defects, returns and SR matters, and for certified copies | M | Must |
| FU-3 | A drafted next step per obligation (task, reminder to the clerk, letter to the client) | M | Should |
| FU-4 | **Update drafts for clients, seniors and briefing counsel** in English, Tamil or Kannada using M6. The lawyer shares them (L4); Lawyer OS never sends | M | Must |
| FU-5 | Stale-matter detection: no next date; past date with no outcome; no update in N days | M | Must |
| FU-6 | Limitation tracker built on a counsel-reviewed rule table | v1 | Should ⚖ |
| FU-7 | Fees and invoices (GST/RCM) | v1 | Should ⚖ |

### 7.8 Drafting (DR)
| ID | Requirement | Rel. | Pri |
|---|---|---|---|
| DR-1 | Two court-formatted templates per launch court: a mention or adjournment memo, and a covering letter to the client. Filled from the graph and memory; the model writes narrative blocks only | M | Must |
| DR-2 | No generated authorities. A **citation checker** (Indian Kanoon API plus official links) marks each citation ✔, ✖ or ?. Exporting with a ✖ requires an acknowledgement, which is logged | M | Must |
| DR-3 | Consistency check: names, case numbers, dates and annexures against the graph | M | Should |
| DR-4 | Export to DOCX and PDF; an "AI-assisted" document property | M | Must |
| DR-5 | Template library, style learning (M5), Word add-in | v1–v2 | Should |

### 7.9 Memory (ME) — see [10 §3](10-lawyer-os-system-architecture.md#3-lawyer-memory-model)
| ID | Requirement | Rel. | Pri |
|---|---|---|---|
| ME-1 | M1 profile, M2 preferences, M3 matter memory, M4 private court notes, M6 relationship memory (existing clients only), M7 recognition | M | Must |
| ME-2 | Confirm before saving. Memory screen to view, edit, delete and pause. Memory is cited when it is used | M | Must |
| ME-3 | Matter memory is scoped to its matter. Chamber-shared memory only when explicitly marked | M | Must |
| ME-4 | Monthly memory review | M | Should |
| ME-5 | M5 playbooks and precedent bank | v1 | Should |
| ME-6 | No judge analytics and no AI profiling of benches | — | **Prohibited** |

### 7.10 Continuity and chamber (CO)
| ID | Requirement | Rel. | Pri |
|---|---|---|---|
| CO-1 | Handover note generation; "what changed since you last looked" | M | Must |
| CO-2 | Chamber roles (Owner, Advocate, Junior, Clerk, Viewer); per-matter restrictions | M | Must |
| CO-3 | Member offboarding: matters reassigned, access revoked, history retained | M | Must |
| CO-4 | A junior's personal workspace kept alongside chamber membership, cleanly separated | M | Must |

### 7.11 SaaS platform (PL) — see [10 §6](10-lawyer-os-system-architecture.md#6-saas-platform-lawyer-os-as-a-hosted-multi-tenant-service)
| ID | Requirement | Rel. | Pri |
|---|---|---|---|
| PL-1 | Multi-tenant workspaces; RLS isolation; envelope keys per workspace; cross-tenant tests in CI | M | Must |
| PL-2 | India-region hosting (Mumbai primary, Hyderabad DR); India-only AI mode by default; published sub-processor list | M | Must |
| PL-3 | Plans and entitlements (Junior, Advocate, Chamber seats including a clerk seat); Razorpay subscriptions and UPI Autopay; GST invoices; proration; dunning | M (late) | Must |
| PL-4 | Self-serve onboarding for solos; assisted-onboarding tooling (bulk import) for chambers | M | Must |
| PL-5 | Continuous delivery with feature flags and OTA updates; adapters hot-deployed; backward-compatible sync | M | Must |
| PL-6 | Support: in-app help; a WhatsApp line during court-day hours; status page with adapter health; consented, time-boxed support sessions | M | Must |
| PL-7 | Offline: a 7-day encrypted cache of the court-day view, briefs and matter files; capture queue | M | Must |
| PL-8 | Export everything; delete a workspace (crypto-erase); delete an account | M | Must |
| PL-9 | SSO for chambers; audit export for customers; dedicated hosted tenant; BYOK | v1–v2 | Could |
| PL-10 | No on-premises or self-hosted customer deployment | — | Out of model (D-032) |

### 7.12 Trust and audit (TR)
| ID | Requirement | Rel. | Pri |
|---|---|---|---|
| TR-1 | Automation levels L1–L4 enforced; **no code path for L5** | M | Must |
| TR-2 | Activity feed with a 7-day Undo; end-of-day digest of what the OS did | M | Must |
| TR-3 | AI audit (model, region, sources, confidence, user action), visible to the user and exportable | M | Must |
| TR-4 | Outward-action log: prepared → edited (with diff) → shared by the lawyer | M | Must |

### 7.13 Prohibited (permanent)
- **PX-1** A public directory, profiles, ratings or reviews of advocates hosted by us.
- **PX-2** Outbound messaging to non-clients; campaigns; lead capture or scoring; ad, SEO or social tooling.
- **PX-3** Referral fees, revenue share or commissions tied to legal fees.
- **PX-4** Generated or unverified citations; auto-filing or any other L5 action.
- **PX-5** Training on customer content; selling or sharing data.
- **PX-6** Consumer-facing legal Q&A, or any suggestion that the platform provides legal services.
- **PX-7** Reading SMS, notifications or contacts; silent capture.
- **PX-8** Unauthorised server-side court scraping; framing court pages.
- **PX-9** Judge analytics or bench profiling.

## 8. Non-functional requirements

| Area | Requirement (MVP unless noted) |
|---|---|
| Performance | Cold start < 2.5 s on a 4 GB Android phone. Court-day view < 300 ms from the local cache. Voice → proposals p95 < 20 s. Order extraction p95 < 40 s for 20 pages. Brief < 5 s per listing |
| Availability | 99.5% monthly at MVP → 99.9% at v1. The **evening (6–11 pm IST) and morning (7–10:30 am IST) windows** are change-freeze periods |
| Durability | PITR; RPO ≤ 15 min; RTO ≤ 4 h; DR in Hyderabad |
| Accuracy | Per launch court: list-row match precision ≥ 99.5%, recall ≥ 95%. Order next date ≥ 98%. Directions recall ≥ 90%. Zero hallucinated dates. False ✔ from the citation checker ≤ 0.5% |
| Isolation and security | RLS on every tenant table; per-workspace keys; MASVS-L1; pentest before launch; 2FA for admins; passkeys or Google sign-in |
| Privacy | India residency; India-only AI by default; no training on customer data. Retention: raw audio 30 days, raw imports limited. Memory and embeddings deleted within 24 h of a request. Workspace crypto-erased within 30 days of deletion |
| Compliance | CERT-In (6 h reporting, 180-day logs kept in India); DPDP readiness before May 2027; DPA; sub-processor list |
| Offline | 7-day cache; capture queue; conflict-safe sync |
| Updates | Adapters hot-deployable; OTA JS updates; no forced updates during court-day windows |
| Support | WhatsApp support during court-day windows; status page with adapter health; SLA by plan |
| Cost | ≤ ₹175 variable cost per active seat per month at launch → ≤ ₹110 by month 6; ≤ ₹10 per free workspace |
| Localisation | UI in English at MVP. Content (updates, transcripts, OCR) in English, Tamil and Kannada. Tamil and Kannada UI at v1 |
| Accessibility | WCAG 2.1 AA on web; TalkBack support; Tamil and Kannada rendering verified |

## 9. Privacy, confidentiality and professional conduct
1. The advocate or chamber is the **Data Fiduciary** for client and matter data. Lawyer OS is the **Processor** under a DPA ⚖.
2. Matter data is treated as privileged by default (BSA s.132; BCI Rules 17 and 24). Support can access it only through consented, time-boxed sessions. The clerk role cannot see strategy notes or matter memory.
3. Lawyer-owned inputs come first. Content that originates with clients needs an explicit per-item choice and counsel-approved guidance (D-029).
4. Lawyer OS is not a legal adviser, and no privilege attaches to communications with the platform. "As a service" refers to the software only (D-032).
5. A Rule 36 checklist is applied to every outward-facing feature ⚖.

## 10. Success metrics (proof of value; D-030)

### North star
**Prepared & Kept rate:** the share of listed appearances that meet both conditions:
- (a) a current brief was opened or confirmed before the hearing; **and**
- (b) every obligation arising from that hearing was captured, owned, and either kept or deliberately rescheduled.

### Value metrics
| Dimension | Metric | Measurement | MVP target (pilot) |
|---|---|---|---|
| Preparation | **Brief completeness** | % of listings with a brief containing stage, last order, open obligations and carry list | ≥ 90% |
| Preparation | **Self-rated preparedness** | One-tap 1–5 rating after each hearing | +1.0 vs baseline |
| Obligations | **Missed-obligation rate** | Obligations overdue without a deliberate reschedule ÷ obligations due | ≤ 2% (vs baseline audit) |
| Obligations | **Capture completeness** | Share of obligations in confirmed orders that exist in the queue | ≥ 95% |
| Cognitive load | **Load score** | Weekly 3-item rating: mental demand, worry about forgetting, effort to prepare | −30% vs baseline |
| Continuity | **Time-to-context** | Minutes to answer 5 standard questions about an unfamiliar matter (pilot test) | ≤ 3 min (vs baseline) |
| Continuity | **Handover success** | Delegated appearances where the junior reports "had what I needed" | ≥ 90% |
| Compounding | **Correction rate by tenure** | Corrections per captured item, week 1 vs week 4 | −40% |
| Trust | **L3 undo rate** | Share of automatic (L3) changes the user undoes | ≤ 3% |
| Habit | **Court-day view opened before listed days** | — | ≥ 80% of listed days |
| Effort (secondary) | Typed fields ÷ all fields | — | ≤ 25% |
| Business | Paid continuation after pilot | — | ≥ 40% of pilot workspaces |
| Business | Chamber seat expansion | Seats in month 3 ÷ seats in month 1 | ≥ 1.3× |
| Safety | Rule 36, privacy or isolation incidents | — | 0 |

## 11. Release criteria (MVP)
- Every Must requirement tagged M is shipped.
- The Madras HC and Karnataka HC adapters meet the accuracy targets on at least 30 fixtures each.
- Cross-tenant tests pass, and all high and critical pentest findings are fixed.
- Counsel has signed off ⚖ on the ToS, DPA, privacy policy, access-mode registry, client-content guidance and public wording.
- Pilot cohorts ([07](../validation/07-validation-plan.md)) meet the Prepared & Kept and missed-obligation targets.

## 12. Architecture principles
Detailed in [10](10-lawyer-os-system-architecture.md):
- Local-first clients over a hosted, India-region, multi-tenant core.
- The graph is the source of truth; memory is a separate, scoped layer.
- Court adapters are data.
- Intelligence is deterministic first, with anchored LLM extraction.
- No L5 actions.
- Provenance everywhere.
- Everything is exportable.

## 13. Open questions
1. Madras HC and Karnataka HC list formats: which are text-based and which are scanned, and how stable are they? Can the Madras HC email push (Notification 230/2026) be ingested reliably? (T6; [11](../strategy/11-launch-markets-madras-hc-bengaluru.md))
2. Access-mode registry: the Madras HC website has conflicting policies (hyperlinking vs terms), and the Karnataka HC and eCourts terms are unknown. ⚖
3. Client-content guidance: what notice or consent should advocates give clients before their messages are imported? ⚖
4. Do chambers buy before solos, in Chennai and in Bengaluru?
5. How good are Tamil and Kannada STT and OCR on real courtroom notes and orders? (T2/T3)
6. What is the commercial-use scope of the Indian Kanoon API? (A-17)

## 14. Mapping from v0.1/v0.2 IDs
- FR-M* → MG-*
- FR-H* → EX-* and MG-4
- FR-C* → CL-*
- FR-D* → DI-*
- FR-V* → EX-3
- FR-T* → DR-*
- FR-ME* → ME-*
- FR-CL* → FU-4 and CO-*
- FR-P* → PL-*
- FR-CA* → CA-*, TR-* and FU-*
- PR-1…8 → PX-1…9
