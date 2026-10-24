// Access-mode seeds for the launch adapters (#22). Madras HC and Karnataka HC may use
// `user_supplied` (the lawyer brings the data); every A2 retrieval, live-tracking and sanctioned-push
// row exists but stays disabled until counsel signs off (#120). No `feature_flag` rows are seeded:
// every flag, legal-gated or not, is off on a fresh database.
import type { Queryable } from '@causedeck/db';
import { accessModeRegistry } from '@causedeck/db/schema';
import { sql } from 'drizzle-orm';

import type { AccessMode } from './access-mode.ts';

export interface AccessModeSeed {
  adapterId: string;
  resource: string;
  mode: AccessMode;
  enabled: boolean;
}

export const LAUNCH_ADAPTERS = ['madras-hc', 'karnataka-hc'] as const;

export const ACCESS_MODE_SEED: readonly AccessModeSeed[] = LAUNCH_ADAPTERS.flatMap((adapterId) => [
  { adapterId, resource: 'case-status', mode: 'user_supplied', enabled: true },
  { adapterId, resource: 'a2-retrieval', mode: 'device_user_triggered', enabled: false },
  { adapterId, resource: 'live-tracking', mode: 'device_user_triggered', enabled: false },
  { adapterId, resource: 'sanctioned-push', mode: 'official', enabled: false },
]);

/** Upsert the seed rows (idempotent; re-running resets mode and enabled to the seed values). */
export async function seedAccessModes(db: Queryable): Promise<number> {
  const rows = await db
    .insert(accessModeRegistry)
    .values([...ACCESS_MODE_SEED])
    .onConflictDoUpdate({
      target: [accessModeRegistry.adapterId, accessModeRegistry.resource],
      set: { mode: sql`excluded.mode`, enabled: sql`excluded.enabled` },
    })
    .returning({ id: accessModeRegistry.id });
  return rows.length;
}
