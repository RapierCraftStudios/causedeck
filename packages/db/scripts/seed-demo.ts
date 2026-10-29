// `pnpm db:seed:demo` (#182, #93): seed the fictional demo workspaces (and the plan catalogue) as
// the owner role. `--workspace=chennai-solo|bengaluru-chamber|all` picks which (default all);
// `--reset` deletes the workspace's rows and visitors first. Refuses when NODE_ENV=production.
// Idempotent: a second run writes nothing.
import { createEnv, isProd } from '@causedeck/config/env';

import { createOwnerDb } from '../src/owner.ts';
import { seed } from '../src/seed/index.ts';
import {
  DEMO_WORKSPACE_KEYS,
  isDemoWorkspaceKey,
  resetDemoWorkspace,
  seedDemo,
  type DemoWorkspaceKey,
} from '../src/seed/demo/index.ts';
// Seeders register on import.
import '../src/seed/plans.ts';
import '../src/seed/demo/index.ts';

if (isProd()) {
  console.error('db:seed:demo refuses to run when NODE_ENV=production.');
  process.exit(1);
}

const args = process.argv.slice(2);
const reset = args.includes('--reset');
const selected =
  args.find((a) => a.startsWith('--workspace='))?.slice('--workspace='.length) ?? 'all';
if (selected !== 'all' && !isDemoWorkspaceKey(selected)) {
  console.error(`--workspace must be all or one of: ${DEMO_WORKSPACE_KEYS.join(', ')}`);
  process.exit(2);
}
const workspaces: readonly DemoWorkspaceKey[] =
  selected === 'all' ? DEMO_WORKSPACE_KEYS : [selected];

const url = createEnv().DATABASE_URL_OWNER;
if (url === undefined) {
  console.error('db:seed:demo needs DATABASE_URL_OWNER (the schema-owner connection).');
  process.exit(2);
}

const db = createOwnerDb(url);
try {
  if (reset) {
    for (const key of workspaces) {
      const result = await resetDemoWorkspace(db, key);
      console.log(`Reset ${key}: ${String(result.rows)} rows, ${String(result.visitors)} visitors`);
    }
  }
  if (selected === 'all') {
    const ran = await seed(db, { profile: 'demo' });
    console.log(`Seeded (demo, owner role): ${ran.join(', ')}`);
  } else {
    await seedDemo(db, { workspaces });
    console.log(`Seeded (demo, owner role): ${selected}`);
  }
} finally {
  await db.$client.end();
}
