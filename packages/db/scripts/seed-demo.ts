// `pnpm db:seed:demo` (#182): seed the fictional `demo` workspace (and the plan catalogue) as the
// owner role. Refuses when NODE_ENV=production. Idempotent: a second run writes nothing.
import { createEnv, isProd } from '@causedeck/config/env';

import { createOwnerDb } from '../src/owner.ts';
import { seed } from '../src/seed/index.ts';
// Seeders register on import.
import '../src/seed/plans.ts';
import '../src/seed/demo/index.ts';

if (isProd()) {
  console.error('db:seed:demo refuses to run when NODE_ENV=production.');
  process.exit(1);
}

const url = createEnv().DATABASE_URL_OWNER;
if (url === undefined) {
  console.error('db:seed:demo needs DATABASE_URL_OWNER (the schema-owner connection).');
  process.exit(2);
}

const db = createOwnerDb(url);
try {
  const ran = await seed(db, { profile: 'demo' });
  console.log(`Seeded (demo, owner role): ${ran.join(', ')}`);
} finally {
  await db.$client.end();
}
