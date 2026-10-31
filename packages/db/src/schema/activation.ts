// Product activation events (#509, D-030): the funnel behind the Growth page in apps/admin.
// `activation_event` is global (GLOBAL_TABLES): the funnel is per user and per weekly sign-up
// cohort across workspaces, and sign-up happens before any workspace exists. A row holds the user
// id, a step and channel from the closed lists below, a timestamp and, for the two onboarding steps
// that measure it, integer counts of matters discovered and confirmed (#699): no workspace, matter,
// email or any other content, so it carries no personal data beyond the user id. A user reaches a step at
// most once (`activation_event_user_step_uq`): only the first occurrence counts. The app role may
// read and insert rows, never change or delete them (migration 0053); a deleted account cascades.
import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { id } from '../columns.ts';

import { user } from './auth.ts';

/** The funnel, in order. `signed_up` anchors a user's cohort week. */
export const ACTIVATION_STEPS = [
  'signed_up',
  'workspace_created',
  'identifiers_entered',
  'discovery_found',
  'confirm_grid_done',
  'first_court_day_view',
  'first_alert',
  'first_brief',
  'whatsapp_linked',
  'invite_sent',
] as const;
export type ActivationStep = (typeof ACTIVATION_STEPS)[number];

/** How the user arrived; a closed list so no free text (or campaign detail) is stored. */
export const ACTIVATION_CHANNELS = [
  'direct',
  'invite',
  'whatsapp',
  'search',
  'social',
  'referral',
  'education',
  'other',
] as const;
export type ActivationChannel = (typeof ACTIVATION_CHANNELS)[number];

const list = (values: readonly string[]) => values.map((v) => `'${v}'`).join(', ');

export const activationEvent = pgTable(
  'activation_event',
  {
    id: id(),
    userId: uuid('user_id').notNull(),
    step: text('step').notNull().$type<ActivationStep>(),
    channel: text('channel').$type<ActivationChannel>(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    /** Matters the onboarding discovery found (#699). Set on the first insert; null on other steps. */
    mattersDiscovered: integer('matters_discovered'),
    /** Matters the member confirmed into the workspace (#699). Set on the first insert; null otherwise. */
    mattersConfirmed: integer('matters_confirmed'),
  },
  (t) => [
    foreignKey({ columns: [t.userId], foreignColumns: [user.id] }).onDelete('cascade'),
    uniqueIndex('activation_event_user_step_uq').on(t.userId, t.step),
    index('activation_event_step_occurred_idx').on(t.step, t.occurredAt),
    check('activation_event_step_chk', sql.raw(`step in (${list(ACTIVATION_STEPS)})`)),
    check(
      'activation_event_counts_chk',
      sql`(matters_discovered is null or matters_discovered >= 0) and (matters_confirmed is null or matters_confirmed >= 0)`,
    ),
    check(
      'activation_event_channel_chk',
      sql.raw(`channel is null or channel in (${list(ACTIVATION_CHANNELS)})`),
    ),
  ],
);
