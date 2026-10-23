// Admin data layer (#309): audited reads of global tables. Pages import from here, never
// `withoutWorkspace` itself. The queries come from `@causedeck/core`, or from the package that owns
// the global table (`@causedeck/flags` for `access_mode_registry`); apps never value-import
// `@causedeck/db` (#299). This layer only scopes and audits them.
import { listSources, type SourceRecord } from '@causedeck/core/sources';
import {
  countActiveStaff,
  staffAuditEvents,
  staffWorkspaceMetadata,
  staffWorkspaceSearch,
  staffWorkspaceUsage,
  type StaffAuditCursor,
  type StaffAuditEntry,
  type StaffBudgetOverride,
  type StaffUsageCounter,
  type StaffWorkspaceMetadata,
  type StaffWorkspaceUsage,
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
export type {
  StaffAuditCursor,
  StaffAuditEntry,
  StaffBudgetOverride,
  StaffUsageCounter,
  StaffWorkspaceMetadata,
  StaffWorkspaceUsage,
};

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

/** One workspace's usage counters and AI budget overrides, or `null` for a malformed id (#224). */
export function workspaceUsage(
  staff: StaffActor,
  workspaceId: string,
): Promise<StaffWorkspaceUsage | null> {
  return staffCall(
    staff,
    {
      purpose: 'workspaces.usage',
      capability: 'workspaces',
      functions: ['app_staff_budget_overrides', 'app_staff_workspace_usage'],
    },
    (db) => staffWorkspaceUsage(db, staff.userId, workspaceId),
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

/** Every external data source in the registry, for the Sources page (#478). */
export function sourceRegistry(staff: StaffActor, db?: Database): Promise<SourceRecord[]> {
  return staffQuery(
    staff,
    { purpose: 'sources.registry', capability: 'sources', tables: ['source'] },
    (tx) => listSources(tx),
    db,
  );
}
