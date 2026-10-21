// Security event capture (#228, #26 part 3) against a real Postgres: one test per action, each
// asserting the persisted audit_event row. Every test runs in a rolled-back app-role transaction.
import { createHash, randomUUID } from 'node:crypto';

import { schema, withUser, type Database, type Transaction } from '@causedeck/db';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import * as core from '../../index.ts';
import {
  AUDIT_ACTIONS,
  createSecurityEventRecorder,
  flagChangeAuditSink,
  hashEmail,
  recordAccessDenied,
  recordExportRun,
  recordSupportSessionEnded,
  recordSupportSessionStarted,
} from '../index.ts';
import { newUser, newWorkspace } from '../../__tests__/fixtures.ts';

const UA = 'Mozilla/5.0 CauseDeckTest/228';
const IP = '203.0.113.28';
const EMAIL = 'Advocate.Rao@Example.IN ';

type AuditRow = typeof schema.auditEvent.$inferSelect;

/** The actor's own account-level rows. */
async function accountRows(tx: Transaction, userId: string): Promise<AuditRow[]> {
  return withUser(tx, { userId }, (s) =>
    s.select().from(schema.auditEvent).where(eq(schema.auditEvent.actorUserId, userId)),
  );
}

async function workspaceRows(tx: Transaction, workspaceId: string, action: string) {
  return inWorkspace(tx, workspaceId, (s) =>
    s
      .select()
      .from(schema.auditEvent)
      .where(
        and(eq(schema.auditEvent.workspaceId, workspaceId), eq(schema.auditEvent.action, action)),
      ),
  );
}

function only(rows: AuditRow[]): AuditRow {
  expect(rows).toHaveLength(1);
  return rows[0] as AuditRow;
}

/** No raw email anywhere in the row. */
function expectNoEmail(row: AuditRow): void {
  expect(JSON.stringify(row).toLowerCase()).not.toContain('example.in');
}

async function addMember(tx: Transaction, workspaceId: string, role: 'advocate' | 'viewer') {
  const userId = await newUser(tx);
  const [row] = await inWorkspace(tx, workspaceId, (s) =>
    s
      .insert(schema.member)
      .values({ organizationId: workspaceId, userId, role, status: 'active' })
      .returning({ id: schema.member.id }),
  );
  if (!row) throw new Error('member insert failed');
  return { userId, memberId: row.id };
}

const NEW_ACTIONS = [
  'auth.sign_in',
  'auth.sign_in_failed',
  'auth.magic_link_requested',
  'auth.passkey_added',
  'auth.passkey_removed',
  'auth.two_factor_enabled',
  'auth.two_factor_disabled',
  'auth.session_revoked',
  'audit.exported',
  'support.session_started',
  'support.session_ended',
  'access.denied',
] as const;

describe('security event registry', () => {
  it('registers every #228 action as a security action', () => {
    for (const action of NEW_ACTIONS) {
      expect(AUDIT_ACTIONS[action].security, action).toBe(true);
    }
  });
});

