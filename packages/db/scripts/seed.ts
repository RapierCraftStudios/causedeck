// `pnpm db:seed [--profile demo|test|e2e]`: run the registered seeders as the app role.
import { createEnv } from '@causedeck/config/env';

import { createDb } from '../src/client.ts';
import { seed, SEED_PROFILES, type SeedProfile } from '../src/seed/index.ts';
// Seeders register on import.
import '../src/seed/e2e.ts';

const flag = process.argv.indexOf('--profile');
const requested = flag === -1 ? 'demo' : process.argv[flag + 1];
if (!SEED_PROFILES.includes(requested as SeedProfile)) {
  console.error(
    `Unknown seed profile "${String(requested)}". Use one of: ${SEED_PROFILES.join(', ')}.`,
  );
  process.exit(2);
}
const profile = requested as SeedProfile;

const db = createDb({ url: createEnv().DATABASE_URL, role: 'app', max: 1 });
try {
  const ran = await seed(db, { profile });
  console.log(
    ran.length > 0
      ? `Seeded (${profile}): ${ran.join(', ')}`
      : `No seeders registered for "${profile}".`,
  );
} finally {
  await db.$client.end();
}
