// System catalogue versions (#34, ADR 0014): one row per seeded catalogue (`forum_catalogue`, ...)
// holding the version the owner-role seed last applied, so a deploy can tell which catalogue data a
// database carries. Global (GLOBAL_TABLES), no RLS: the app role may only read it (0042).
import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const catalogueMeta = pgTable('catalogue_meta', {
  key: text('key').primaryKey(),
  version: text('version').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
