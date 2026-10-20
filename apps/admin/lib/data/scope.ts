// The audited admin data layer (#309, part of #27): the only module in apps/admin that may import
// `withoutWorkspace` (lint: WITHOUT_WORKSPACE_ALLOWED_GLOBS). Every read
//   1. checks the staff role may reach the purpose's console area;
//   2. records `staff.read` (actor kind `staff`, no workspace, ids and table names only). The
//      event is fail-closed: a read that cannot be audited does not run;
//   3. runs `fn` with `withoutWorkspace`, which allows only the GLOBAL_TABLES it is told about, so
//      tenant rows stay invisible under FORCE RLS whatever `fn` does.
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

/** Run one audited, unscoped read of global tables for a staff member. */
export async function staffQuery<T>(
  staff: StaffActor,
  { purpose, capability, tables }: StaffQuery,
  fn: (tx: Transaction) => Promise<T>,
  db: Database = runtimeDb,
): Promise<T> {
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
      metadata: { purpose, capability, tables: [...tables].sort().join(','), role: staff.role },
    },
  );
  return withoutWorkspace(db, { tables }, fn);
}
