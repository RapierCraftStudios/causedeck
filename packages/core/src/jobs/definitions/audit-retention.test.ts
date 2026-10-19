// `system.audit.retention` (#230): the window is at least 180 days (CERT-In), default 400; the job
// deletes only through the purge functions, never an event younger than 180 days, and records an
// `audit.retention_purged` summary on the account chain. Backdated rows are seeded as the
// superuser in transactions that are always rolled back; the purge spans the whole database, so
// the assertions look at the seeded ids only.
import { randomBytes, randomUUID } from 'node:crypto';

import { Secret } from '@causedeck/config/env';
import { createDb, type Transaction } from '@causedeck/db';
import { testDatabaseUrls, withTestDb } from '@causedeck/db/testing';
import type { Logger } from '@causedeck/observability';
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';

import { PermanentError } from '../errors.ts';
import { registry } from '../registry.ts';
import {
  assertRetentionDays,
  AUDIT_RETENTION_DEFAULT_DAYS,
  auditRetention,
  runAuditRetention,
} from './audit-retention.ts';

const superuser = createDb({
  url: new Secret(testDatabaseUrls().superuser),
  role: 'owner',
  max: 1,
});

afterAll(async () => {
  await superuser.$client.end();
});

/** Run `fn` as the superuser in a transaction that is always rolled back. */
async function asSuperuser(fn: (tx: Transaction) => Promise<void>): Promise<void> {
  const rollback = new Error('rollback');
  await superuser
    .transaction(async (tx) => {
      await fn(tx);
      throw rollback;
    })
    .catch((error: unknown) => {
      if (error !== rollback) throw error;
    });
}

const AGES = [10, 179, 181, 401, 500] as const;
type Age = (typeof AGES)[number];

/** One audit_event and one ai_call per age (days), returned by age. */
async function seed(tx: Transaction): Promise<Record<Age, { event: string; aiCall: string }>> {
  const workspaceId = randomUUID();
  const out = {} as Record<Age, { event: string; aiCall: string }>;
  for (const age of AGES) {
    const createdAt = sql`now() - make_interval(days => ${age}::int)`;
    // A distinct prev_hash each: (workspace_id, prev_hash) is unique, nulls not distinct.
    const [event] = await tx.execute<{ id: string }>(sql`
      insert into audit_event (workspace_id, actor_kind, action, prev_hash, hash, created_at)
      values (${workspaceId}::uuid, 'system', 'member.removed', ${randomBytes(32)},
              ${randomBytes(32)}, ${createdAt})
      returning id::text`);
    const [aiCall] = await tx.execute<{ id: string }>(sql`
      insert into ai_call (workspace_id, purpose, provider, model, region, automation_level,
                           created_at)
      values (${workspaceId}::uuid, 'test', 'test', 'test', 'in', 1, ${createdAt})
      returning id::text`);
    if (!event || !aiCall) throw new Error('seed failed');
    out[age] = { event: event.id, aiCall: aiCall.id };
  }
  return out;
}

async function surviving(tx: Transaction, seeded: Record<Age, { event: string; aiCall: string }>) {
  const events = await tx.execute<{ id: string }>(
    sql`select id::text from audit_event
        where id in (${sql.join(
          AGES.map((a) => sql`${seeded[a].event}::uuid`),
          sql`, `,
        )})`,
  );
  const aiCalls = await tx.execute<{ id: string }>(
    sql`select id::text from ai_call
        where id in (${sql.join(
          AGES.map((a) => sql`${seeded[a].aiCall}::uuid`),
          sql`, `,
        )})`,
  );
  const ageOf = (kind: 'event' | 'aiCall', id: string) =>
    AGES.find((age) => seeded[age][kind] === id);
  return {
    events: events.map((r) => ageOf('event', r.id)).sort((x, y) => (x ?? 0) - (y ?? 0)),
    aiCalls: aiCalls.map((r) => ageOf('aiCall', r.id)).sort((x, y) => (x ?? 0) - (y ?? 0)),
  };
}

function testLog() {
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() };
  return { log, logger: log as unknown as Logger };
}

