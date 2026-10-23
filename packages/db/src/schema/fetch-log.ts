// The governed fetch layer's call log (#479, D-048): one global row per external fetch, with ids,
// a URL hash, status, tier and cost only. No body, URL or content columns, so the log can be read
// by staff without exposing what an advocate looked up. `fetch_log` is a global table
// (GLOBAL_TABLES, no RLS); the app role may SELECT and INSERT, never UPDATE or DELETE.
import { index, integer, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { sourceMaxTier } from './source-registry.ts';

export const fetchLog = pgTable(
  'fetch_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceId: text('source_id').notNull(),
    /** sha256 hex of the fetched URL. */
    urlHash: text('url_hash').notNull(),
    /** HTTP status; 0 when the provider failed before a response. */
    status: integer('status').notNull(),
    /** The tier the provider used; null when the call failed. */
    tier: sourceMaxTier('tier'),
    costDollars: numeric('cost_dollars', { precision: 12, scale: 6 }).notNull().default('0'),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
    /** The advocate of a delegated lookup, if any (a user id, not a foreign key: the log outlives users). */
    delegatedAdvocateId: text('delegated_advocate_id'),
  },
  (t) => [index('fetch_log_source_fetched_idx').on(t.sourceId, t.fetchedAt)],
);
