// The audited admin data layer (#309, part of #27): the only module in apps/admin that may import
// `withoutWorkspace` (lint: WITHOUT_WORKSPACE_ALLOWED_GLOBS). Every read
//   1. checks the staff role may reach the purpose's console area;
//   2. records `staff.read` (actor kind `staff`, no workspace, ids and table names only). The
//      event is fail-closed: a read that cannot be audited does not run;
//   3. runs `fn` with `withoutWorkspace`, which allows only the GLOBAL_TABLES it is told about, so
//      tenant rows stay invisible under FORCE RLS whatever `fn` does. `staffCall` (#310) instead
//      runs a core staff console read, which reaches tenant metadata only through owner-defined
//      functions that refuse anyone but enabled staff.
// Callers pass a fixed query function, never SQL text.
import { record } from '@causedeck/core/audit';
import { db as runtimeDb } from '@causedeck/core/runtime';
import { withoutWorkspace, type Database, type Transaction } from '@causedeck/db';

import { canStaff, type StaffCapability, type StaffRole } from '../roles.ts';

export interface StaffActor {
  userId: string;
  role: StaffRole;
  ip?: string;
  userAgent?: string;
  requestId?: string;
}

export interface StaffQuery {
  /** What the read is for, e.g. `overview.staff_count`; recorded in the audit event. */
  purpose: string;
  /** The console area the read belongs to; the role must reach it. */
  capability: StaffCapability;
  /** The global tables `fn` touches (each must be in GLOBAL_TABLES). */
  tables: readonly string[];
}

export class StaffQueryDeniedError extends Error {
  constructor(purpose: string) {
    super(`staffQuery: role may not read ${purpose}`);
    this.name = 'StaffQueryDeniedError';
  }
}

const PURPOSE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/;

/** Check the purpose and the role, then record `staff.read` (fail-closed) before any read runs. */
async function auditRead(
  staff: StaffActor,
  purpose: string,
  capability: StaffCapability,
  metadata: Record<string, string>,
  db: Database,
): Promise<void> {
  if (!PURPOSE.test(purpose)) throw new TypeError(`staffQuery: invalid purpose "${purpose}"`);
  if (!canStaff(staff.role, capability)) throw new StaffQueryDeniedError(purpose);
  await record(
    {
      db,
      workspaceId: null,
      actor: { userId: staff.userId, kind: 'staff' },
      ...(staff.ip === undefined ? {} : { ip: staff.ip }),
      ...(staff.userAgent === undefined ? {} : { userAgent: staff.userAgent }),
      ...(staff.requestId === undefined ? {} : { requestId: staff.requestId }),
    },
    {
      action: 'staff.read',
      metadata: { purpose, capability, ...metadata, role: staff.role },
    },
  );
}

/** Run one audited, unscoped read of global tables for a staff member. */
export async function staffQuery<T>(
  staff: StaffActor,
  { purpose, capability, tables }: StaffQuery,
  fn: (tx: Transaction) => Promise<T>,
  db: Database = runtimeDb,
): Promise<T> {
  await auditRead(staff, purpose, capability, { tables: [...tables].sort().join(',') }, db);
  return withoutWorkspace(db, { tables }, fn);
}

export interface StaffCall {
  /** What the read is for, e.g. `workspaces.search`; recorded in the audit event. */
  purpose: string;
  /** The console area the read belongs to; the role must reach it. */
  capability: StaffCapability;
  /** The owner-defined functions `fn` calls (e.g. `app_staff_workspace_search`), for the audit. */
  functions: readonly string[];
}

/**
 * Run one audited read through a `@causedeck/core` staff console function (#310). Those read
 * tenant tables only through owner-defined functions that refuse anyone but enabled staff, so the
 * read runs on the root handle, not inside `withoutWorkspace` (which admits global tables only).
 */
export async function staffCall<T>(
  staff: StaffActor,
  { purpose, capability, functions }: StaffCall,
  fn: (db: Database) => Promise<T>,
  db: Database = runtimeDb,
): Promise<T> {
  await auditRead(staff, purpose, capability, { functions: [...functions].sort().join(',') }, db);
  return fn(db);
}
