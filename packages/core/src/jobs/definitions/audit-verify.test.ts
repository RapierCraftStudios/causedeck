// Nightly audit chain verification (#230): `audit.verify` verifies one workspace's chain from its
// oldest surviving row and logs a critical `audit.chain_mismatch` when a row was altered;
// `system.audit.verify` verifies the account chain and fans out one `audit.verify` per workspace.
// Tampering runs as the superuser in transactions that are always rolled back.
import { randomUUID } from 'node:crypto';

import { Secret } from '@causedeck/config/env';
import { createDb, schema, withWorkspace, type Transaction } from '@causedeck/db';
import { testDatabaseUrls, withTestDb } from '@causedeck/db/testing';
import type { Logger } from '@causedeck/observability';
import { asc, eq, isNull, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';

import { record, verifyChain } from '../../audit/index.ts';
import { registry } from '../registry.ts';
import {
  auditVerify,
  CHAIN_MISMATCH_EVENT,
  runAccountChainVerify,
  runAuditVerify,
  runAuditVerifySchedule,
  systemAuditVerify,
} from './audit-verify.ts';

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

function testLog() {
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() };
  return { log, logger: log as unknown as Logger };
}

const system = (db: Transaction, workspaceId: string | null) => ({
  db,
  workspaceId,
  actor: { userId: null, kind: 'system' as const },
});

async function writeChain(tx: Transaction, workspaceId: string | null, n = 3): Promise<void> {
  for (let i = 1; i <= n; i++) {
    await record(system(tx, workspaceId), { action: 'member.removed', metadata: { n: i } });
  }
}

async function workspaceChain(tx: Transaction, workspaceId: string) {
  return withWorkspace(tx, { workspaceId }, (s) =>
    s
      .select({ id: schema.auditEvent.id })
      .from(schema.auditEvent)
      .where(eq(schema.auditEvent.workspaceId, workspaceId))
      .orderBy(asc(schema.auditEvent.createdAt), asc(schema.auditEvent.id)),
  );
}

async function tamper(tx: Transaction, id: string): Promise<void> {
  await tx.execute(sql`set local session_replication_role = replica`);
  await tx.execute(sql`update audit_event set metadata = '{"n":99}'::jsonb where id = ${id}::uuid`);
  await tx.execute(sql`set local session_replication_role = origin`);
}

describe('audit.verify', () => {
  it('verifies an untouched workspace chain as the app role', async () => {
    await withTestDb(async (tx) => {
      const workspaceId = randomUUID();
      await writeChain(tx, workspaceId);
      const { log, logger } = testLog();

      const result = await withWorkspace(tx, { workspaceId }, (s) =>
        runAuditVerify({ db: s, log: logger }, workspaceId),
      );

      expect(result).toEqual({ ok: true, checked: 3 });
      expect(log.fatal).not.toHaveBeenCalled();
      expect(log.info).toHaveBeenCalledWith({ workspaceId, checked: 3 }, 'audit chain verified');
    });
  });

  it('logs a critical audit.chain_mismatch for a row altered behind the trigger', async () => {
    await asSuperuser(async (tx) => {
      const workspaceId = randomUUID();
      await writeChain(tx, workspaceId);
      const [, middle] = await workspaceChain(tx, workspaceId);
      if (!middle) throw new Error('chain missing');
      await tamper(tx, middle.id);
      const { log, logger } = testLog();

      const result = await runAuditVerify({ db: tx, log: logger }, workspaceId);

      expect(result).toEqual({
        ok: false,
        checked: 3,
        brokenAt: { id: middle.id, reason: 'hash' },
      });
      expect(log.fatal).toHaveBeenCalledWith(
        {
          event: CHAIN_MISMATCH_EVENT,
          severity: 'critical',
          workspaceId,
          eventId: middle.id,
          reason: 'hash',
          checked: 3,
        },
        'audit.chain_mismatch',
      );
    });
  });

  it('accepts a chain whose oldest events were purged by retention', async () => {
    await asSuperuser(async (tx) => {
      const workspaceId = randomUUID();
      await writeChain(tx, workspaceId);
      const [first] = await workspaceChain(tx, workspaceId);
      if (!first) throw new Error('chain missing');
      await tx.execute(sql`select set_config('app.audit_retention', 'on', true)`);
      await tx.execute(sql`delete from audit_event where id = ${first.id}::uuid`);
      await tx.execute(sql`select set_config('app.audit_retention', '', true)`);
      // A whole-chain check expects a null head prev_hash, so it would flag every purged chain.
      expect((await verifyChain(tx, workspaceId)).brokenAt?.reason).toBe('link');
      const { log, logger } = testLog();

      expect(await runAuditVerify({ db: tx, log: logger }, workspaceId)).toEqual({
        ok: true,
        checked: 2,
      });
      expect(log.fatal).not.toHaveBeenCalled();
    });
  });
});

describe('system.audit.verify', () => {
  it('reports a tampered account-level event with a null workspace', async () => {
    await asSuperuser(async (tx) => {
      // Start the account chain afresh inside this rolled-back transaction.
      await tx.execute(sql`select set_config('app.audit_retention', 'on', true)`);
      await tx.execute(sql`delete from audit_event where workspace_id is null`);
      await tx.execute(sql`select set_config('app.audit_retention', '', true)`);
      await writeChain(tx, null);
      const { log, logger } = testLog();
      expect(await runAccountChainVerify({ db: tx, log: logger })).toEqual({
        ok: true,
        checked: 3,
      });

      const [, middle] = await tx
        .select({ id: schema.auditEvent.id })
        .from(schema.auditEvent)
        .where(isNull(schema.auditEvent.workspaceId))
        .orderBy(asc(schema.auditEvent.createdAt), asc(schema.auditEvent.id));
      if (!middle) throw new Error('chain missing');
      await tamper(tx, middle.id);

      expect(await runAccountChainVerify({ db: tx, log: logger })).toEqual({
        ok: false,
        checked: 3,
        brokenAt: { id: middle.id, reason: 'hash' },
      });
      expect(log.fatal).toHaveBeenCalledWith(
        {
          event: CHAIN_MISMATCH_EVENT,
          severity: 'critical',
          workspaceId: null,
          eventId: middle.id,
          reason: 'hash',
          checked: 3,
        },
        'audit.chain_mismatch',
      );
    });
  });

  it('enqueues one audit.verify per workspace chain, as the app role', async () => {
    await withTestDb(async (tx) => {
      const [a, b] = [randomUUID(), randomUUID()];
      await writeChain(tx, a, 1);
      await writeChain(tx, b, 1);
      const enqueue = vi.fn(() => Promise.resolve('job'));
      const { logger } = testLog();

      const enqueued = await runAuditVerifySchedule({ db: tx, log: logger }, { enqueue });

      expect(enqueued).toEqual(expect.arrayContaining([a, b]));
      expect(enqueue).toHaveBeenCalledWith(a);
      expect(enqueue).toHaveBeenCalledWith(b);
      expect(enqueue).toHaveBeenCalledTimes(enqueued.length);
    });
  });

  it('is registered with a nightly schedule and a per-workspace job', () => {
    expect(registry.get('system.audit.verify')).toBe(systemAuditVerify);
    expect(registry.get('audit.verify')).toBe(auditVerify);
    expect(systemAuditVerify.schedule).toEqual({ cron: '0 2 * * *', payload: {} });
    expect(auditVerify.schema.safeParse({}).success).toBe(false);
  });
});
