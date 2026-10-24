// Admin data layer (#309): audited reads of global tables. Pages import from here, never
// `withoutWorkspace` itself. The queries come from `@causedeck/core`, or from the package that owns
// the global table (`@causedeck/flags` for `access_mode_registry`); apps never value-import
// `@causedeck/db` (#299). This layer only scopes and audits them.
import {
  buildBusinessReport,
  businessConfigFromEnv,
  evaluateCostThresholds,
  staffBusinessSnapshot,
  type BusinessConfig,
  type BusinessReport,
  type CostBreach,
  type PlanReport,
} from '@causedeck/core/business';
import {
  coverageReport,
  listSources,
  sourceFetchLogs,
  sourceOpsOverview,
  staffConflictRate,
  staffCoverageInputs,
  staffParseYield,
  type CoverageChange,
  type CoverageGap,
  type ForumCoverage,
  type SourceFetchLogEntry,
  type SourceOpsRow,
  type SourceRecord,
} from '@causedeck/core/sources';
import {
  ACTIVATION_CHANNELS,
  ACTIVATION_STEPS,
  activationFunnel,
  type ActivationChannel,
  type ActivationStep,
  type Funnel,
} from '@causedeck/core/activation';
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
export { ACTIVATION_CHANNELS, ACTIVATION_STEPS };
export type {
  BusinessConfig,
  BusinessReport,
  CostBreach,
  PlanReport,
  ActivationChannel,
  ActivationStep,
  Funnel,
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

/** The business dashboard's figures for the IST month containing `now`: aggregates only (#519). */
export function businessMetrics(
  staff: StaffActor,
  config: BusinessConfig,
  now: Date = new Date(),
): Promise<{ report: BusinessReport; breaches: CostBreach[] }> {
  return staffCall(
    staff,
    {
      purpose: 'business.metrics',
      capability: 'business',
      functions: ['app_staff_business_snapshot'],
    },
    async (db) => {
      const report = buildBusinessReport(
        await staffBusinessSnapshot(db, staff.userId, now),
        config,
      );
      return { report, breaches: evaluateCostThresholds(report, config.costAlertPaisePerUser) };
    },
  );
}

export { businessConfigFromEnv };

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

/**
 * The activation funnel by weekly sign-up cohort, optionally for one channel, with time to first
 * court-day view (#509). Counts and durations only: no user id leaves the core read.
 */
export function growthFunnel(
  staff: StaffActor,
  options: { channel?: ActivationChannel; since?: Date } = {},
  db?: Database,
): Promise<Funnel> {
  return staffQuery(
    staff,
    { purpose: 'growth.funnel', capability: 'growth', tables: ['activation_event'] },
    (tx) => activationFunnel(tx, options),
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

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Every source's 24 hour and 7 day health for the Data Ops page (#514), or just `sourceId`'s. Two
 * audited reads: parse yield through the staff definer function, then `source` and `fetch_log`.
 */
export async function dataOpsOverview(
  staff: StaffActor,
  sourceId?: string,
  now: Date = new Date(),
  db?: Database,
): Promise<SourceOpsRow[]> {
  const [day, week, conflictDay, conflictWeek] = await staffCall(
    staff,
    {
      purpose: 'data_ops.parse_yield',
      capability: 'data-ops',
      functions: ['app_staff_parse_yield', 'app_staff_conflict_rate'],
    },
    (handle) =>
      Promise.all([
        staffParseYield(handle, staff.userId, new Date(now.getTime() - DAY_MS)),
        staffParseYield(handle, staff.userId, new Date(now.getTime() - 7 * DAY_MS)),
        staffConflictRate(handle, staff.userId, new Date(now.getTime() - DAY_MS)),
        staffConflictRate(handle, staff.userId, new Date(now.getTime() - 7 * DAY_MS)),
      ]),
    db,
  );
  return staffQuery(
    staff,
    { purpose: 'data_ops.overview', capability: 'data-ops', tables: ['fetch_log', 'source'] },
    (tx) =>
      sourceOpsOverview(tx, now, { day, week }, sourceId, { day: conflictDay, week: conflictWeek }),
    db,
  );
}

/** One source's newest fetch log rows (status, tier, cost, time; no content) for the drill-down. */
export function dataOpsFetchLogs(
  staff: StaffActor,
  sourceId: string,
  db?: Database,
): Promise<SourceFetchLogEntry[]> {
  return staffQuery(
    staff,
    { purpose: 'data_ops.fetch_log', capability: 'data-ops', tables: ['fetch_log'] },
    (tx) => sourceFetchLogs(tx, sourceId),
    db,
  );
}

export interface CoverageOverview {
  coverage: ForumCoverage[];
  gaps: CoverageGap[];
  changes: CoverageChange[];
}

/** Every catalogue forum against every data type, the ranked gap list and last week's changes (#517). */
export async function coverageOverview(
  staff: StaffActor,
  now: Date = new Date(),
  db?: Database,
): Promise<CoverageOverview> {
  return staffCall(
    staff,
    {
      purpose: 'coverage.overview',
      capability: 'coverage',
      functions: ['app_staff_watch_demand'],
    },
    async (handle) => coverageReport(await staffCoverageInputs(handle, staff.userId, now), now),
    db,
  );
}
