import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { id } from '../columns.ts';

import { organization, user } from './auth.ts';

/** A stored API response, replayed verbatim for a repeated `Idempotency-Key`. */
export interface StoredApiResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

/**
 * `Idempotency-Key` records for `POST` requests to `apps/api` (#14). Keys are scoped by user, not
 * by workspace, so the table is global (see GLOBAL_TABLES); `workspace_id` is informational and
 * null for requests that carry no workspace. Rows expire 24 h after the first request.
 */
export const apiIdempotencyKey = pgTable(
  'api_idempotency_key',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    workspaceId: uuid('workspace_id').references(() => organization.id, { onDelete: 'cascade' }),
    method: text('method').notNull(),
    path: text('path').notNull(),
    requestHash: text('request_hash').notNull(),
    response: jsonb('response').$type<StoredApiResponse>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex('api_idempotency_key_user_key_uq').on(t.userId, t.key),
    index('api_idempotency_key_expires_at_idx').on(t.expiresAt),
  ],
);
