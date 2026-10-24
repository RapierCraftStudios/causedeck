// `pnpm db:migrate`: apply pending migrations as the owner role (DATABASE_URL_OWNER), then seed the
// system forum catalogue (#34), which only the owner may write. Both are idempotent, so this runs on
// every deploy.
import { createEnv } from '@causedeck/config/env';

import { runMigrations } from '../src/migrate.ts';
import { createOwnerDb } from '../src/owner.ts';
import { redactText } from '../src/redact.ts';
import { seedForumCatalogue } from '../src/seed/forum-catalogue/index.ts';

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

const owner = createOwnerDb(url);
try {
  const result = await seedForumCatalogue(owner);
  console.log(
    `Forum catalogue ${result.version}: ${String(result.inserted)} inserted, ${String(result.updated)} updated, ${String(result.disabled)} disabled`,
  );
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Forum catalogue seed failed: ${redactText(message, [url.reveal()])}`);
  process.exitCode = 1;
} finally {
  await owner.$client.end();
}
