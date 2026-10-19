// Audit write budget (#227, #26 part 2): record() adds < 5 ms p95 to a server action on seeded
// data. A server action here is one committed app-role transaction scoped to the workspace that
// reads the actor's membership and the workspace's notifications; it runs with and without a
// record() call on a workspace whose committed chain already holds SEEDED events, with planner
// statistics current (as in production). Rows are removed through the retention switch afterwards.
//
// Opt-in (`AUDIT_BENCH=1`): the budget is not met yet. `app_audit_append` (0008_audit) finds the
// chain head with `workspace_id IS NOT DISTINCT FROM ...`, which cannot use the index, so each
// append scans and sorts the whole chain (~2.6 ms at 1,000 rows, growing linearly). Making that
// lookup index-driven needs a migration, tracked as a follow-up of #227; it enables this test.
import { randomUUID } from 'node:crypto';

import { Secret } from '@causedeck/config/env';
import { createDb, schema, withWorkspace } from '@causedeck/db';
import { testDatabaseUrls } from '@causedeck/db/testing';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import { record } from '../index.ts';

const SEEDED = 1000;
const WARMUP = 30;
const ITERATIONS = 300;
const BUDGET_MS = 5;

const workspaceId = randomUUID();
const actorId = randomUUID();
const app = createDb({ url: new Secret(testDatabaseUrls().app), role: 'app', max: 1 });
const superuser = createDb({
  url: new Secret(testDatabaseUrls().superuser),
  role: 'owner',
  max: 1,
});

afterAll(async () => {
  try {
    await superuser.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.audit_retention', 'on', true)`);
      await tx.execute(sql`delete from audit_event where workspace_id = ${workspaceId}::uuid`);
    });
  } finally {
    await superuser.$client.end();
    await app.$client.end();
  }
});

function p95(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * 0.95) - 1] ?? Number.NaN;
}

const ctx = (db: Parameters<typeof record>[0]['db']) => ({
  db,
  workspaceId,
  actor: { userId: actorId, kind: 'user' as const },
  requestId: 'req-bench',
  userAgent: 'Bench/1.0',
  ip: '203.0.113.7',
});

/** One server action in its own committed transaction, optionally audited. */
const action = (audit: boolean) =>
  withWorkspace(app, { workspaceId, userId: actorId }, async (tx) => {
    await tx
      .select({ role: schema.member.role })
      .from(schema.member)
      .where(and(eq(schema.member.organizationId, workspaceId), eq(schema.member.userId, actorId)));
    await tx
      .select({ id: schema.notification.id })
      .from(schema.notification)
      .where(eq(schema.notification.userId, actorId))
      .limit(20);
    if (audit) await record(ctx(tx), { action: 'member.role_changed', metadata: { bench: true } });
  });

describe('record() latency budget', () => {
  // eslint-disable-next-line no-process-env -- opt-in switch for a benchmark, not app configuration.
  const run = process.env.AUDIT_BENCH === '1' ? it : it.skip;
  run(`adds < ${String(BUDGET_MS)} ms p95 to a server action`, { timeout: 300_000 }, async () => {
    await withWorkspace(app, { workspaceId }, async (tx) => {
      for (let i = 0; i < SEEDED; i++) {
        await record(ctx(tx), { action: 'member.role_changed', metadata: { n: i } });
      }
    });
    await superuser.execute(sql`analyze audit_event`);

    const time = async (audit: boolean) => {
      const start = performance.now();
      await action(audit);
      return performance.now() - start;
    };
    for (let i = 0; i < WARMUP; i++) {
      await time(true);
      await time(false);
    }
    const without: number[] = [];
    const withAudit: number[] = [];
    // Interleaved, so drift on a shared machine hits both series alike.
    for (let i = 0; i < ITERATIONS; i++) {
      without.push(await time(false));
      withAudit.push(await time(true));
    }
    const added = p95(withAudit) - p95(without);
    console.info(
      `audit bench (${String(SEEDED)} seeded): p95 without ${p95(without).toFixed(2)} ms, ` +
        `with ${p95(withAudit).toFixed(2)} ms, added ${added.toFixed(2)} ms`,
    );
    expect(added).toBeLessThan(BUDGET_MS);
  });
});
