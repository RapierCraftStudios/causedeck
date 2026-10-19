// record() against a real Postgres (#227, #26 part 2): rows carry actor, action, target, outcome,
// request id and a hashed user agent; IPs only for security actions; account-level events; and the
// fail-closed / fail-open policy. Every test runs in a rolled-back app-role transaction.
import { createHash, randomUUID } from 'node:crypto';

import { schema, withUser, withWorkspace, type Transaction } from '@causedeck/db';
import type * as Observability from '@causedeck/observability';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { eq, sql } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { record, type AuditContext } from '../index.ts';
import { failure, newUser, sqlState } from '../../__tests__/fixtures.ts';

const logged = vi.hoisted(() => ({ error: [] as unknown[][] }));

vi.mock('@causedeck/observability', async (importOriginal) => {
  const actual = await importOriginal<typeof Observability>();
  return {
    ...actual,
    createLogger: (options: Parameters<typeof actual.createLogger>[0]) => {
      const real = actual.createLogger({ ...options, level: 'silent' });
      return new Proxy(real, {
        get(target, prop, receiver) {
          if (prop === 'error') {
            return (...args: unknown[]) => {
              logged.error.push(args);
            };
          }
          return Reflect.get(target, prop, receiver) as unknown;
        },
      });
    },
  };
});

afterEach(() => {
  logged.error.length = 0;
});

const UA = 'Mozilla/5.0 (X11; Linux x86_64) CauseDeckTest/1.0';

async function rows(tx: Transaction, workspaceId: string) {
  return inWorkspace(tx, workspaceId, (s) =>
    s.select().from(schema.auditEvent).where(eq(schema.auditEvent.workspaceId, workspaceId)),
  );
}

function ctx(tx: Transaction, workspaceId: string | null, userId: string | null): AuditContext {
  return {
    db: tx,
    workspaceId,
    actor: { userId, kind: 'user' },
    requestId: 'req-227',
    userAgent: UA,
    ip: '203.0.113.7',
  };
}

