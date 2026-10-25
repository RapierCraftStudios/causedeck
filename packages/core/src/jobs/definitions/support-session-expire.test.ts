// `system.support.session-expire` (#308): the job has no workspace, yet it must expire elapsed
// support-session grants in every workspace (through `app_expire_support_sessions()`), audit
// `support.session_ended` for each, and leave live grants and pending requests alone. Runs as
// causedeck_app in a rolled-back transaction.
import { randomUUID } from 'node:crypto';

import { schema, type Database, type Transaction } from '@causedeck/db';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { createLogger } from '@causedeck/observability';
import { and, eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { runJob } from '../context.ts';
import { supportSessionExpire } from './support-session-expire.ts';

const logger = createLogger({ service: 'test', level: 'silent' });

async function workspace(tx: Transaction): Promise<{ id: string; userId: string }> {
  const [u] = await tx
    .insert(schema.user)
    .values({ name: 'Staff', email: `staff-${randomUUID()}@example.test` })
    .returning({ id: schema.user.id });
  if (!u) throw new Error('user insert failed');
  const id = randomUUID();
  await inWorkspace(tx, id, (s) =>
    s.insert(schema.organization).values({ id, name: 'Expiry', slug: `exp-${id}` }),
  );
  return { id, userId: u.id };
}

/** A session granted `minutesAgo` minutes ago for 60 minutes (or a pending request). */
async function session(
  tx: Transaction,
  ws: { id: string; userId: string },
  minutesAgo: number | null,
): Promise<string> {
  return inWorkspace(tx, ws.id, async (s) => {
    const grantedAt = sql`now() - make_interval(mins => ${minutesAgo ?? 0})`;
    const [row] = await s
      .insert(schema.supportSession)
      .values({
        workspaceId: ws.id,
        requestedByStaff: ws.userId,
        reason: 'Expiry test',
        scope: 'view',
        ...(minutesAgo === null
          ? {}
          : {
              status: 'granted' as const,
              grantedAt,
              expiresAt: sql`${grantedAt} + interval '60 minutes'`,
            }),
      })
      .returning({ id: schema.supportSession.id });
    if (!row) throw new Error('support_session insert failed');
    return row.id;
  });
}

describe('system.support.session-expire', () => {
  it('is a scheduled, singleton system job', () => {
    expect(supportSessionExpire.name).toBe('system.support.session-expire');
    expect(supportSessionExpire.schedule).toMatchObject({ cron: '* * * * *' });
  });

  it('expires elapsed grants in every workspace, audits each, and keeps the rest', async () => {
    await withTestDb(async (tx) => {
      const a = await workspace(tx);
      const b = await workspace(tx);
      const elapsedA = await session(tx, a, 61);
      const elapsedB = await session(tx, b, 120);
      const live = await session(tx, a, 5);
      const pending = await session(tx, b, null);

      const outcome = await runJob(
        supportSessionExpire,
        { id: randomUUID(), data: {}, retryCount: 0 },
        { db: tx as unknown as Database, logger },
      );
      expect(outcome).toEqual({ status: 'completed' });

      for (const [ws, expected] of [
        [a, { [elapsedA]: 'expired', [live]: 'granted' }],
        [b, { [elapsedB]: 'expired', [pending]: 'requested' }],
      ] as const) {
        const rows = await inWorkspace(tx, ws.id, (s) =>
          s
            .select({ id: schema.supportSession.id, status: schema.supportSession.status })
            .from(schema.supportSession),
        );
        expect(Object.fromEntries(rows.map((r) => [r.id, r.status]))).toEqual(expected);
        const ended = await inWorkspace(tx, ws.id, (s) =>
          s
            .select({
              targetId: schema.auditEvent.targetId,
              actorKind: schema.auditEvent.actorKind,
            })
            .from(schema.auditEvent)
            .where(
              and(
                eq(schema.auditEvent.workspaceId, ws.id),
                eq(schema.auditEvent.action, 'support.session_ended'),
              ),
            ),
        );
        expect(ended).toEqual([{ targetId: ws === a ? elapsedA : elapsedB, actorKind: 'staff' }]);
      }
    });
  });
});
