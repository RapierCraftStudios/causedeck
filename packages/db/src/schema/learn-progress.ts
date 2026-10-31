// Practice-school progress (#703 R4, D-049): which learning modules a signed-in user marked done.
// `learn_progress` is global (GLOBAL_TABLES, no `workspace_id`) because a reader's progress belongs
// to the person, not to a chamber, and reading starts before any workspace exists. It is still
// under FORCE row-level security keyed on `app.user_id` (`withUser`): a user sees and writes only
// their own rows, and a scope with no acting user sees nothing. A row holds the user id, the module
// slug and a timestamp: no email, no free text. The slug column carries a shape check; the closed
// list of modules is enforced by the core service. A deleted account cascades.
import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { id } from '../columns.ts';

import { user } from './auth.ts';

export const learnProgress = pgTable(
  'learn_progress',
  {
    id: id(),
    userId: uuid('user_id').notNull(),
    moduleSlug: text('module_slug').notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ columns: [t.userId], foreignColumns: [user.id] }).onDelete('cascade'),
    uniqueIndex('learn_progress_user_module_uq').on(t.userId, t.moduleSlug),
    check(
      'learn_progress_module_slug_chk',
      sql`${t.moduleSlug} ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$' and char_length(${t.moduleSlug}) <= 64`,
    ),
  ],
);
