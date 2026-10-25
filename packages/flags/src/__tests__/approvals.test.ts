// The two-person legal-gated enable (#311): a staff request carries the note, a second, enabled
// admin applies it through the same row write as `setFlag`, and every step is audited in the same
// transaction. Staff rows are global and writable only by the owner role, so the staff members are
// committed by an owner connection in beforeAll (as in packages/db staff-support-schema.test.ts).
import { randomUUID } from 'node:crypto';

import { Secret } from '@causedeck/config/env';
import type { Database, Transaction } from '@causedeck/db';
import { flagChangeRequest, staffUser, user } from '@causedeck/db/schema';
import { createDb, inWorkspace, testDatabaseUrls, withTestDb } from '@causedeck/db/testing';
import { eq, inArray, sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
  approveLegalEnable,
  asStaff,
  listFlagChangeRequests,
  listGlobalFlagRows,
  rejectLegalEnable,
  requestLegalEnable,
  setFlag,
  setWorkspaceFlag,
} from '../admin.ts';
import { setFlagAuditSink, type FlagAuditEvent } from '../audit.ts';
import { isEnabled } from '../evaluate.ts';

import { on, seed } from './helpers.ts';

let owner: Database;
const ids = { admin: '', admin2: '', ops: '', disabledAdmin: '' };

function fakeSink() {
  const events: FlagAuditEvent[] = [];
  return {
    events,
    sink: { write: (_tx: unknown, e: FlagAuditEvent) => (events.push(e), Promise.resolve()) },
  };
}

async function committedUser(): Promise<string> {
  const [row] = await owner
    .insert(user)
    .values({ name: 'Staff', email: `${randomUUID()}@staff.test` })
    .returning({ id: user.id });
  if (!row) throw new Error('user insert failed');
  return row.id;
}

beforeAll(async () => {
  owner = createDb({ url: new Secret(testDatabaseUrls().owner), role: 'owner', max: 1 });
  for (const name of Object.keys(ids) as (keyof typeof ids)[]) ids[name] = await committedUser();
  await owner.insert(staffUser).values([
    { userId: ids.admin, role: 'admin' },
    { userId: ids.admin2, role: 'admin' },
    { userId: ids.ops, role: 'ops' },
    { userId: ids.disabledAdmin, role: 'admin', disabledAt: new Date() },
  ]);
});

afterAll(async () => {
  // Deleting the users cascades to staff_user.
  await owner.delete(user).where(inArray(user.id, Object.values(ids)));
  await owner.$client.end();
});

afterEach(() => {
  setFlagAuditSink(null);
});

async function requestRow(tx: Transaction, id: string) {
  const [row] = await tx.select().from(flagChangeRequest).where(eq(flagChangeRequest.id, id));
  return row;
}

describe('requestLegalEnable', () => {
  it('needs a legal-gated key and a note, and changes no flag row', async () => {
    await withTestDb(async (tx) => {
      await seed(tx);
      const ops = asStaff(ids.ops);
      await expect(
        requestLegalEnable(tx, ops, { key: 'pwa.offline', legalAckNote: 'n/a' }),
      ).rejects.toMatchObject({ code: 'NOT_LEGAL_GATED' });
      await expect(
        requestLegalEnable(tx, ops, { key: 'invoices.enabled', legalAckNote: '   ' }),
      ).rejects.toMatchObject({ code: 'LEGAL_ACK_REQUIRED' });
      await expect(
        requestLegalEnable(tx, { userId: ids.ops } as never, {
          key: 'invoices.enabled',
          legalAckNote: 'x',
        }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });

      const { id } = await requestLegalEnable(tx, ops, {
        key: 'invoices.enabled',
        legalAckNote: ' Counsel opinion #120 ',
      });
      expect(await requestRow(tx, id)).toMatchObject({
        key: 'invoices.enabled',
        workspaceId: null,
        status: 'pending',
        requestedBy: ids.ops,
        legalAckNote: 'Counsel opinion #120',
        decidedBy: null,
      });
      expect(await listGlobalFlagRows(tx, ops)).toEqual([]);
      expect(await listFlagChangeRequests(tx, ops)).toEqual([
        expect.objectContaining({ id, key: 'invoices.enabled', requestedBy: ids.ops }),
      ]);
    });
  });

  it('allows one pending request per target', async () => {
    await withTestDb(async (tx) => {
      const { a } = await seed(tx);
      const ops = asStaff(ids.ops);
      await requestLegalEnable(tx, ops, { key: 'limitation.enabled', legalAckNote: 'one' });
      await expect(
        requestLegalEnable(tx, asStaff(ids.admin), {
          key: 'limitation.enabled',
          legalAckNote: 'two',
        }),
      ).rejects.toMatchObject({ code: 'REQUEST_PENDING' });
      // A workspace override is a different target.
      await expect(
        requestLegalEnable(tx, ops, {
          key: 'limitation.enabled',
          workspaceId: a.id,
          legalAckNote: 'pilot',
        }),
      ).resolves.toHaveProperty('id');
    });
  });
});

