import { index, text, timestamp, uniqueIndex, pgTable } from 'drizzle-orm/pg-core';

import { id, workspaceId, workspaceIndex } from '../columns.ts';

/**
 * Side effects already performed by a background job (#15, spike §3.2). `once()` in
 * `@causedeck/core/jobs` inserts a row before running an effect; the unique key turns a duplicate
 * delivery into a no-op. `system.retention.sweep` expires rows older than 30 days.
 */
export const jobEffect = pgTable(
  'job_effect',
  {
    id: id(),
    jobName: text('job_name').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    workspaceId: workspaceId(),
    completedAt: timestamp('completed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    workspaceIndex('job_effect', t.workspaceId, t.completedAt),
    uniqueIndex('job_effect_workspace_job_key_uq').on(t.workspaceId, t.jobName, t.idempotencyKey),
    index('job_effect_completed_at_idx').on(t.completedAt),
  ],
);
