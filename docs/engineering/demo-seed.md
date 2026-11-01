# Demo seed and demo mode

The synthetic, court-faithful demo data and the sandbox that serves it (#93; spike §4.3, `docs/engineering/13-technical-architecture-spike.md`). It powers the sales demo, Storybook fixtures, e2e tests and load tests. Everything in it is invented, and the product says so.

## The two workspaces

| Key                 | Slug                     | Kind    | Courts                                                                       | Members                         |
| ------------------- | ------------------------ | ------- | ---------------------------------------------------------------------------- | ------------------------------- |
| `chennai-solo`      | `demo-chennai-solo`      | solo    | High Court of Madras                                                         | advocate (owner), clerk         |
| `bengaluru-chamber` | `demo-bengaluru-chamber` | chamber | High Court of Karnataka, City Civil Court Bengaluru, Mayo Hall Court Complex | advocate (owner), junior, clerk |

Each has 40 matters, 60 or more orders and 120 or more obligations (order directions, registry defects, certified copies and carry-forward items, open, overdue, due today and done), hearings and lists on every one of the last 30 days, and a canonical next date per active proceeding. The Chennai matter set includes one W.P. with two W.M.P.s and a W.A. against it.

Sources, under `packages/db/src/seed/demo/`:

- `modules.ts` (every product module beyond the matter graph, below) and `memory.ts` (the plain memory items M1 to M7, their proposals and usage);
- `workspaces.ts` (the two specs and their id blocks), `people.ts` (members, opposing counsel), `courts.ts` (forums, halls, benches);
- `matters.ts` (hand-written anchors plus matters generated from the workspace's seeded PRNG: `createPrng` in `shared.ts`);
- `pdf.ts` (the sample order PDFs, deterministic, watermarked `SYNTHETIC`);
- `meta.ts` (`DEMO_VERSION`, `demoContentHash`), `seed.ts` (writes one workspace), `reset.ts` (restores one), `index.ts` (registers the `demo` seeder).

## Every module has data (#985)

A reviewer can use the whole app hands-on. Each module below is seeded in both workspaces unless noted; a new module must add rows here and a minimum to `MODULE_MINIMUMS` in `packages/db/src/seed/__tests__/demo-seed.test.ts`.

| Module (nav / route)                                         | What the seed gives it                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Today, Tomorrow, court-day board                             | listings today and tomorrow, a court-day marker ("court at item 9"), brief state for six items                                                                                                                                                                                            |
| List diff (court-day board)                                  | per forum a daily and a later supplementary list of today: one row added, one removed, one moved, one re-staged                                                                                                                                                                           |
| Matters, matter graph, timeline, proceedings                 | 40 matters, writ graph (W.P., two W.M.P.s, W.A.), orders with SYNTHETIC PDFs, issue tags, research notes                                                                                                                                                                                  |
| Hearings and outcomes                                        | past hearings with procedural outcomes; delegated appearances                                                                                                                                                                                                                             |
| Briefs and brief sheet                                       | prepared-by, note and carry list on today's listings; carry rules from memory M2                                                                                                                                                                                                          |
| Obligations, directions                                      | 120+ obligations; one order with three directions: obligation, not applicable (with reason) and **unreconciled**                                                                                                                                                                          |
| Registry defects, certified copies                           | `defect`, `certified_copy` and `obligation_event` rows behind the defect and copy obligations                                                                                                                                                                                             |
| Calendar                                                     | derived from listings and hearings (nothing extra)                                                                                                                                                                                                                                        |
| People, contacts                                             | clients, opponents and counsel, 12 client contacts with phone, email and language                                                                                                                                                                                                         |
| Enquiries and conflicts                                      | 5 enquiries (logged, checked, declined, referred), a **conflict card with two hits**, one with none; `represents`/`opposes` edges on every matter so a live check finds hits                                                                                                              |
| Drafting studio                                              | a demo template and three drafts (one final); no export, no AI                                                                                                                                                                                                                            |
| Outward drafts                                               | three hearing updates (client, senior counsel), drafted or edited, never shared                                                                                                                                                                                                           |
| Capture inbox, proposals                                     | six captures in every state, three proposals (two "needs you"), all AI-blocked                                                                                                                                                                                                            |
| Memory M1 to M7                                              | 19 items per workspace with provenance, proposals (proposed, dismissed, observing) and usage; sealed by the content step                                                                                                                                                                  |
| Delegation and handover                                      | Bengaluru: three handovers (one acknowledged) from the advocate to the junior with matter views; both: delegated appearances                                                                                                                                                              |
| Limitation                                                   | three demo rules and three computations (confirmed, proposed)                                                                                                                                                                                                                             |
| Fees, invoices, ledger                                       | agreements on twelve matters, nine invoices (draft, issued, paid, void), payments, receipts and disbursements                                                                                                                                                                             |
| Status links                                                 | one expiring client link (token below)                                                                                                                                                                                                                                                    |
| Insights, proof-of-value                                     | derived from hearings and obligations; preparedness ratings and weekly pulse rows                                                                                                                                                                                                         |
| Portfolio                                                    | a recovery panel over six proceedings                                                                                                                                                                                                                                                     |
| Activity feed                                                | four rows: two automatic and undoable, one automatic and confirmed (no longer undoable), one by the advocate; no AI, source marked synthetic                                                                                                                                              |
| Notifications (bell)                                         | three in-app rows; the demo sends no email, push or WhatsApp                                                                                                                                                                                                                              |
| Research (`/research`, matter research tab, judgment alerts) | a synthetic corpus of 24 judgments (global, no workspace): five segments each, 21 subject areas with at least two judgments each, statute and citation references, masked titles; three judgment alerts per confirmed issue tag on the first matters (#1070)                              |
| News                                                         | ten `SYNTHETIC:` items from two fictional publishers over the last eight days, tagged to practice areas and forums (#1071)                                                                                                                                                                |
| Notices                                                      | eleven `SYNTHETIC:` official notices (circular, practice direction, roster, holiday, registry; one states a vacation range, #650) for the demo forums, matched to the workspace's forums and to matters before them, so the matter notice cards have content (#1071)                      |
| Billing (`/billing`)                                         | an active subscription on the mock provider (Chennai: Advocate 2, one seat; Bengaluru: Chamber 1, three seats and a clerk seat), renewing in 20 days, and three paid SaaS invoices (series `DEM`, unregistered fictional parties); billing actions stay blocked by the demo guard (#1071) |
| Help, settings                                               | no seeded data needed (static articles, the member's own settings). Bench facts are a global table: seed them with the catalogue                                                                                                                                                          |

Flags: `m5_playbooks` and `insights.enabled` are on in both workspaces. Fees, limitation, the conflict check, the enquiry log, status links and bench facts are legal-gated (counsel sign-off); a workspace row never turns those on alone. On a local or review database, `pnpm db:seed:demo -- --enable-gated-flags` writes the global and workspace rows with the note "Demo environment only: not a counsel sign-off". It refuses production. Without it those nav items stay hidden.

### Corpus, news and notices (#1070, #1071)

The research corpus, the news items, the notices and their registry sources are global rows (no `workspace_id`), written once by `seedDemo` with the owner role (`seedDemoCatalogue`, `catalogue.ts` and `corpus.ts`); the workspace rows that point at them (judgment alerts, notice matches) are written with each workspace and left out when the global row is missing, so the nightly reset works on any role.

- **Corpus.** `DEMO_JUDGMENTS` (24 judgments, High Court of Madras and Karnataka codes) with fixed ids and dates. Every page opens `SYNTHETIC - DEMO DATA - FICTIONAL` and the text is template prose, not court text. The hard lines hold: titles are masked (`[name withheld] v. <institution> (fictional)`), the matrimonial judgments carry the sensitive category, no bench is stored (no judge names, no ratings), no reporter (SCC) text, and the neutral citations are in the 9xxxxx range of each court's sequence. Tags use the corpus vocabulary (`SUBJECT_AREAS`), statute references use normalised keys, and each judgment cites two others, resolved to corpus rows. `DEMO_CORPUS_VERSIONS` mirrors the redaction, segment and enrich versions (a core test pins them).
- **Embeddings.** `@causedeck/db` cannot import the embedder, so the segments are written without vectors and `pnpm db:seed:demo:content` (`--only=corpus` for just this) embeds them with the mock embedder (`seedDemoCorpusEmbeddings`, model `mock-embed@1`, the one `searchAuthorities` queries with), only for demo judgments and only for the roles `system.corpus.embed` embeds. Without that step the lexical arm still answers; the vector arm needs it.
- **Issue tags** of the first four active matters name sections the corpus cites (the first is a proposed AI tag, the other three are confirmed), so `listRelevantJudgments` shows judgments on those matters.
- **News and notices** are re-dated on every workspace seed and reset (`refreshDemoCatalogue`), so the lists stay current. Their sources (`demo.news.*`, `demo.notice.*`) are not cleared and carry the kill switch: no poll job ever calls them.
- **Vacation notice (#650).** Notice 11 is a `holiday`-kind vacation notice for the Mayo Hall city courts; its `notice_vacation` row (`demoNoticeVacationRows`) closes the forum from five to nineteen days after the seed day. It is matched like the other notices, so `loadCourtCalendar` merges it with the static table: the calendar shows a vacation band and a deadline due inside it rolls to the next sitting day. The app role can only insert `notice_vacation`, so the range is written once per calendar month (id from the year and month): a later month adds a fresh range and earlier ones are simply in the past.
- **Billing.** `demoBillingRows` (`billing.ts`). Invoices are written draft, then lines, then paid (an issued invoice is immutable and its lines cannot be added), and an existing invoice is never touched. Numbers are `DEM/<fy>/<n>`, never taken from the real `invoice_counter`.

The demo status link token is `demo-status-link-synthetic-0001:<workspace key>` hashed; the page cannot be opened from the seed (the token is not stored), which is intended.

## Rules the seed keeps

- **Fictional only.** Every party, advocate, client, organisation, judge and workspace name ends in "(fictional)". Case numbers are `DEMO-NNNN` (shown as `WP-DEMO/2026/0001`), no CNR and no neutral citation is ever set, emails are at `demo.causedeck.test`, phones in the unallocated `99999 00xxx` range. The seed test checks names against a blocklist of real advocates and parties.
- **No real court text.** The order PDFs carry the heading `SYNTHETIC - DEMO DATA - FICTIONAL`, lorem-style body text and a `SYNTHETIC` watermark line; the same input always gives the same bytes.
- **No AI.** The seed writes no AI output and makes no AI call; a demo workspace refuses AI spend.
- **No case-outcome marketing** (Rule 36): hearing outcomes are procedural ("Adjourned", "Notice ordered"), never a win or loss.
- **Provenance on every fact** (`seed:demo`, source type `system`, confirmed), **one canonical next date per proceeding**, **obligations closed only with a reason**, **no cross-workspace foreign keys**: every row carries its workspace and the composite foreign keys keep it there.
- **Idempotent and deterministic.** Fixed ids (`00000000-0000-4000-8000-d<kind><workspace block + n>`), a seeded PRNG and `onConflictDoNothing`: a second run writes nothing. Dates are offsets from the seed day (Asia/Kolkata).
- **Versioned.** `DEMO_VERSION` (bump it with every content change) is written to `workspace_settings.demo_version`; `demoContentHash` hashes the generated rows and the seed test pins the property that it is stable.
- **Never in production.** `seedDemo` and `pnpm db:seed:demo` refuse when `NODE_ENV=production`; the nightly reset only restores demo workspaces that already exist.

## Commands

```sh
pnpm db:seed:demo                                    # both workspaces, idempotent
pnpm db:seed:demo -- --workspace=chennai-solo        # one
pnpm db:seed:demo -- --workspace=all --reset         # delete rows and visitors, then reseed
```

Tests, stories and load setups call `seedDemo(db, { today, workspaces })` from `@causedeck/db/seed/demo`; `resetDemoWorkspace(db, key)` restores one workspace.

## Demo mode

`organization.is_demo boolean not null default false` marks a sample workspace. A demo workspace is an ordinary tenant under RLS: a visitor reads nothing outside it. What makes it a sandbox is the guard in `@causedeck/core` `shared/demo-guard.ts` (`isDemoWorkspace`, `assertNotDemoWorkspace`), checked at the transport choke points:

| Channel                                       | Where                                                                            | Behaviour in a demo workspace                                                                     |
| --------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Email, push, WhatsApp of a notification       | `notification.deliver`                                                           | skipped, recorded as `demo_workspace`; in-app row stays                                           |
| Reminders, end-of-day, daily and news digests | `reminders.ts`, `activity-digest.ts`, `notification-digest.ts`, `news-digest.ts` | only the in-app row; no email, push or WhatsApp                                                   |
| Webhooks                                      | `emitWebhookEvent`, `webhook.deliver`                                            | no delivery created; a queued one fails as `demo_workspace` without counting against the endpoint |
| Invitations                                   | `inviteMember`, `reissueInvitation` (`requireInviter`)                           | `FORBIDDEN`, before any email is built                                                            |
| Billing                                       | `changeSubscription`                                                             | `FORBIDDEN`                                                                                       |
| AI                                            | `createAiPorts` budget `reserve`                                                 | `FORBIDDEN` before the provider is called                                                         |

Every new outward channel must call the guard and add a case to `packages/core/src/demo/__tests__/demo.test.ts`.

### Entering, session and reset

- `/demo` (public, linked from sign-in) shows a card per sample workspace that exists; each card posts to `POST /demo/enter`.
- `enterDemo` (`@causedeck/core/demo`) creates an ephemeral visitor (`visitor.<key>.<id>@demo.causedeck.test`, role `advocate`, membership in that workspace only). Better Auth's `POST /api/auth/demo/sign-in` (`packages/auth/src/demo-provider.ts`, rate limited to 10 per IP per hour) opens the session with `expiresAt` 4 hours out (`DEMO_SESSION_TTL_MS`), created `dontRememberMe` so it is never refreshed and the cookie ends with the browser session.
- The banner (`apps/web/components/shell/demo-banner.tsx`) shows on every page of a `demo` or `demo-*` slug (reserved: no real workspace can take it): `Demo workspace, sample data`, `Sample data only. Nothing here is real, and nothing leaves this workspace.`, `Leave demo` and, from 768 px, `Start your own workspace`; both post to `/demo/leave`, which ends the session.
- `resetDemo` deletes every row of the workspace (the seed's and anything a visitor added; found in the catalogue and deleted children first, except append-only tables and tables the role may not delete from) and its visitors, writes the seed again and records `demo.reset` in the audit log. The `system.demo.reset` job runs it nightly at 03:10 IST and removes visitors older than 4 hours. A reset takes well under the 30 s budget (the test asserts it).
- `app_demo_workspaces()` (owner-defined, ids and slugs only) is the one cross-workspace read: a visitor and the nightly job have no workspace yet.

## Memory, the sample PDFs and the corpus vectors (`db:seed:demo:content`)

`@causedeck/db` cannot import `@causedeck/storage`, so the parts that need it live in `@causedeck/core` (`src/demo/content.ts`, script `packages/core/scripts/seed-demo-content.ts`):

```sh
pnpm db:seed:demo:content                                   # memory (sealed) and the PDFs, both workspaces
pnpm db:seed:demo:files                                     # only the PDFs
pnpm db:seed:demo:content -- --only=memory --workspace=bengaluru-chamber
```

Run it after `pnpm db:seed:demo` (it also embeds the demo research corpus, #1070), with `DATABASE_URL_OWNER`, `KEK_BASE64` and the `S3_*` env of the local stack (MinIO). `seedDemoMemory` seals each value of `demoMemory` (db seed, plain) with the workspace key (`encryptField`, AAD = workspace id) and writes `memory_item`, `memory_proposal` and `memory_usage` with fixed ids. `seedDemoFiles` regenerates the SYNTHETIC PDFs (`demoDocumentPdfs`), puts each at the key its `document` row names and inserts a finalized `blob` row (id = document id, scan `skipped`). Both are idempotent and refuse `NODE_ENV=production`. The nightly `system.demo.reset` job runs both again after the reset (the reset deletes memory and blob rows with the rest of the workspace); a deployment without a key or bucket keeps the rest of the reset and logs a warning.

## Demo seed and onboarding

The first-day screen of the onboarding wizard (#92) links "Try the demo workspace" to `/demo` whenever a demo workspace is seeded (or the member already belongs to one). `/demo` creates the ephemeral visitor.

## Not done

e2e, visual baselines and axe for the demo banner and `/demo` (#985 last item), and real fixtures from lawyers (#119). The load-test harness is #105. Bench facts are a global catalogue table, not per workspace; the demo's corpus, news and notices are global too (above).
