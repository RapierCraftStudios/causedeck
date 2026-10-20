// Admin data layer (#309): audited reads of global tables. Pages import from here, never
// `withoutWorkspace` itself. The queries come from `@causedeck/core`, or from the package that owns
// the global table (`@causedeck/flags` for `access_mode_registry`); apps never value-import
// `@causedeck/db` (#299). This layer only scopes and audits them.
import {
  countActiveStaff,
  staffAuditEvents,
  staffWorkspaceMetadata,
  staffWorkspaceSearch,
  type StaffAuditCursor,
  type StaffAuditEntry,
  type StaffWorkspaceMetadata,
} from '@causedeck/core/support';
import type { Database } from '@causedeck/db';
import { listAccessModeRegistry, type AccessModeRegistryEntry } from '@causedeck/flags';

import { staffCall, staffQuery, type StaffActor } from './scope.ts';

export {
  staffCall,
  staffQuery,
  StaffQueryDeniedError,
  type StaffActor,
  type StaffCall,
  type StaffQuery,
} from './scope.ts';
export type { StaffAuditCursor, StaffAuditEntry, StaffWorkspaceMetadata };

/** Enabled staff accounts, for the Overview page. */
export function activeStaffCount(staff: StaffActor): Promise<number> {
  return staffQuery(
    staff,
    { purpose: 'overview.staff_count', capability: 'overview', tables: ['staff_user'] },
    (tx) => countActiveStaff(tx),
  );
}

/** Workspaces by slug (prefix) or owner email, metadata only (#310). */
export function searchWorkspaces(
  staff: StaffActor,
  query: string,
): Promise<StaffWorkspaceMetadata[]> {
  return staffCall(
    staff,
    {
      purpose: 'workspaces.search',
      capability: 'workspaces',
      functions: ['app_staff_workspace_search'],
    },
    (db) => staffWorkspaceSearch(db, staff.userId, query),
  );
}

/** One workspace's metadata, or `null` (#310). */
export function workspaceMetadata(
  staff: StaffActor,
  workspaceId: string,
): Promise<StaffWorkspaceMetadata | null> {
  return staffCall(
    staff,
    {
      purpose: 'workspaces.metadata',
      capability: 'workspaces',
      functions: ['app_staff_workspace_metadata'],
    },
    (db) => staffWorkspaceMetadata(db, staff.userId, workspaceId),
  );
}

/** Staff actions from the audit log, newest first, older than `before` when given (#310). */
export function staffAuditLog(
  staff: StaffActor,
  before?: StaffAuditCursor,
): Promise<StaffAuditEntry[]> {
  return staffCall(
    staff,
    { purpose: 'audit.staff_events', capability: 'audit', functions: ['app_staff_audit_events'] },
    (db) => staffAuditEvents(db, staff.userId, { before }),
  );
}

/** Every court-adapter registry row, for the Adapters page (#312). */
export function adapterRegistry(
  staff: StaffActor,
  db?: Database,
): Promise<AccessModeRegistryEntry[]> {
  return staffQuery(
    staff,
    { purpose: 'adapters.registry', capability: 'adapters', tables: ['access_mode_registry'] },
    (tx) => listAccessModeRegistry(tx),
    db,
  );
}
