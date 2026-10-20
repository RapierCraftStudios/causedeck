// The audited admin data layer (#309): every read records `staff.read` (actor kind `staff`) first,
// fails closed when the audit write fails, and checks the role matrix before anything runs.
import { randomUUID } from 'node:crypto';

import {
  staffWorkspaceMetadata,
  staffWorkspaceSearch,
  staffWorkspaceUsage,
} from '@causedeck/core/support';
import { setBudgetOverride } from '@causedeck/core/usage';
import type { Database } from '@causedeck/db';
import { closeTestDb, schema, withTestDb, withUser } from '@causedeck/db/testing';
import { seedTwoTenants } from '@causedeck/db/testing/two-tenants';
import { and, count, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  adapterRegistry,
  staffCall,
  staffQuery,
  StaffQueryDeniedError,
} from '../lib/data/index.ts';
import { committedStaff, type StaffFixture } from './staff-fixture.ts';

let support: StaffFixture;

beforeAll(async () => {
  support = await committedStaff('support');
});

afterAll(async () => {
  await support.cleanup();
  await closeTestDb();
});

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

describe('adapterRegistry', () => {
  it('records staff.read for adapters.registry, then lists the registry (#312)', async () => {
    await withTestDb(async (tx) => {
      const userId = randomUUID();
      await tx
        .insert(schema.user)
        .values({ id: userId, name: 'ops', email: `ops-${userId}@causedeck.test` });
      await tx.delete(schema.accessModeRegistry);
      await tx.insert(schema.accessModeRegistry).values([
        { adapterId: 'madras-hc', resource: 'case-status', mode: 'user_supplied', enabled: true },
        { adapterId: 'bombay-hc', resource: 'case-status', mode: 'none', enabled: false },
      ]);
      const rows = await adapterRegistry({ userId, role: 'ops' }, tx as unknown as Database);
      expect(rows).toEqual([
        {
          adapterId: 'bombay-hc',
          resource: 'case-status',
          mode: 'none',
          enabled: false,
          reviewedAt: null,
        },
        {
          adapterId: 'madras-hc',
          resource: 'case-status',
          mode: 'user_supplied',
          enabled: true,
          reviewedAt: null,
        },
      ]);
      const events = await withUser(tx, { userId }, (s) =>
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
      expect(events).toHaveLength(1);
      expect(events[0]?.metadata).toEqual({
        purpose: 'adapters.registry',
        capability: 'adapters',
        tables: 'access_mode_registry',
        role: 'ops',
      });
    });
  });

  it('is denied to the support role', async () => {
    const db = { transaction: vi.fn() } as unknown as Database;
    await expect(
      adapterRegistry({ userId: randomUUID(), role: 'support' }, db),
    ).rejects.toBeInstanceOf(StaffQueryDeniedError);
  });
});

describe('staffCall (#310)', () => {
  const search = {
    purpose: 'workspaces.search',
    capability: 'workspaces',
    functions: ['app_staff_workspace_search'],
  } as const;

  it('denies a capability the role may not reach, before auditing or reading', async () => {
    const fn = vi.fn(() => Promise.resolve(1));
    const db = { transaction: vi.fn() } as unknown as Database;
    await expect(
      staffCall({ userId: randomUUID(), role: 'ops' }, search, fn, db),
    ).rejects.toBeInstanceOf(StaffQueryDeniedError);
    expect(fn).not.toHaveBeenCalled();
    expect(
      (db as unknown as { transaction: ReturnType<typeof vi.fn> }).transaction,
    ).not.toHaveBeenCalled();
  });

  it('fails closed: nothing is read when the audit event cannot be written', async () => {
    const fn = vi.fn(() => Promise.resolve(1));
    const broken = {
      transaction: () => Promise.reject(new Error('audit down')),
    } as unknown as Database;
    await expect(
      staffCall({ userId: randomUUID(), role: 'admin' }, search, fn, broken),
    ).rejects.toThrow('audit down');
    expect(fn).not.toHaveBeenCalled();
  });

  it('records staff.read with the function names, then finds workspaces by slug and owner email', async () => {
    await withTestDb(async (tx) => {
      const t = await seedTwoTenants(tx);
      const staff = { userId: support.userId, role: 'support' as const, requestId: 'req-310' };
      const db = tx as unknown as Database;
      const bySlug = await staffCall(
        staff,
        search,
        (q) => staffWorkspaceSearch(q, staff.userId, t.a.slug),
        db,
      );
      expect(bySlug.map((w) => w.workspaceId)).toEqual([t.a.id]);

      const [owner] = await tx
        .select({ email: schema.user.email })
        .from(schema.user)
        .where(eq(schema.user.id, t.ua));
      const byEmail = await staffCall(
        staff,
        search,
        (q) => staffWorkspaceSearch(q, staff.userId, owner?.email ?? ''),
        db,
      );
      expect(byEmail.map((w) => w.workspaceId)).toEqual([t.a.id]);
      expect(byEmail[0]).toMatchObject({ slug: t.a.slug, ownerEmail: owner?.email });

      const one = await staffCall(
        staff,
        {
          purpose: 'workspaces.metadata',
          capability: 'workspaces',
          functions: ['app_staff_workspace_metadata'],
        },
        (q) => staffWorkspaceMetadata(q, staff.userId, t.b.id),
        db,
      );
      expect(one?.workspaceId).toBe(t.b.id);

      const rows = await withUser(tx, { userId: staff.userId }, (s) =>
        s
          .select()
          .from(schema.auditEvent)
          .where(
            and(
              eq(schema.auditEvent.actorUserId, staff.userId),
              eq(schema.auditEvent.action, 'staff.read'),
            ),
          ),
      );
      expect(rows).toHaveLength(3);
      expect(rows.find((r) => r.metadata.purpose === 'workspaces.search')).toMatchObject({
        workspaceId: null,
        actorKind: 'staff',
        requestId: 'req-310',
        metadata: {
          purpose: 'workspaces.search',
          capability: 'workspaces',
          functions: 'app_staff_workspace_search',
          role: 'support',
        },
      });
    });
  });

  const usage = {
    purpose: 'workspaces.usage',
    capability: 'workspaces',
    functions: ['app_staff_budget_overrides', 'app_staff_workspace_usage'],
  } as const;

  it('denies the usage read to a role without Workspaces (#224)', async () => {
    const fn = vi.fn(() => Promise.resolve(null));
    const db = { transaction: vi.fn() } as unknown as Database;
    await expect(
      staffCall({ userId: randomUUID(), role: 'ops' }, usage, fn, db),
    ).rejects.toBeInstanceOf(StaffQueryDeniedError);
    expect(fn).not.toHaveBeenCalled();
  });

  it('records staff.read for workspaces.usage, then reads that workspace only (#224)', async () => {
    await withTestDb(async (tx) => {
      const t = await seedTwoTenants(tx);
      const staff = { userId: support.userId, role: 'support' as const };
      const db = tx as unknown as Database;
      const { id } = await setBudgetOverride(
        { db, workspaceId: t.a.id },
        {
          limitPaise: 35_000,
          reason: 'pilot extension',
          expiresAt: new Date(Date.now() + 86_400_000),
          staffUserId: support.userId,
        },
      );
      const result = await staffCall(
        staff,
        usage,
        (q) => staffWorkspaceUsage(q, staff.userId, t.a.id),
        db,
      );
      expect(result?.overrides.map((o) => o.id)).toContain(id);
      expect(result?.overrides.every((o) => o.reason.length > 0)).toBe(true);
      const other = await staffCall(
        staff,
        usage,
        (q) => staffWorkspaceUsage(q, staff.userId, t.b.id),
        db,
      );
      expect(other?.overrides.map((o) => o.id)).not.toContain(id);

      const rows = await withUser(tx, { userId: staff.userId }, (s) =>
        s
          .select()
          .from(schema.auditEvent)
          .where(
            and(
              eq(schema.auditEvent.actorUserId, staff.userId),
              eq(schema.auditEvent.action, 'staff.read'),
            ),
          ),
      );
      expect(rows.map((r) => r.metadata)).toContainEqual({
        purpose: 'workspaces.usage',
        capability: 'workspaces',
        functions: 'app_staff_budget_overrides,app_staff_workspace_usage',
        role: 'support',
      });
    });
  });
});
