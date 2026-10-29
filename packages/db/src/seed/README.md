# Seeds

`seed(db, { profile })` runs every seeder registered for a profile, lowest `order` first.

- `demo`: the synthetic, court-faithful demo data (spike §4.3): two workspaces (a Chennai solo and a Bengaluru chamber) with Madras HC and Karnataka HC nomenclature and **fictional parties only**. It powers the demo, Storybook fixtures and e2e tests.
- `test`: the minimal rows integration tests need.

Registered seeders:

- `plans` (`plans.ts`, every profile, order 0): the plan catalogue from `@causedeck/billing/plans`, upserted by id so a price edited in the catalogue reaches the table on the next seed.
- `e2e-workspaces` (`e2e.ts`, `e2e` profile, order 10): the fixed e2e workspaces, users and invitations.
- `demo-workspace` (`demo/`, `demo` profile, order 20, #182, #93): the two fictional demo workspaces described below.

## The demo workspaces (`pnpm db:seed:demo`)

`pnpm db:seed:demo` runs the `demo` profile as the owner role (`DATABASE_URL_OWNER`); `pnpm db:seed` runs the same seeders as the app role. `--workspace=chennai-solo|bengaluru-chamber|all` picks which (default all); `--reset` deletes the workspace's rows and visitors first. After `pnpm stack:up` and `pnpm db:migrate` it creates two workspaces (#93; the full description is `docs/engineering/demo-seed.md`):

- `demo-chennai-solo` ("Nila Arivazhagan, Advocate (fictional)", Madras High Court) with an advocate (`owner`) and a clerk;
- `demo-bengaluru-chamber` ("Kaveri Demo Chambers (fictional)", High Court of Karnataka, City Civil Court and Mayo Hall) with an advocate (`owner`), a junior and a clerk;
- members sign in by magic link (Mailpit in the local stack): `<advocate|junior|clerk>.<chennai-solo|bengaluru-chamber>@demo.causedeck.test`;
- each workspace has 40 matters (hand-written anchors plus matters from a seeded PRNG), 60+ orders with generated `SYNTHETIC` sample PDFs, 120+ obligations (defects, certified copies, carry-forward items), hearings and lists on every one of the last 30 days, and a canonical next date (some today and tomorrow).

Rules:

- Fictional only: every name ends in "(fictional)", case numbers are `DEMO-NNNN` (shown as `WP-DEMO/2026/0001`), no CNR or neutral citation is ever set, emails use `.test`.
- Idempotent and deterministic: fixed ids, a seeded PRNG and `onConflictDoNothing`, so re-running writes nothing. Dates are offsets from the day of the first run (Asia/Kolkata), so the "today" rows drift on later days; `--reset` (or the nightly `system.demo.reset` job) brings them back.
- Versioned: `DEMO_VERSION` (`demo/meta.ts`) is written to `workspace_settings.demo_version`; `organization.is_demo` marks the workspace and blocks every outward channel and AI spend in it.
- Never in production: the script and `seedDemo` refuse when `NODE_ENV=production`; the nightly reset only restores demo workspaces that already exist.
- Not yet seeded: the PDF objects themselves (the document rows carry the generated PDF's key and sha256; `@causedeck/db` cannot depend on `@causedeck/storage`), memory items M1 to M5, a conflict card, a list diff and the junior handover (no seed service for them yet), notes and activity items (no tables yet).

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
- eCourts district establishments (#635) come from a reviewed snapshot, `forum-catalogue/ecourts/snapshot.json`: `{source, licence, retrievedOn, establishments: [{code, state, district, establishment}]}`. `validateSnapshot` (`ecourts/snapshot.ts`) rejects duplicate codes, unknown states, invalid codes and missing provenance with one error listing every problem; `snapshotToForumSeeds` maps each establishment to an A0 district forum coded `in.<state>.<district>.<establishment>-<code>`. The per-state A1 upgrade is the `ECOURTS_STATE_LEVELS` data flag in the same file. Nothing is fetched from the portal; the shipped snapshot is empty until a cleared list lands (#640). Bump the version when the snapshot changes.

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
