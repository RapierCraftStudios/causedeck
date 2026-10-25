// Installs the `pgboss` schema and every registered queue, as a worker's first start does, then
// exits. The e2e harness runs it once on the template database: the e2e stack has no worker, but
// producers (web and admin servers) refuse to start without the schema and cannot send to a queue
// that does not exist. Usage: DATABASE_URL_OWNER=... tsx scripts/e2e-install-pgboss.ts
import { registry } from '@causedeck/core/jobs';
import { PgBoss } from 'pg-boss';

import { ensureQueue } from '../src/worker.ts';

// eslint-disable-next-line no-process-env -- a one-shot script configured by its caller.
const connectionString = process.env.DATABASE_URL_OWNER;
if (!connectionString) throw new Error('DATABASE_URL_OWNER is required');

const boss = new PgBoss({ connectionString, schema: 'pgboss', application_name: 'e2e-install' });
boss.on('error', (error) => {
  console.error(error);
});
await boss.start();
for (const def of registry.definitions) await ensureQueue(boss, def);
await boss.stop({ graceful: true, timeout: 5000 });
