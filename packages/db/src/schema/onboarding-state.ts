// Onboarding wizard state (#92): `onboarding_state` records where one member is in the solo or
// chamber wizard of one workspace, so a refresh or a return later resumes at the same step. One row
// per (workspace, user); the step it is on, the steps completed and the steps skipped. It holds step
// names only, never matter or personal content. Tenant table under FORCE RLS via `tenantTable()`.
import { sql } from 'drizzle-orm';
import { check, foreignKey, jsonb, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

import { id } from '../columns.ts';
import { tenantTable } from '../schema-helpers/tenant-table.ts';

import { organization, user } from './auth.ts';

export const ONBOARDING_PATHS = ['solo', 'chamber'] as const;
export const ONBOARDING_STEP_PATTERN = '^[a-z][a-z-]{0,31}$';

export const onboardingState = tenantTable(
  'onboarding_state',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    path: text('path').notNull(),
    step: text('step').notNull(),
    completed: jsonb('completed').$type<string[]>().notNull().default([]),
    skipped: jsonb('skipped').$type<string[]>().notNull().default([]),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'onboarding_state_workspace_id_fk',
      columns: [t.workspaceId],
      foreignColumns: [organization.id],
    }).onDelete('cascade'),
    unique('onboarding_state_workspace_user_uq').on(t.workspaceId, t.userId),
    check('onboarding_state_path_chk', sql`path in ('solo', 'chamber')`),
    check('onboarding_state_step_chk', sql`step ~ '^[a-z][a-z-]{0,31}$'`),
    check(
      'onboarding_state_lists_chk',
      sql`jsonb_typeof(completed) = 'array' and jsonb_typeof(skipped) = 'array'`,
    ),
  ],
);
