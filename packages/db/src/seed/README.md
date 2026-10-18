# Seeds

`seed(db, { profile })` runs every seeder registered for a profile, lowest `order` first.

- `demo`: the synthetic, court-faithful demo data (spike §4.3): two workspaces (a Chennai solo and a Bengaluru chamber) with Madras HC and Karnataka HC nomenclature and **fictional parties only**. It powers the demo, Storybook fixtures and e2e tests.
- `test`: the minimal rows integration tests need.

No seeders exist yet. Each issue that adds tables registers its own:

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