describe('record', () => {
  it('writes a workspace event with actor, action, target, outcome, request id and UA hash', async () => {
    await withTestDb(async (tx) => {
      const workspaceId = randomUUID();
      const actor = randomUUID();
      await record(ctx(tx, workspaceId, actor), {
        action: 'member.role_changed',
        target: { kind: 'member', id: 'm-1' },
        outcome: 'denied',
        metadata: { from: 'junior', to: 'clerk' },
      });
      const [row, ...rest] = await rows(tx, workspaceId);
      expect(rest).toHaveLength(0);
      expect(row).toMatchObject({
        workspaceId,
        actorUserId: actor,
        actorKind: 'user',
        action: 'member.role_changed',
        targetKind: 'member',
        targetId: 'm-1',
        outcome: 'denied',
        requestId: 'req-227',
        userAgentHash: createHash('sha256').update(UA).digest('hex'),
        metadata: { from: 'junior', to: 'clerk' },
      });
      expect(JSON.stringify(row)).not.toContain('Mozilla');
      expect(row?.prevHash).toBeNull();
      expect(row?.hash).toBeInstanceOf(Buffer);
    });
  });

  it('writes inside the caller transaction: a rolled-back action leaves no event', async () => {
    await withTestDb(async (tx) => {
      const workspaceId = randomUUID();
      await failure(
        withWorkspace(tx, { workspaceId }, async (s) => {
          await record(ctx(s, workspaceId, null), { action: 'member.removed' });
          throw new Error('action failed after auditing');
        }),
      );
      expect(await rows(tx, workspaceId)).toHaveLength(0);
    });
  });

  it('defaults the outcome to success and stores no UA hash without a user agent', async () => {
    await withTestDb(async (tx) => {
      const workspaceId = randomUUID();
      await record(
        { db: tx, workspaceId, actor: { userId: null, kind: 'system' } },
        { action: 'member.removed' },
      );
      const [row] = await rows(tx, workspaceId);
      expect(row).toMatchObject({
        outcome: 'success',
        userAgentHash: null,
        requestId: null,
        actorKind: 'system',
      });
    });
  });

  it('stores the IP for security actions only', async () => {
    await withTestDb(async (tx) => {
      const workspaceId = randomUUID();
      await record(ctx(tx, workspaceId, null), { action: 'member.removed' });
      await record(ctx(tx, workspaceId, null), { action: 'workspace.settings_viewed' });
      const byAction = Object.fromEntries(
        (await rows(tx, workspaceId)).map((r) => [r.action, r.ip]),
      );
      expect(byAction).toEqual({
        'member.removed': '203.0.113.7',
        'workspace.settings_viewed': null,
      });
    });
  });

  it('is append-only for the app role', async () => {
    await withTestDb(async (tx) => {
      const workspaceId = randomUUID();
      await record(ctx(tx, workspaceId, null), { action: 'member.removed' });
      for (const statement of [
        sql`update audit_event set action = 'x' where workspace_id = ${workspaceId}::uuid`,
        sql`delete from audit_event where workspace_id = ${workspaceId}::uuid`,
      ]) {
        const error = await failure(
          inWorkspace(tx, workspaceId, (s) => s.transaction((sp) => sp.execute(statement))),
        );
        expect(sqlState(error)).toBe('42501');
      }
    });
  });

  it('writes account-level events on the account chain in their own transaction', async () => {
    await withTestDb(async (tx) => {
      const userId = await newUser(tx);
      await record(ctx(tx, null, userId), {
        action: 'member.role_changed',
        metadata: { scope: 'account' },
      });
      const mine = await withUser(tx, { userId }, (s) =>
        s.select().from(schema.auditEvent).where(eq(schema.auditEvent.actorUserId, userId)),
      );
      expect(mine).toHaveLength(1);
      expect(mine[0]).toMatchObject({ workspaceId: null, action: 'member.role_changed' });
    });
  });

  it('rejects an unregistered action', async () => {
    await withTestDb(async (tx) => {
      await expect(
        record(ctx(tx, randomUUID(), null), { action: 'not.registered' as never }),
      ).rejects.toThrow(/unknown audit action/);
    });
  });

  it('fails closed: a failed write for a security action rejects', async () => {
    await withTestDb(async (tx) => {
      const workspaceId = randomUUID();
      const error = await failure(
        record(
          { db: tx, workspaceId, actor: { userId: null, kind: 'robot' as never } },
          { action: 'member.removed' },
        ),
      );
      expect(sqlState(error)).toBe('22P02');
      expect(logged.error).toHaveLength(0);
      // The failed write ran on a savepoint: the caller's transaction is still usable.
      expect(await rows(tx, workspaceId)).toHaveLength(0);
    });
  });

  it('fails open: a failed informational write resolves, logs once, keeps the transaction', async () => {
    await withTestDb(async (tx) => {
      const workspaceId = randomUUID();
      await expect(
        record(
          { db: tx, workspaceId, actor: { userId: null, kind: 'robot' as never } },
          { action: 'workspace.settings_viewed', metadata: { secretish: 'id-123' } },
        ),
      ).resolves.toBeUndefined();
      expect(logged.error).toHaveLength(1);
      const [fields, message] = logged.error[0] ?? [];
      expect(message).toBe('informational audit event not recorded');
      expect(fields).toMatchObject({ action: 'workspace.settings_viewed', workspaceId });
      expect(JSON.stringify(fields)).not.toContain('id-123');
      await record(ctx(tx, workspaceId, null), { action: 'workspace.settings_viewed' });
      expect(await rows(tx, workspaceId)).toHaveLength(1);
    });
  });

  it('never fails open across tenants: a different workspace inside a scope throws', async () => {
    await withTestDb(async (tx) => {
      const pinned = randomUUID();
      const error = await failure(
        withWorkspace(tx, { workspaceId: pinned }, (s) =>
          record(ctx(s, randomUUID(), null), { action: 'workspace.settings_viewed' }),
        ),
      );
      expect((error as { code?: string }).code).toBe('TENANCY_VIOLATION');
    });
  });
});