describe('approveLegalEnable', () => {
  it('needs an enabled admin other than the requester', async () => {
    await withTestDb(async (tx) => {
      await seed(tx);
      const { id } = await requestLegalEnable(tx, asStaff(ids.admin), {
        key: 'invoices.enabled',
        legalAckNote: 'Counsel opinion #120',
      });
      await expect(
        approveLegalEnable(tx, asStaff(ids.admin), { requestId: id }),
      ).rejects.toMatchObject({ code: 'SELF_APPROVAL' });
      await expect(
        approveLegalEnable(tx, asStaff(ids.ops), { requestId: id }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(
        approveLegalEnable(tx, asStaff(ids.disabledAdmin), { requestId: id }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect(await requestRow(tx, id)).toMatchObject({ status: 'pending' });
      expect(await listGlobalFlagRows(tx, asStaff(ids.admin))).toEqual([]);
    });
  });

  it('applies the global row with the requester as legal_ack_by and audits every step', async () => {
    await withTestDb(async (tx) => {
      const { a, ua } = await seed(tx);
      const { events, sink } = fakeSink();
      setFlagAuditSink(sink);
      const { id } = await requestLegalEnable(tx, asStaff(ids.ops), {
        key: 'invoices.enabled',
        legalAckNote: 'Counsel opinion #120',
      });
      await approveLegalEnable(tx, asStaff(ids.admin), { requestId: id });

      const [row] = await listGlobalFlagRows(tx, asStaff(ids.admin));
      expect(row).toMatchObject({
        key: 'invoices.enabled',
        enabled: true,
        legalAckBy: ids.ops,
        updatedBy: ids.admin,
      });
      expect(await isEnabled('invoices.enabled', { workspaceId: a.id, userId: ua }, on(tx))).toBe(
        true,
      );
      expect(await requestRow(tx, id)).toMatchObject({
        status: 'approved',
        decidedBy: ids.admin,
      });
      expect((await requestRow(tx, id))?.decidedAt).toBeInstanceOf(Date);
      expect(events).toEqual([
        expect.objectContaining({
          action: 'flag.change_requested',
          actorUserId: ids.ops,
          key: 'invoices.enabled',
          workspaceId: null,
          requestId: id,
        }),
        expect.objectContaining({
          action: 'flag.changed',
          actorUserId: ids.admin,
          key: 'invoices.enabled',
          workspaceId: null,
          oldValue: null,
          newValue: true,
          legalAckNote: 'Counsel opinion #120',
          requestId: id,
          requestedBy: ids.ops,
        }),
        expect.objectContaining({
          action: 'flag.change_approved',
          actorUserId: ids.admin,
          requestId: id,
        }),
      ]);
      await expect(
        approveLegalEnable(tx, asStaff(ids.admin2), { requestId: id }),
      ).rejects.toMatchObject({ code: 'REQUEST_NOT_PENDING' });
    });
  });

  it('writes a workspace-target approval only in that workspace', async () => {
    await withTestDb(async (tx) => {
      const { a, b, ua, ub } = await seed(tx);
      const admin = asStaff(ids.admin);
      // The pilot only turns on while the global row is legally on too.
      await setFlag(tx, admin, {
        key: 'limitation.enabled',
        enabled: true,
        legalAckNote: 'global',
      });
      await setWorkspaceFlag(tx, admin, {
        workspaceId: b.id,
        key: 'limitation.enabled',
        enabled: false,
      });
      const { id } = await requestLegalEnable(tx, asStaff(ids.ops), {
        key: 'limitation.enabled',
        workspaceId: a.id,
        legalAckNote: 'Pilot for workspace A',
      });
      await approveLegalEnable(tx, asStaff(ids.admin2), { requestId: id });

      expect(await isEnabled('limitation.enabled', { workspaceId: a.id, userId: ua }, on(tx))).toBe(
        true,
      );
      expect(await isEnabled('limitation.enabled', { workspaceId: b.id, userId: ub }, on(tx))).toBe(
        false,
      );
      const [override] = await inWorkspace(tx, a.id, (s) =>
        s.execute<{ legal_ack_by: string; updated_by: string }>(
          sql`select legal_ack_by, updated_by from workspace_feature_flag where key = 'limitation.enabled'`,
        ),
      );
      expect(override).toEqual({ legal_ack_by: ids.ops, updated_by: ids.admin2 });
    });
  });
});

describe('rejectLegalEnable', () => {
  it('lets an admin reject or the requester withdraw, and audits it', async () => {
    await withTestDb(async (tx) => {
      await seed(tx);
      const { events, sink } = fakeSink();
      const ops = asStaff(ids.ops);
      const first = await requestLegalEnable(tx, ops, {
        key: 'court.a2.retrieval',
        legalAckNote: 'one',
      });
      await rejectLegalEnable(tx, asStaff(ids.admin), { requestId: first.id }, { audit: sink });
      expect(await requestRow(tx, first.id)).toMatchObject({
        status: 'rejected',
        decidedBy: ids.admin,
      });

      const second = await requestLegalEnable(tx, ops, {
        key: 'court.a2.retrieval',
        legalAckNote: 'two',
      });
      // The requester withdraws: no second decider is recorded.
      await rejectLegalEnable(tx, ops, { requestId: second.id }, { audit: sink });
      expect(await requestRow(tx, second.id)).toMatchObject({
        status: 'rejected',
        decidedBy: null,
      });

      const third = await requestLegalEnable(tx, asStaff(ids.admin), {
        key: 'court.a2.retrieval',
        legalAckNote: 'three',
      });
      // Another non-admin may not reject; the requester may withdraw.
      await expect(
        rejectLegalEnable(tx, ops, { requestId: third.id }, { audit: sink }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await rejectLegalEnable(tx, asStaff(ids.admin), { requestId: third.id }, { audit: sink });
      expect(await requestRow(tx, third.id)).toMatchObject({ status: 'rejected', decidedBy: null });

      await expect(
        approveLegalEnable(tx, asStaff(ids.admin2), { requestId: third.id }),
      ).rejects.toMatchObject({ code: 'REQUEST_NOT_PENDING' });
      await expect(
        approveLegalEnable(tx, asStaff(ids.admin2), { requestId: randomUUID() }),
      ).rejects.toMatchObject({ code: 'REQUEST_NOT_PENDING' });
      expect(events.map((e) => [e.action, e.actorUserId])).toEqual([
        ['flag.change_rejected', ids.admin],
        ['flag.change_rejected', ids.ops],
        ['flag.change_rejected', ids.admin],
      ]);
      expect(await listFlagChangeRequests(tx, ops)).toEqual([]);
      expect(await listFlagChangeRequests(tx, ops, { status: 'rejected' })).toHaveLength(3);
    });
  });
});
