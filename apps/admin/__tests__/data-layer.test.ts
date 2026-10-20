// The audited admin data layer (#309): every read records `staff.read` (actor kind `staff`) first,
// fails closed when the audit write fails, and checks the role matrix before anything runs.
import { randomUUID } from 'node:crypto';

import { schema, withUser, type Database } from '@causedeck/db';
import { closeTestDb, withTestDb } from '@causedeck/db/testing';
import { and, count, eq } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';

import { staffQuery, StaffQueryDeniedError } from '../lib/data/index.ts';

afterAll(closeTestDb);

describe('staffQuery', () => {
  it('records staff.read with actor kind staff, then reads the global table', async () => {
    await withTestDb(async (tx) => {
      const userId = randomUUID();
      await tx
        .insert(schema.user)
        .values({ id: userId, name: 'ops', email: `ops-${userId}@causedeck.test` });
      const total = await staffQuery(
        { userId, role: 'ops', ip: '203.0.113.7', requestId: 'req-309' },
        { purpose: 'overview.staff_count', capability: 'overview', tables: ['staff_user'] },
        async (s) => {
          const [row] = await s.select({ value: count() }).from(schema.staffUser);
          return row?.value ?? -1;
        },
        tx as unknown as Database,
      );
      expect(total).toBeGreaterThanOrEqual(0);
      const rows = await withUser(tx, { userId }, (s) =>
        s
          .select()
          .from(schema.auditEvent)
          .where(
            and(
              eq(schema.auditEvent.actorUserId, userId),
              eq(schema.auditEvent.action, 'staff.read'),
            ),
          ),
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        workspaceId: null,
        actorKind: 'staff',
        outcome: 'success',
        requestId: 'req-309',
        metadata: {
          purpose: 'overview.staff_count',
          capability: 'overview',
          tables: 'staff_user',
          role: 'ops',
        },
      });
    });
  });

  it('fails closed: nothing is read when the audit event cannot be written', async () => {
    const fn = vi.fn(() => Promise.resolve(1));
    const broken = {
      transaction: () => Promise.reject(new Error('audit down')),
    } as unknown as Database;
    await expect(
      staffQuery(
        { userId: randomUUID(), role: 'admin' },
        { purpose: 'overview.staff_count', capability: 'overview', tables: ['staff_user'] },
        fn,
        broken,
      ),
    ).rejects.toThrow('audit down');
    expect(fn).not.toHaveBeenCalled();
  });

  it('denies a purpose the role may not reach, before auditing or reading', async () => {
    const fn = vi.fn(() => Promise.resolve(1));
    const db = { transaction: vi.fn() } as unknown as Database;
    await expect(
      staffQuery(
        { userId: randomUUID(), role: 'support' },
        { purpose: 'flags.list', capability: 'flags', tables: ['feature_flag'] },
        fn,
        db,
      ),
    ).rejects.toBeInstanceOf(StaffQueryDeniedError);
    expect(fn).not.toHaveBeenCalled();
    expect(
      (db as unknown as { transaction: ReturnType<typeof vi.fn> }).transaction,
    ).not.toHaveBeenCalled();
  });

  it('refuses tenant tables (withoutWorkspace allows GLOBAL_TABLES only)', async () => {
    await withTestDb(async (tx) => {
      const userId = randomUUID();
      await tx
        .insert(schema.user)
        .values({ id: userId, name: 'admin', email: `admin-${userId}@causedeck.test` });
      await expect(
        staffQuery(
          { userId, role: 'admin' },
          { purpose: 'workspaces.matters', capability: 'workspaces', tables: ['matter'] },
          () => Promise.resolve(1),
          tx as unknown as Database,
        ),
      ).rejects.toThrow(/only allow-listed global tables/);
    });
  });
});
