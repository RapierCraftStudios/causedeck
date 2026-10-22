# Seeds

`seed(db, { profile })` runs every seeder registered for a profile, lowest `order` first.

- `demo`: the synthetic, court-faithful demo data (spike §4.3): two workspaces (a Chennai solo and a Bengaluru chamber) with Madras HC and Karnataka HC nomenclature and **fictional parties only**. It powers the demo, Storybook fixtures and e2e tests.
- `test`: the minimal rows integration tests need.

Registered seeders:

- `plans` (`plans.ts`, every profile, order 0): the plan catalogue from `@causedeck/billing/plans`, upserted by id so a price edited in the catalogue reaches the table on the next seed.
- `e2e-workspaces` (`e2e.ts`, `e2e` profile, order 10): the fixed e2e workspaces, users and invitations.
- `demo-workspace` (`demo/`, `demo` profile, order 20, #182): the fictional `demo` workspace described below.

## The demo workspace (`pnpm db:seed:demo`)

`pnpm db:seed:demo` runs the `demo` profile as the owner role (`DATABASE_URL_OWNER`); `pnpm db:seed` runs the same seeders as the app role. After `pnpm stack:up` and `pnpm db:migrate` it creates:

- the workspace `demo` ("Kaveri Demo Chambers (fictional)"; the slug is reserved, and the shell shows a "Demo data — fictional" banner for it) with three members who sign in by magic link (Mailpit in the local stack): `advocate@demo.causedeck.test` (the lead advocate, `owner` role), `junior@demo.causedeck.test` and `clerk@demo.causedeck.test`;
- the workspace's own forums for the Madras High Court, the City Civil Court, Bengaluru and the High Court of Karnataka, with halls and fictional benches;
- 25 matters (writ, civil suit, bail, arbitration, family), each with a client, an opposing party and counsel, its proceedings (one W.P. with two W.M.P.s and a W.A.), two past hearings, a canonical next listing (some today and tomorrow), an order with a generated sample PDF, obligations (overdue, due today, upcoming, done) and tasks.

Rules:

- Fictional only: every name ends in "(fictional)", case numbers are `DEMO-NNNN` (shown as `WP-DEMO/2026/0001`), no CNR or neutral citation is ever set, emails use `.test`.
- Idempotent: fixed ids and `onConflictDoNothing`, so re-running writes nothing. Dates are offsets from the day of the first run (Asia/Kolkata), so the "today" rows drift on later days; `pnpm stack:reset` and a re-seed brings them back.
- Never in production: the script and `seedDemo` refuse when `NODE_ENV=production`.
- Not yet seeded: the PDF objects themselves (the document rows carry the generated PDF's key and sha256; `@causedeck/db` cannot depend on `@causedeck/storage`), notes and activity items (no tables yet). The screens that read this data arrive with their own issues; the full demo mode is #93.

## Synthetic matter sets (`@causedeck/db/seed/synthetic`)

`syntheticMatterSet({ market, workspaceId, forumIds, ownerMemberIds?, matters?, proceedingsPerMatter?, today })` returns the rows of a fictional **Chennai solo** (`chennai-solo`, Madras HC nomenclature: W.P., O.S., Crl.O.P. with W.M.P. children) or **Bengaluru chamber** (`bengaluru-chamber`, Karnataka HC: W.P., R.F.A., O.S. with I.A. children) practice. `insertSyntheticMatterSet(db, set)` writes them into the set's workspace. At the defaults (250 matters, 3 proceedings each) the two sets make the 500 matters / 1,500 proceedings the matters-list perf check runs on (`packages/core/src/matter-graph/__tests__/search-perf.test.ts`, #386).

- Each matter has a client (with a `.test` email), an opposing party and opposite counsel as role edges, a numbered main proceeding with SR-stage children, and, by turns, no next date, only a past one, an upcoming one, or an upcoming one with a conflicting proposed date; every third matter has an open obligation.
- Fictional only: names end in "(fictional)", case numbers are `SYN-NNNN` (Chennai from 0001, Bengaluru from 5001), no CNR or neutral citation.
- Deterministic and idempotent: ids derive from the market, the workspace and a running number, and the insert uses `onConflictDoNothing`. Dates are offsets from `today`.
- Not registered in the seed registry, so `pnpm db:seed` does not load 500 matters; stories, e2e and perf tests call it with a workspace, forums and members of their own. Refused when `NODE_ENV=production`.

The system forum catalogue (`forum-catalogue/`, #34, ADR 0014) is **not** in this registry: catalogue rows (`forum` with a null `workspace_id`) are writable by the owner role only, and `pnpm db:seed` runs as the app role. `pnpm db:migrate` runs `seedForumCatalogue()` as the owner after the migrations, so every deploy re-applies it:

- the entries are typed `ForumSeed[]` per market (`madras-hc.ts`, `karnataka-hc.ts`, `chennai-district.ts`, `bengaluru-district.ts`, `tribunals.ts`), parsed with `ForumSeedSchema` from `@causedeck/validators/forum`; hosts and deep-link templates are data, never constants in code;
- the upsert is keyed by `forum_scope_code_uq` and touches only rows whose data changed (unchanged rows keep `updated_at`); a catalogue row no longer listed is soft-disabled (`enabled = false`, `config.disabledReason`), never deleted;
- bump `FORUM_CATALOGUE_VERSION` with every data change; the seed records it in `catalogue_meta` (key `forum_catalogue`).

Each issue that adds tables registers its own:

```ts
import { registerSeed } from '@causedeck/db/seed';

registerSeed({
  name: 'workspace',
  profiles: ['demo', 'test'],
  order: 10,
  run: async (db) => {
    await db.insert(workspace).values([...]);
  },
});
```

Run the demo profile against the local stack with `pnpm db:seed` (app role, `DATABASE_URL`); use `pnpm db:seed -- --profile test` for the test profile. Seeders must be idempotent (`onConflictDoNothing`) and must never contain real client or party data.