describe('auth events (createSecurityEventRecorder)', () => {
  const request = { ip: IP, userAgent: UA, requestId: 'req-228' };

  it('auth.sign_in: account-level, session target, method, IP', async () => {
    await withTestDb(async (tx) => {
      const userId = await newUser(tx);
      const sessionId = randomUUID();
      await createSecurityEventRecorder(tx as unknown as Database).signInSucceeded({
        ...request,
        userId,
        sessionId,
        method: 'magic_link',
      });
      const row = only(await accountRows(tx, userId));
      expect(row).toMatchObject({
        workspaceId: null,
        action: 'auth.sign_in',
        outcome: 'success',
        actorKind: 'user',
        targetKind: 'session',
        targetId: sessionId,
        requestId: 'req-228',
        metadata: { method: 'magic_link' },
      });
      expect(String(row.ip)).toContain(IP);
      expect(row.userAgentHash).toBe(createHash('sha256').update(UA).digest('hex'));
    });
  });

  it('auth.sign_in_failed: denied, emailHash only', async () => {
    await withTestDb(async (tx) => {
      const userId = await newUser(tx);
      await createSecurityEventRecorder(tx as unknown as Database).signInFailed({
        ...request,
        userId,
        email: EMAIL,
        method: 'two_factor',
      });
      const row = only(await accountRows(tx, userId));
      expect(row).toMatchObject({
        action: 'auth.sign_in_failed',
        outcome: 'denied',
        metadata: { method: 'two_factor', emailHash: hashEmail(EMAIL) },
      });
      expect(hashEmail(EMAIL)).toBe(
        createHash('sha256').update('advocate.rao@example.in').digest('hex'),
      );
      expectNoEmail(row);
    });
  });

  it('auth.sign_in_failed: an anonymous failure is still written', async () => {
    await withTestDb(async (tx) => {
      await expect(
        createSecurityEventRecorder(tx as unknown as Database).signInFailed({
          ...request,
          method: 'magic_link',
        }),
      ).resolves.toBeUndefined();
    });
  });

  it('auth.magic_link_requested: emailHash, never the email', async () => {
    await withTestDb(async (tx) => {
      const userId = await newUser(tx);
      await createSecurityEventRecorder(tx as unknown as Database).magicLinkRequested({
        ...request,
        userId,
        email: EMAIL,
      });
      const row = only(await accountRows(tx, userId));
      expect(row).toMatchObject({
        action: 'auth.magic_link_requested',
        metadata: { emailHash: hashEmail(EMAIL) },
      });
      expectNoEmail(row);
    });
  });

  it.each([
    ['auth.passkey_added', 'passkeyAdded'],
    ['auth.passkey_removed', 'passkeyRemoved'],
  ] as const)('%s: passkey target', async (action, method) => {
    await withTestDb(async (tx) => {
      const userId = await newUser(tx);
      const passkeyId = randomUUID();
      await createSecurityEventRecorder(tx as unknown as Database)[method]({
        ...request,
        userId,
        passkeyId,
      });
      expect(only(await accountRows(tx, userId))).toMatchObject({
        action,
        targetKind: 'passkey',
        targetId: passkeyId,
      });
    });
  });

  it.each([
    ['auth.two_factor_enabled', 'twoFactorEnabled'],
    ['auth.two_factor_disabled', 'twoFactorDisabled'],
  ] as const)('%s: user target', async (action, method) => {
    await withTestDb(async (tx) => {
      const userId = await newUser(tx);
      await createSecurityEventRecorder(tx as unknown as Database)[method]({ ...request, userId });
      expect(only(await accountRows(tx, userId))).toMatchObject({
        action,
        targetKind: 'user',
        targetId: userId,
      });
    });
  });

  it('auth.session_revoked: session target', async () => {
    await withTestDb(async (tx) => {
      const userId = await newUser(tx);
      const sessionId = randomUUID();
      await createSecurityEventRecorder(tx as unknown as Database).sessionRevoked({
        ...request,
        userId,
        sessionId,
      });
      expect(only(await accountRows(tx, userId))).toMatchObject({
        action: 'auth.session_revoked',
        targetKind: 'session',
        targetId: sessionId,
      });
    });
  });
});

