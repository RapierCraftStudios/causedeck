// `pnpm db:check-rls`: fail when a tenant table in the live database lacks ENABLE / FORCE ROW LEVEL
// SECURITY or its `ws_isolation` policy, when a foreign key can cross workspaces, or when a migration
// creates a tenant table without its policies. Reads DATABASE_URL_OWNER (falls back to DATABASE_URL);
// `--url <postgres url>` and `--migrations <dir>` override them (used by the tests).
import { createEnv, Secret } from '@causedeck/config/env';

import { checkMigrationPolicies, checkRls } from '../src/check-rls.ts';
import { createDb } from '../src/client.ts';
import { MIGRATIONS_FOLDER } from '../src/migrate.ts';

function arg(name: string): string | undefined {
  const at = process.argv.indexOf(name);
  return at === -1 ? undefined : process.argv[at + 1];
}

const explicit = arg('--url');
const env = explicit === undefined ? createEnv() : undefined;
const url =
  explicit === undefined ? (env?.DATABASE_URL_OWNER ?? env?.DATABASE_URL) : new Secret(explicit);
if (url === undefined) {
  console.error('DATABASE_URL_OWNER or DATABASE_URL must be set.');
  process.exit(2);
}

const db = createDb({ url, role: 'owner', max: 1 });
let failed = false;
try {
  const violations = await checkRls(db);
  const migrations = checkMigrationPolicies(arg('--migrations') ?? MIGRATIONS_FOLDER);
  if (violations.length > 0) {
    failed = true;
    console.error(`Row-level security violations (${String(violations.length)}):`);
    for (const v of violations) console.error(`  - [${v.rule}] ${v.message}`);
  }
  if (migrations.length > 0) {
    failed = true;
    console.error(`Migrations missing tenant policies (${String(migrations.length)}):`);
    for (const m of migrations) console.error(`  - ${m.file}: ${m.message}`);
  }
  if (!failed) console.log('Row-level security: every tenant table is isolated.');
} catch (error) {
  failed = true;
  console.error(`check-rls failed: ${error instanceof Error ? error.message : String(error)}`);
} finally {
  await db.$client.end();
}
process.exit(failed ? 1 : 0);
