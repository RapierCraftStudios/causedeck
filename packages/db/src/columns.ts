// Column helpers that bake in the spike §4.2 invariants. Every tenant table uses `workspaceId()`
// plus `workspaceIndex()`, and every table that stores a fact uses `provenance()` plus
// `provenanceCheck()`. Names are explicit snake_case so the convention checker reads them as-is.
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  numeric,
  pgEnum,
  text,
  timestamp,
  uuid,
  type AnyPgColumn,
  type CheckBuilder,
  type IndexBuilder,
} from 'drizzle-orm/pg-core';

export const SOURCE_TYPES = [
  'manual',
  'document',
  'capture',
  'adapter',
  'ai',
  'import',
  'system',
] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export const CONFIRMATION_STATES = ['proposed', 'confirmed', 'edited', 'rejected'] as const;
export type ConfirmationState = (typeof CONFIRMATION_STATES)[number];

export const sourceType = pgEnum('source_type', SOURCE_TYPES);
export const confirmationState = pgEnum('confirmation_state', CONFIRMATION_STATES);

/** `id uuid primary key default gen_random_uuid()` (pgcrypto / Postgres 13+). */
export function id() {
  return uuid('id').primaryKey().defaultRandom();
}

/** `created_at` and `updated_at` (timestamptz, not null, default now; `updated_at` bumps on update). */
export function timestamps() {
  return {
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  };
}

/**
 * `workspace_id uuid not null`. Pair it with `workspaceIndex()` in the table's extra config.
 * The FK to `workspace.id` is added by the issue that creates the `workspace` table.
 */
export function workspaceId() {
  return uuid('workspace_id').notNull();
}

/** An index whose leading column is `workspace_id`, as the convention checker requires. */
export function workspaceIndex(
  tableName: string,
  workspace: AnyPgColumn,
  ...rest: AnyPgColumn[]
): IndexBuilder {
  return index(`${tableName}_workspace_id_idx`).on(workspace, ...rest);
}

/** The five provenance columns every fact carries (spike §4.2). */
export function provenance() {
  return {
    sourceType: sourceType('source_type').notNull(),
    sourceRef: text('source_ref'),
    anchorId: uuid('anchor_id'),
    confidence: numeric('confidence', { precision: 4, scale: 3 }),
    confirmationState: confirmationState('confirmation_state').notNull().default('proposed'),
  };
}

/** A non-manual fact must point at its source: an anchor or a source reference. */
export function provenanceCheck(tableName: string): CheckBuilder {
  return check(
    `${tableName}_provenance_chk`,
    sql`source_type = 'manual' or anchor_id is not null or source_ref is not null`,
  );
}
