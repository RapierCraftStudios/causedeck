# Seeds

`seed(db, { profile })` runs every seeder registered for a profile, lowest `order` first.

- `demo`: the synthetic, court-faithful demo data (spike §4.3): two workspaces (a Chennai solo and a Bengaluru chamber) with Madras HC and Karnataka HC nomenclature and **fictional parties only**. It powers the demo, Storybook fixtures and e2e tests.
- `test`: the minimal rows integration tests need.

Registered seeders:

- `plans` (`plans.ts`, every profile, order 0): the plan catalogue from `@causedeck/billing/plans`, upserted by id so a price edited in the catalogue reaches the table on the next seed.
- `e2e-workspaces` (`e2e.ts`, `e2e` profile, order 10): the fixed e2e workspaces, users and invitations.

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
