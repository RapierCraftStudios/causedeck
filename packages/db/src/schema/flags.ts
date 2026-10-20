// Feature flags and the access-mode registry (#22, spike §4.2, docs/engineering/flags.md).
// `feature_flag` holds the staff-managed global rows and `access_mode_registry` the court-adapter
// access modes: both are global tables (GLOBAL_TABLES). Per-workspace overrides live in the tenant
// table `workspace_feature_flag` (FORCE RLS via `tenantTable()`), not in a nullable `workspace_id`
// on `feature_flag`, so they get the standard `ws_isolation` policy and the cross-tenant suite.
// Writes to either flag table fire `pg_notify('flag_changed', key)` (migration 0012_flags).
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { id } from '../columns.ts';
import { tenantTable } from '../schema-helpers/tenant-table.ts';

import { organization, user } from './auth.ts';

/**
 * Closed set of court-adapter access modes (ADR 0011). No member implies automated server-side
 * retrieval from court sites without authorisation; `@causedeck/flags` pins this list in a test.
 */
export const ACCESS_MODE_NAMES = [
  'user_supplied',
  'device_user_triggered',
  'official',
  'licensed',
  'none',
] as const;

export const accessMode = pgEnum('access_mode', ACCESS_MODE_NAMES);

/** Legal-acknowledged rows carry the note that justifies them. */
const legalAckCheck = (table: string) =>
  check(`${table}_legal_ack_chk`, sql`legal_ack_by is null or legal_ack_note is not null`);

/** Global flag rows, one per key; staff-managed (#27), not a tenant table. */
export const featureFlag = pgTable(
  'feature_flag',
  {
    key: text('key').primaryKey(),
    enabled: boolean('enabled').notNull().default(false),
    legalAckBy: uuid('legal_ack_by').references(() => user.id),
    legalAckNote: text('legal_ack_note'),
    updatedBy: uuid('updated_by')
      .notNull()
      .references(() => user.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  () => [legalAckCheck('feature_flag')],
);

/** Per-workspace flag overrides, one per (workspace, key). */
export const workspaceFeatureFlag = tenantTable(
  'workspace_feature_flag',
  {
    key: text('key').notNull(),
    enabled: boolean('enabled').notNull(),
    // Both null once that user's account is deleted (#303); the override stays with the workspace.
    legalAckBy: uuid('legal_ack_by').references(() => user.id, { onDelete: 'set null' }),
    legalAckNote: text('legal_ack_note'),
    updatedBy: uuid('updated_by').references(() => user.id, { onDelete: 'set null' }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('workspace_feature_flag_workspace_key_uq').on(t.workspaceId, t.key),
    foreignKey({
      name: 'workspace_feature_flag_workspace_id_fk',
      columns: [t.workspaceId],
      foreignColumns: [organization.id],
    }).onDelete('cascade'),
    legalAckCheck('workspace_feature_flag'),
  ],
);

/** Which access mode each court adapter may use for a resource. Off until counsel review. */
export const accessModeRegistry = pgTable(
  'access_mode_registry',
  {
    id: id(),
    adapterId: text('adapter_id').notNull(),
    resource: text('resource').notNull(),
    mode: accessMode('mode').notNull(),
    counselNote: text('counsel_note'),
    reviewedBy: uuid('reviewed_by').references(() => user.id),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    enabled: boolean('enabled').notNull().default(false),
  },
  (t) => [unique('access_mode_registry_adapter_resource_uq').on(t.adapterId, t.resource)],
);
