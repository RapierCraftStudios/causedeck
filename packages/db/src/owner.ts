// Owner-role client for migrations, the test harness and scripts. Deliberately absent from every
// package entry point: application code must never hold schema-owner credentials.
import type { Secret } from '@causedeck/config/env';

import { createDb, type Database } from './client.ts';

export function createOwnerDb(url: Secret): Database {
  return createDb({ url, role: 'owner', max: 1, idleTimeout: 0 });
}