describe('audit retention configuration', () => {
  it('refuses a window below 180 days and defaults to 400', () => {
    expect(auditRetention.schema.safeParse({ retentionDays: 179 }).success).toBe(false);
    expect(auditRetention.schema.safeParse({ retentionDays: 0 }).success).toBe(false);
    expect(auditRetention.schema.safeParse({ retentionDays: 180.5 }).success).toBe(false);
    expect(auditRetention.schema.parse({ retentionDays: 180 }).retentionDays).toBe(180);
    expect(auditRetention.schema.parse({}).retentionDays).toBe(AUDIT_RETENTION_DEFAULT_DAYS);
    expect(AUDIT_RETENTION_DEFAULT_DAYS).toBe(400);
  });

  it('assertRetentionDays throws a PermanentError below 180', () => {
    expect(() => {
      assertRetentionDays(179);
    }).toThrow(PermanentError);
    expect(() => {
      assertRetentionDays(Number.NaN);
    }).toThrow(PermanentError);
    expect(() => {
      assertRetentionDays(180);
    }).not.toThrow();
  });

  it('is registered with a daily schedule', () => {
    expect(registry.get('system.audit.retention')).toBe(auditRetention);
    expect(auditRetention.schedule).toEqual({ cron: '0 3 * * *', payload: {} });
  });
});

describe('system.audit.retention', () => {
  it('deletes only events older than the default 400-day window', async () => {
    await asSuperuser(async (tx) => {
      const seeded = await seed(tx);
      const { logger } = testLog();
      const report = await runAuditRetention({ db: tx, log: logger }, 400);

      expect(await surviving(tx, seeded)).toEqual({
        events: [10, 179, 181],
        aiCalls: [10, 179, 181],
      });
      expect(report.auditDeleted).toBeGreaterThanOrEqual(2);
      expect(report.aiCallsDeleted).toBeGreaterThanOrEqual(2);
    });
  });

  it('never deletes an event younger than 180 days, even at the minimum window', async () => {
    await asSuperuser(async (tx) => {
      const seeded = await seed(tx);
      const { logger } = testLog();
      await runAuditRetention({ db: tx, log: logger }, 180);

      expect(await surviving(tx, seeded)).toEqual({ events: [10, 179], aiCalls: [10, 179] });
    });
  });

  it('refuses a window below 180 days before purging anything', async () => {
    await asSuperuser(async (tx) => {
      const seeded = await seed(tx);
      const { logger } = testLog();
      await expect(runAuditRetention({ db: tx, log: logger }, 179)).rejects.toThrow(PermanentError);
      await expect(
        auditRetention.handler(
          { db: tx, log: logger } as unknown as Parameters<typeof auditRetention.handler>[0],
          { retentionDays: 179 },
        ),
      ).rejects.toThrow(PermanentError);
      expect(await surviving(tx, seeded)).toEqual({
        events: [...AGES],
        aiCalls: [...AGES],
      });
    });
  });

  it('records an audit.retention_purged summary on the account chain', async () => {
    await asSuperuser(async (tx) => {
      await seed(tx);
      const { log, logger } = testLog();
      const report = await runAuditRetention({ db: tx, log: logger }, 400);

      const [row] = await tx.execute<{
        workspace_id: string | null;
        actor_kind: string;
        actor_user_id: string | null;
        metadata: Record<string, unknown>;
      }>(sql`
        select workspace_id, actor_kind, actor_user_id, metadata from audit_event
        where action = 'audit.retention_purged'
        order by created_at desc, id desc limit 1`);
      expect(row).toEqual({
        workspace_id: null,
        actor_kind: 'system',
        actor_user_id: null,
        metadata: {
          retentionDays: 400,
          cutoff: report.cutoff,
          auditDeleted: report.auditDeleted,
          aiCallsDeleted: report.aiCallsDeleted,
        },
      });
      expect(Date.parse(report.cutoff)).toBeLessThan(Date.now() - 399 * 86_400_000);
      expect(log.info).toHaveBeenCalledWith(
        {
          retentionDays: 400,
          auditDeleted: report.auditDeleted,
          aiCallsDeleted: report.aiCallsDeleted,
        },
        'audit retention purge',
      );
    });
  });

  it('runs as the app role through the purge functions', async () => {
    await withTestDb(async (tx) => {
      const { logger } = testLog();
      const report = await runAuditRetention({ db: tx, log: logger }, AUDIT_RETENTION_DEFAULT_DAYS);
      expect(report.retentionDays).toBe(400);
      // The app role cannot delete audit rows itself.
      await expect(
        tx.transaction((s) => s.execute(sql`delete from audit_event where false`)),
      ).rejects.toThrow();
    });
  });
});
