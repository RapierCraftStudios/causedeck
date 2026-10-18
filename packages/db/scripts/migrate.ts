// `pnpm db:migrate`: apply pending migrations as the owner role (DATABASE_URL_OWNER).
import { createEnv } from '@causedeck/config/env';

import { runMigrations } from '../src/migrate.ts';

const url = createEnv().DATABASE_URL_OWNER;
if (url === undefined) {
  console.error('DATABASE_URL_OWNER is not set: migrations run as the schema owner role.');
  process.exit(1);
}

try {
  await runMigrations({
    url,
    logger: {
      info: (message) => {
        console.log(message);
      },
    },
  });
} catch (error) {
  // runMigrations already strips the URL and password from the message.
  console.error(`Migration failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