describe('domain events', () => {
  it('member.role_changed: changeRole records from/to in the workspace chain', async () => {
    await withTestDb(async (tx) => {
      const { ownerId, workspaceId } = await newWorkspace(tx);
      const target = await addMember(tx, workspaceId, 'viewer');
      await inWorkspace(tx, workspaceId, (s) =>
        core.changeRole(s, {
          workspaceId,
          actorUserId: ownerId,
          memberId: target.memberId,
          role: 'advocate',
        }),
      );
      const row = only(await workspaceRows(tx, workspaceId, 'member.role_changed'));
      expect(row).toMatchObject({
        actorUserId: ownerId,
        targetKind: 'user',
        targetId: target.userId,
        metadata: { memberId: target.memberId, fromRole: 'viewer', toRole: 'advocate' },
      });
      // Unchanged role: nothing more is recorded.
      await inWorkspace(tx, workspaceId, (s) =>
        core.changeRole(s, {
          workspaceId,
          actorUserId: ownerId,
          memberId: target.memberId,
          role: 'advocate',
        }),
      );
      expect(await workspaceRows(tx, workspaceId, 'member.role_changed')).toHaveLength(1);
    });
  });

  it('member.role_changed: transferOwnership records both role changes', async () => {
    await withTestDb(async (tx) => {
      const { ownerId, workspaceId } = await newWorkspace(tx);
      const target = await addMember(tx, workspaceId, 'advocate');
      const plan = await inWorkspace(tx, workspaceId, (s) =>
        core.prepareOwnershipTransfer(s, {
          workspaceId,
          actorUserId: ownerId,
          newOwnerUserId: target.userId,
        }),
      );
      await inWorkspace(tx, workspaceId, (s) =>
        core.transferOwnership(s, {
          workspaceId,
          actorUserId: ownerId,
          newOwnerUserId: target.userId,
          confirmation: plan.confirmation,
        }),
      );
      const rows = await workspaceRows(tx, workspaceId, 'member.role_changed');
      expect(rows.map((r) => [r.targetId, r.metadata]).sort()).toEqual(
        [
          [target.userId, { memberId: target.memberId, fromRole: 'advocate', toRole: 'owner' }],
          [ownerId, expect.objectContaining({ fromRole: 'owner', toRole: 'advocate' })],
        ].sort(),
      );
    });
  });

  it('member.removed: removeMember writes through the default sink', async () => {
    await withTestDb(async (tx) => {
      const { ownerId, workspaceId } = await newWorkspace(tx);
      const target = await addMember(tx, workspaceId, 'viewer');
      await inWorkspace(tx, workspaceId, (s) =>
        core.removeMember(s, { workspaceId, actorUserId: ownerId, memberId: target.memberId }),
      );
      expect(only(await workspaceRows(tx, workspaceId, 'member.removed'))).toMatchObject({
        actorUserId: ownerId,
        targetKind: 'user',
        targetId: target.userId,
      });
    });
  });

  it('flag.changed: flagChangeAuditSink records staff, values and legalAck, never the note', async () => {
    await withTestDb(async (tx) => {
      const { workspaceId } = await newWorkspace(tx);
      const staffId = await newUser(tx);
      await inWorkspace(tx, workspaceId, (s) =>
        flagChangeAuditSink.write(s, {
          action: 'flag.changed',
          actorUserId: staffId,
          key: 'ai.drafting',
          workspaceId,
          oldValue: false,
          newValue: true,
          legalAckNote: 'Bar Council rule 36 reviewed by counsel',
        }),
      );
      const row = only(await workspaceRows(tx, workspaceId, 'flag.changed'));
      expect(row).toMatchObject({
        actorKind: 'staff',
        targetKind: 'flag',
        targetId: 'ai.drafting',
        metadata: { oldValue: false, newValue: true, legalAck: true },
      });
      expect(JSON.stringify(row)).not.toContain('Bar Council');
    });
  });

  it('flag.change_*: flagChangeAuditSink records the request steps and approvedVia (#311)', async () => {
    await withTestDb(async (tx) => {
      const { workspaceId } = await newWorkspace(tx);
      const staffId = await newUser(tx);
      const requestId = '6f1b0d3e-6f8f-4d55-9d6a-2b8f0c1e7a11';
      await inWorkspace(tx, workspaceId, async (s) => {
        for (const action of [
          'flag.change_requested',
          'flag.change_approved',
          'flag.change_rejected',
        ] as const) {
          await flagChangeAuditSink.write(s, {
            action,
            actorUserId: staffId,
            key: 'invoices.enabled',
            workspaceId,
            requestId,
          });
        }
        await flagChangeAuditSink.write(s, {
          action: 'flag.changed',
          actorUserId: staffId,
          key: 'invoices.enabled',
          workspaceId,
          oldValue: null,
          newValue: true,
          legalAckNote: 'Counsel opinion on file',
          requestId,
        });
      });
      for (const action of [
        'flag.change_requested',
        'flag.change_approved',
        'flag.change_rejected',
      ]) {
        expect(AUDIT_ACTIONS).toHaveProperty([action, 'security'], true);
        expect(only(await workspaceRows(tx, workspaceId, action))).toMatchObject({
          actorKind: 'staff',
          actorUserId: staffId,
          targetKind: 'flag_change_request',
          targetId: requestId,
          metadata: { key: 'invoices.enabled' },
        });
      }
      const changed = only(await workspaceRows(tx, workspaceId, 'flag.changed'));
      expect(changed.metadata).toEqual({
        oldValue: null,
        newValue: true,
        legalAck: true,
        approvedVia: requestId,
      });
      expect(JSON.stringify(changed)).not.toContain('Counsel opinion');
    });
  });

  it('audit.exported: recordExportRun records the format and range', async () => {
    await withTestDb(async (tx) => {
      const { ownerId, workspaceId } = await newWorkspace(tx);
      await inWorkspace(tx, workspaceId, (s) =>
        recordExportRun(
          { db: s, workspaceId, actor: { userId: ownerId, kind: 'user' }, ip: IP },
          { format: 'csv', from: '2026-09-01', to: '2026-09-30', rowCount: 42 },
        ),
      );
      expect(only(await workspaceRows(tx, workspaceId, 'audit.exported'))).toMatchObject({
        targetKind: 'workspace',
        targetId: workspaceId,
        metadata: { format: 'csv', from: '2026-09-01', to: '2026-09-30', rowCount: 42 },
      });
    });
  });

  it.each([
    ['support.session_started', recordSupportSessionStarted],
    ['support.session_ended', recordSupportSessionEnded],
  ] as const)('%s: staff actor, support session target', async (action, emit) => {
    await withTestDb(async (tx) => {
      const { workspaceId } = await newWorkspace(tx);
      const staffUserId = await newUser(tx);
      const supportSessionId = randomUUID();
      await inWorkspace(tx, workspaceId, (s) =>
        emit({ db: s, ip: IP }, { supportSessionId, staffUserId, workspaceId }),
      );
      expect(only(await workspaceRows(tx, workspaceId, action))).toMatchObject({
        actorKind: 'staff',
        actorUserId: staffUserId,
        targetKind: 'support_session',
        targetId: supportSessionId,
      });
    });
  });

  it('access.denied: a member denial goes to the workspace chain', async () => {
    await withTestDb(async (tx) => {
      const { workspaceId } = await newWorkspace(tx);
      const viewer = await addMember(tx, workspaceId, 'viewer');
      await recordAccessDenied(tx as unknown as Database, {
        workspaceId,
        member: true,
        actorUserId: viewer.userId,
        action: 'member.role',
        reason: 'ROLE',
        ip: IP,
      });
      const row = only(await workspaceRows(tx, workspaceId, 'access.denied'));
      expect(row).toMatchObject({
        outcome: 'denied',
        actorUserId: viewer.userId,
        targetKind: 'workspace',
        targetId: workspaceId,
        metadata: { member: true, deniedAction: 'member.role', reason: 'ROLE' },
      });
      expect(String(row.ip)).toContain(IP);
    });
  });

  it('access.denied: a non-member denial is account-level, not in the workspace chain', async () => {
    await withTestDb(async (tx) => {
      const { workspaceId } = await newWorkspace(tx);
      const outsider = await newUser(tx);
      await recordAccessDenied(tx as unknown as Database, {
        workspaceId,
        member: false,
        actorUserId: outsider,
      });
      expect(await workspaceRows(tx, workspaceId, 'access.denied')).toHaveLength(0);
      expect(only(await accountRows(tx, outsider))).toMatchObject({
        workspaceId: null,
        action: 'access.denied',
        outcome: 'denied',
        targetKind: 'workspace',
        targetId: workspaceId,
        metadata: { member: false },
      });
    });
  });

  it('access.denied: survives the rolled-back transaction of the denied action', async () => {
    await withTestDb(async (tx) => {
      const { ownerId, workspaceId } = await newWorkspace(tx);
      const viewer = await addMember(tx, workspaceId, 'viewer');
      const ownerMember = await inWorkspace(tx, workspaceId, (s) =>
        s
          .select({ id: schema.member.id })
          .from(schema.member)
          .where(eq(schema.member.userId, ownerId)),
      );
      // The denied domain call runs in its own (caller) transaction, which rolls back.
      const denied = await tx
        .transaction((caller) =>
          inWorkspace(caller, workspaceId, (s) =>
            core.changeRole(s, {
              workspaceId,
              actorUserId: viewer.userId,
              memberId: ownerMember[0]?.id ?? '',
              role: 'viewer',
            }),
          ),
        )
        .then(
          () => null,
          (error: unknown) => error,
        );
      expect(denied).toMatchObject({ code: 'FORBIDDEN' });
      await recordAccessDenied(tx as unknown as Database, {
        workspaceId,
        member: true,
        actorUserId: viewer.userId,
        reason: 'FORBIDDEN',
      });
      expect(only(await workspaceRows(tx, workspaceId, 'access.denied'))).toMatchObject({
        outcome: 'denied',
        actorUserId: viewer.userId,
      });
      expect(await workspaceRows(tx, workspaceId, 'member.role_changed')).toHaveLength(0);
    });
  });

  it('access.denied: a failed write is swallowed so the original denial still surfaces', async () => {
    const broken = {
      transaction: () => Promise.reject(new Error('db down')),
    } as unknown as Database;
    await expect(
      recordAccessDenied(broken, {
        workspaceId: randomUUID(),
        member: false,
        actorUserId: randomUUID(),
      }),
    ).resolves.toBeUndefined();
  });
});
