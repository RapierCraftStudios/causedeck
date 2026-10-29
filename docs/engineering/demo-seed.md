# Demo seed and demo mode

The synthetic, court-faithful demo data and the sandbox that serves it (#93; spike §4.3, `docs/engineering/13-technical-architecture-spike.md`). It powers the sales demo, Storybook fixtures, e2e tests and load tests. Everything in it is invented, and the product says so.

## The two workspaces

| Key                 | Slug                     | Kind    | Courts                                                                         | Members                  |
| ------------------- | ------------------------ | ------- | ------------------------------------------------------------------------------ | ------------------------ |
| `chennai-solo`      | `demo-chennai-solo`      | solo    | High Court of Madras                                                           | advocate (owner), clerk  |
| `bengaluru-chamber` | `demo-bengaluru-chamber` | chamber | High Court of Karnataka, City Civil Court Bengaluru, Mayo Hall Court Complex  | advocate (owner), junior, clerk |

Each has 40 matters, 60 or more orders and 120 or more obligations (order directions, registry defects, certified copies and carry-forward items, open, overdue, due today and done), hearings and lists on every one of the last 30 days, and a canonical next date per active proceeding. The Chennai matter set includes one W.P. with two W.M.P.s and a W.A. against it.

Sources, under `packages/db/src/seed/demo/`:

- `workspaces.ts` (the two specs and their id blocks), `people.ts` (members, opposing counsel), `courts.ts` (forums, halls, benches);
- `matters.ts` (hand-written anchors plus matters generated from the workspace's seeded PRNG: `createPrng` in `shared.ts`);
- `pdf.ts` (the sample order PDFs, deterministic, watermarked `SYNTHETIC`);
- `meta.ts` (`DEMO_VERSION`, `demoContentHash`), `seed.ts` (writes one workspace), `reset.ts` (restores one), `index.ts` (registers the `demo` seeder).

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

| Channel                                                  | Where                                                              | Behaviour in a demo workspace                          |
| -------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------ |
| Email, push, WhatsApp of a notification                  | `notification.deliver`                                             | skipped, recorded as `demo_workspace`; in-app row stays |
| Reminders, end-of-day, daily and news digests            | `reminders.ts`, `activity-digest.ts`, `notification-digest.ts`, `news-digest.ts` | only the in-app row; no email, push or WhatsApp |
| Webhooks                                                 | `emitWebhookEvent`, `webhook.deliver`                              | no delivery created; a queued one fails as `demo_workspace` without counting against the endpoint |
| Invitations                                              | `inviteMember`, `reissueInvitation` (`requireInviter`)             | `FORBIDDEN`, before any email is built                 |
| Billing                                                  | `changeSubscription`                                               | `FORBIDDEN`                                            |
| AI                                                       | `createAiPorts` budget `reserve`                                   | `FORBIDDEN` before the provider is called              |

Every new outward channel must call the guard and add a case to `packages/core/src/demo/__tests__/demo.test.ts`.

### Entering, session and reset

- `/demo` (public, linked from sign-in) shows a card per sample workspace that exists; each card posts to `POST /demo/enter`.
- `enterDemo` (`@causedeck/core/demo`) creates an ephemeral visitor (`visitor.<key>.<id>@demo.causedeck.test`, role `advocate`, membership in that workspace only). Better Auth's `POST /api/auth/demo/sign-in` (`packages/auth/src/demo-provider.ts`, rate limited to 10 per IP per hour) opens the session with `expiresAt` 4 hours out (`DEMO_SESSION_TTL_MS`), created `dontRememberMe` so it is never refreshed and the cookie ends with the browser session.
- The banner (`apps/web/components/shell/demo-banner.tsx`) shows on every page of a `demo` or `demo-*` slug (reserved: no real workspace can take it): `Demo workspace, sample data`, `Sample data only. Nothing here is real, and nothing leaves this workspace.`, `Leave demo` and, from 768 px, `Start your own workspace`; both post to `/demo/leave`, which ends the session.
- `resetDemo` deletes every row of the workspace (the seed's and anything a visitor added; found in the catalogue and deleted children first, except append-only tables and tables the role may not delete from) and its visitors, writes the seed again and records `demo.reset` in the audit log. The `system.demo.reset` job runs it nightly at 03:10 IST and removes visitors older than 4 hours. A reset takes well under the 30 s budget (the test asserts it).
- `app_demo_workspaces()` (owner-defined, ids and slugs only) is the one cross-workspace read: a visitor and the nightly job have no workspace yet.

## Not done yet

Memory items M1 to M5 with provenance, a conflict card, a list diff, an unreconciled direction and a junior handover (the demo-script scenarios in `docs/mvp/04-mvp-definition.md` §9) need seed services for tables whose services do not exist yet. The order PDFs are not stored in the bucket (`@causedeck/db` cannot depend on `@causedeck/storage`). Real fixtures from lawyers are #119, the onboarding link is #92, the load-test harness is #105.
