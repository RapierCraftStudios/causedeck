// `pnpm seed:system-templates`: upsert the system drafting templates as the owner role
// (DATABASE_URL_OWNER), chained after `pnpm db:migrate`. Idempotent, so it runs on every deploy;
// mirrors the forum catalogue step (ADR 0014).
import { createEnv } from '@causedeck/config/env';

import { withOwnerDb } from '../src/support/staff.ts';
import { seedDraftingSystemTemplates } from '../src/drafting/system-templates.ts';

const url = createEnv().DATABASE_URL_OWNER;
if (url === undefined) {
  console.error('DATABASE_URL_OWNER is not set: system templates are written as the owner role.');
  process.exit(1);
}

try {
  const result = await withOwnerDb(url, seedDraftingSystemTemplates);
  console.log(
    `System templates: ${String(result.inserted)} inserted, ${String(result.updated)} updated, ${String(result.unchanged)} unchanged`,
  );
} catch (error) {
  console.error(
    `System template seed failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
}
