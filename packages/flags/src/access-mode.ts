// Access-mode registry enforcement (#22, PRD CL-6, ADR 0011). A court-adapter capability runs only
// when `access_mode_registry` has an enabled row for (adapter, resource) whose mode is exactly the
// one requested. Every mode other than `user_supplied` also needs the row's counsel note (#369,
// ADR 0015): `device_user_triggered`, `official` and `licensed` stay unusable until counsel has
// cleared them. The mode names are a closed, static allow-list: none of them permits automated
// server-side retrieval from court sites without authorisation, scraping or captcha circumvention,
// and adding one needs a superseding ADR (enforced by `__tests__/access-mode-guard.test.ts`).
import { db as appDb, type Queryable } from '@causedeck/db';
import { accessModeRegistry } from '@causedeck/db/schema';
import { and, asc, eq } from 'drizzle-orm';

export const ACCESS_MODES = [
  'user_supplied',
  'device_user_triggered',
  'official',
  'licensed',
  'none',
] as const;

export type AccessMode = (typeof ACCESS_MODES)[number];

export function isAccessMode(value: unknown): value is AccessMode {
  return typeof value === 'string' && (ACCESS_MODES as readonly string[]).includes(value);
}

export const ACCESS_MODE_DENIED = 'ACCESS_MODE_DENIED' as const;

export type AccessModeDenial =
  | 'unknown-mode'
  | 'no-registry-row'
  | 'disabled'
  | 'mode-none'
  | 'mode-mismatch'
  | 'no-counsel-note';

export class AccessModeError extends Error {
  readonly code = ACCESS_MODE_DENIED;
  readonly reason: AccessModeDenial;

  constructor(reason: AccessModeDenial, adapterId: string, resource: string) {
    super(`Access mode denied for ${adapterId}/${resource}: ${reason}`);
    this.name = 'AccessModeError';
    this.reason = reason;
  }
}

export interface AccessModeRow {
  mode: AccessMode;
  enabled: boolean;
  /** Counsel's note clearing the row; required for every mode other than `user_supplied`. */
  counselNote?: string | null;
}

export type AccessModeDecision = { allowed: true } | { allowed: false; reason: AccessModeDenial };

/** Pure decision for a registry row (or its absence) and the requested mode. */
export function decideAccessMode(
  row: AccessModeRow | undefined,
  requestedMode: unknown,
): AccessModeDecision {
  if (!isAccessMode(requestedMode)) return { allowed: false, reason: 'unknown-mode' };
  if (requestedMode === 'none') return { allowed: false, reason: 'mode-none' };
  if (row === undefined) return { allowed: false, reason: 'no-registry-row' };
  if (!row.enabled) return { allowed: false, reason: 'disabled' };
  if (row.mode === 'none') return { allowed: false, reason: 'mode-none' };
  if (row.mode !== requestedMode) return { allowed: false, reason: 'mode-mismatch' };
  if (requestedMode !== 'user_supplied' && (row.counselNote ?? '').trim() === '') {
    return { allowed: false, reason: 'no-counsel-note' };
  }
  return { allowed: true };
}

export interface AssertAccessModeInput {
  adapterId: string;
  resource: string;
  requestedMode: AccessMode;
}

/**
 * Throw `AccessModeError` (`ACCESS_MODE_DENIED`) unless the registry allows `requestedMode` for the
 * adapter's resource (with a counsel note for any mode but `user_supplied`). `access_mode_registry` is a global table, readable in any scope.
 */
export async function assertAccessMode(
  { adapterId, resource, requestedMode }: AssertAccessModeInput,
  { db = appDb }: { db?: Queryable } = {},
): Promise<void> {
  const [row] = await db
    .select({
      mode: accessModeRegistry.mode,
      enabled: accessModeRegistry.enabled,
      counselNote: accessModeRegistry.counselNote,
    })
    .from(accessModeRegistry)
    .where(
      and(eq(accessModeRegistry.adapterId, adapterId), eq(accessModeRegistry.resource, resource)),
    )
    .limit(1);
  const decision = decideAccessMode(row, requestedMode);
  if (!decision.allowed) throw new AccessModeError(decision.reason, adapterId, resource);
}

/** One `access_mode_registry` row, as the staff console's Adapters page lists it (#312). */
export interface AccessModeRegistryEntry {
  adapterId: string;
  resource: string;
  mode: AccessMode;
  enabled: boolean;
  reviewedAt: Date | null;
}

/**
 * Every registry row, ordered by adapter then resource. Read-only; `access_mode_registry` is a
 * global table, readable in any scope. The handle is required so the admin data layer passes its
 * audited `withoutWorkspace` transaction.
 */
export async function listAccessModeRegistry(db: Queryable): Promise<AccessModeRegistryEntry[]> {
  return db
    .select({
      adapterId: accessModeRegistry.adapterId,
      resource: accessModeRegistry.resource,
      mode: accessModeRegistry.mode,
      enabled: accessModeRegistry.enabled,
      reviewedAt: accessModeRegistry.reviewedAt,
    })
    .from(accessModeRegistry)
    .orderBy(asc(accessModeRegistry.adapterId), asc(accessModeRegistry.resource));
}
