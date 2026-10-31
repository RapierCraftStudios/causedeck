// `pnpm db:seed:demo:content` (#985): the parts of the demo seed that need `@causedeck/storage`.
// Run it after `pnpm db:seed:demo`: it seals the memory items M1 to M7 under each demo workspace's
// key and uploads the SYNTHETIC sample order PDFs to the bucket (MinIO from the local stack, `S3_*`
// env), and embeds the synthetic judgment corpus with the mock embedder (#1070). `--only=memory|files|corpus` runs one part, `--workspace=chennai-solo|bengaluru-chamber|all`
// picks the workspace. Owner role (DATABASE_URL_OWNER). Refuses NODE_ENV=production. Idempotent.
import { createEnv, isProd, serverEnv } from '@causedeck/config/env';
import {
  DEMO_WORKSPACE_KEYS,
  isDemoWorkspaceKey,
  type DemoWorkspaceKey,
} from '@causedeck/db/seed/demo';
import { createObjectStoreFromEnv, EnvKeyProvider } from '@causedeck/storage';

import { seedDemoCorpusEmbeddings, seedDemoFiles, seedDemoMemory } from '../src/demo/content.ts';
import { withOwnerDb } from '../src/support/staff.ts';

if (isProd()) {
  console.error('db:seed:demo:content refuses to run when NODE_ENV=production.');
  process.exit(1);
}
const args = process.argv.slice(2);
const only = args.find((a) => a.startsWith('--only='))?.slice('--only='.length);
if (only !== undefined && only !== 'memory' && only !== 'files' && only !== 'corpus') {
  console.error('--only must be memory, files or corpus');
  process.exit(2);
}
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
  console.error('db:seed:demo:content needs DATABASE_URL_OWNER (the schema-owner connection).');
  process.exit(2);
}

try {
  await withOwnerDb(url, async (db) => {
    if (only === undefined || only === 'corpus') {
      const r = await seedDemoCorpusEmbeddings({ db });
      console.log(`Corpus: ${String(r.embedded)} demo segments embedded (mock embedder)`);
    }
    if (only === undefined || only === 'memory') {
      const keys = EnvKeyProvider.fromEnv(serverEnv());
      for (const key of workspaces) {
        const r = await seedDemoMemory({ db, keys }, key);
        console.log(
          `Memory ${key}: ${String(r.items)} items, ${String(r.proposals)} proposals, ${String(r.usages)} usages`,
        );
      }
    }
    if (only === undefined || only === 'files') {
      const store = createObjectStoreFromEnv(serverEnv());
      for (const key of workspaces) {
        const r = await seedDemoFiles({ db, store }, key);
        console.log(`Files ${key}: ${String(r.files)} sample PDFs`);
      }
    }
  });
} catch (error) {
  console.error(
    `Demo content seed failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
}
