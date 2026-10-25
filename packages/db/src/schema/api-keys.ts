// Public API keys (#624, #487 part 1). A tenant table under FORCE RLS: one row per key a workspace
// issued. Only the sha256 of the token is stored (the plaintext is shown once, at creation); the
// short `prefix` identifies a key in lists. The API resolves a bearer token before it knows the
// workspace, so it reads a key through `app_api_key_by_hash` (owner-defined, 0081_api_keys).
import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { id } from '../columns.ts';
import { tenantTable } from '../schema-helpers/tenant-table.ts';

import { organization, user } from './auth.ts';

export const apiKey = tenantTable(
  'api_key',
  {
    id: id(),
    name: text('name').notNull(),
    prefix: text('prefix').notNull(),
    tokenHash: text('token_hash').notNull(),
    scopes: text('scopes').array().notNull(),
    /** Billed calls allowed per IST month; null is unlimited. */
    monthlyQuota: integer('monthly_quota'),
    rateLimitPerMinute: integer('rate_limit_per_minute').notNull().default(60),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => user.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  },
  (t) => [
    foreignKey({ columns: [t.workspaceId], foreignColumns: [organization.id] }).onDelete('cascade'),
    uniqueIndex('api_key_token_hash_uq').on(t.tokenHash),
    index('api_key_workspace_idx').on(t.workspaceId, t.createdAt),
    check('api_key_name_chk', sql`length(btrim(name)) between 1 and 100`),
    check('api_key_quota_chk', sql`monthly_quota is null or monthly_quota >= 0`),
    check('api_key_rate_chk', sql`rate_limit_per_minute between 1 and 10000`),
    check('api_key_scopes_chk', sql`cardinality(scopes) > 0`),
  ],
);
