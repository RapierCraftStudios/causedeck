// Shared fixtures for the flags suites: two workspaces and their owners from the cross-tenant
// fixture, so `updated_by` and the workspace foreign keys resolve.
import type { Transaction } from '@causedeck/db';
import { seedTwoTenants, type TwoTenants } from '@causedeck/db/testing/two-tenants';

import type { EvaluateDeps } from '../evaluate.ts';

export type { TwoTenants };

export function seed(tx: Transaction): Promise<TwoTenants> {
  return seedTwoTenants(tx);
}

/** Evaluate against `tx` with no kill switches and no cache. */
export function on(tx: Transaction, killSwitches: Record<string, boolean> = {}): EvaluateDeps {
  return { db: tx, killSwitches, cache: null };
}
