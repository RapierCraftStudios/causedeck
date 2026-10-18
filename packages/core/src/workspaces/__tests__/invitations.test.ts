// Invitations against a real Postgres (Testcontainers, #178). Every test runs in a rolled-back
// transaction; the service's own transactions become savepoints inside it.
import { createHash, randomUUID } from 'node:crypto';

import {
  consoleMailer,
  type AuthEmail,
  type AuthLogger,
  type Mailer,
} from '@causedeck/auth/mailer';
import { AUTH_EMAIL_KEYS } from '@causedeck/auth/messages';
import { schema, type Transaction } from '@causedeck/db';
import { withTestDb } from '@causedeck/db/testing';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ACCEPT_RATE_LIMIT,
  acceptInvitation,
  createWorkspace,
  INVITATION_TTL_MS,
  InvitationError,
  inviteMember,
  memberRole,
  reissueInvitation,
  removeMember,
  revokeInvitation,
  setEntitlements,
  WorkspaceError,
  type InvitationErrorReason,
  type WorkspaceRole,
} from '../index.ts';

const APP_URL = 'http://localhost:3000';

interface RecordingMailer extends Mailer {
  sent: AuthEmail[];
}

function recordingMailer(): RecordingMailer {
  const sent: AuthEmail[] = [];
  return {
    sent,
    send(message) {
      sent.push(message);
      return Promise.resolve();
    },
  };
}

async function newUser(tx: Transaction, email = `${randomUUID()}@example.test`): Promise<string> {
  const [row] = await tx
    .insert(schema.user)
    .values({ name: 'User', email })
    .returning({ id: schema.user.id });
  if (!row) throw new Error('user insert failed');
  return row.id;
}

async function addMember(
  tx: Transaction,
  workspaceId: string,
  role: WorkspaceRole,
): Promise<{ userId: string; memberId: string }> {
  const userId = await newUser(tx);
  const [row] = await tx
    .insert(schema.member)
    .values({ organizationId: workspaceId, userId, role })
    .returning({ id: schema.member.id });
  if (!row) throw new Error('member insert failed');
  return { userId, memberId: row.id };
}

async function setup(tx: Transaction) {
  const ownerId = await newUser(tx);
  const workspace = await createWorkspace(tx, {
    userId: ownerId,
    input: { name: `Chambers ${randomUUID().slice(0, 8)}` },
  });
  return { ownerId, workspaceId: workspace.id };
}

async function invitationRow(tx: Transaction, id: string) {
  const [row] = await tx.select().from(schema.invitation).where(eq(schema.invitation.id, id));
  if (!row) throw new Error('invitation not found');
  return row;
}

async function expectCode(promise: Promise<unknown>, code: WorkspaceError['code']): Promise<void> {
  const error: unknown = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(WorkspaceError);
  expect((error as WorkspaceError).code).toBe(code);
}

async function expectReason(
  promise: Promise<unknown>,
  reason: InvitationErrorReason,
): Promise<InvitationError> {
  const error: unknown = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(InvitationError);
  expect((error as InvitationError).reason).toBe(reason);
  return error as InvitationError;
}

afterEach(() => {
  setEntitlements(null);
});

describe('inviteMember', () => {
  it('stores only the hash of a 32-byte token, valid 7 days, and emails the link', async () => {
    await withTestDb(async (tx) => {
      const { ownerId, workspaceId } = await setup(tx);
      const mailer = recordingMailer();
      const now = new Date('2026-10-19T10:00:00Z');
      const { invitation, token } = await inviteMember(tx, {
        workspaceId,
        actorUserId: ownerId,
        input: { email: 'New.Junior@Example.test', role: 'advocate' },
        mailer,
        appUrl: APP_URL,
        now,
      });

      expect(Buffer.from(token, 'base64url')).toHaveLength(32);
      const row = await invitationRow(tx, invitation.id);
      expect(row.tokenHash).toBe(createHash('sha256').update(token).digest('hex'));
      expect(row.tokenHash).not.toContain(token);
      expect(row.email).toBe('new.junior@example.test');
      expect(row.role).toBe('advocate');
      expect(row.status).toBe('pending');
      expect(row.expiresAt.getTime()).toBe(now.getTime() + INVITATION_TTL_MS);
      expect(INVITATION_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);

      expect(mailer.sent).toHaveLength(1);
      expect(mailer.sent[0]).toMatchObject({
        to: 'new.junior@example.test',
        template: 'workspace.invitation',
        subjectKey: AUTH_EMAIL_KEYS.invitation.subject,
        bodyKey: AUTH_EMAIL_KEYS.invitation.body,
        url: `${APP_URL}/invite/${token}`,
        expiresInMinutes: 7 * 24 * 60,
      });
    });
  });

  it('never invites an owner', async () => {
    await withTestDb(async (tx) => {
      const { ownerId, workspaceId } = await setup(tx);
      await expectCode(
        inviteMember(tx, {
          workspaceId,
          actorUserId: ownerId,
          input: { email: 'x@example.test', role: 'owner' as 'advocate' },
          mailer: recordingMailer(),
          appUrl: APP_URL,
        }),
        'VALIDATION',
      );
    });
  });

  it('lets an advocate invite below advocate only, and nobody else invite', async () => {
    await withTestDb(async (tx) => {
      const { workspaceId } = await setup(tx);
      const advocate = await addMember(tx, workspaceId, 'advocate');
      const base = { workspaceId, mailer: recordingMailer(), appUrl: APP_URL };

      await inviteMember(tx, {
        ...base,
        actorUserId: advocate.userId,
        input: { email: 'junior@example.test', role: 'junior' },
      });
      await expectCode(
        inviteMember(tx, {
          ...base,
          actorUserId: advocate.userId,
          input: { email: 'peer@example.test', role: 'advocate' },
        }),
        'FORBIDDEN',
      );
      for (const role of ['junior', 'clerk', 'viewer'] as const) {
        const actor = await addMember(tx, workspaceId, role);
        await expectCode(
          inviteMember(tx, {
            ...base,
            actorUserId: actor.userId,
            input: { email: 'someone@example.test', role: 'viewer' },
          }),
          'FORBIDDEN',
        );
      }
    });
  });

  it('reissues the token when the same email is invited again', async () => {
    await withTestDb(async (tx) => {
      const { ownerId, workspaceId } = await setup(tx);
      const base = {
        workspaceId,
        actorUserId: ownerId,
        mailer: recordingMailer(),
        appUrl: APP_URL,
      };
      const first = await inviteMember(tx, {
        ...base,
        input: { email: 'again@example.test', role: 'junior' },
      });
      const second = await inviteMember(tx, {
        ...base,
        input: { email: 'AGAIN@example.test', role: 'clerk' },
      });

      expect(second.invitation.id).toBe(first.invitation.id);
      expect(second.token).not.toBe(first.token);
      expect((await invitationRow(tx, first.invitation.id)).role).toBe('clerk');

      const userId = await newUser(tx, 'again@example.test');
      await expectReason(acceptInvitation(tx, { userId, token: first.token }), 'INVALID');
      expect((await acceptInvitation(tx, { userId, token: second.token })).role).toBe('clerk');
    });
  });

  it('answers the same whether or not the email has an account', async () => {
    await withTestDb(async (tx) => {
      const { ownerId, workspaceId } = await setup(tx);
      const known = `${randomUUID()}@example.test`;
      await newUser(tx, known);
      const base = {
        workspaceId,
        actorUserId: ownerId,
        mailer: recordingMailer(),
        appUrl: APP_URL,
      };

      const withAccount = await inviteMember(tx, {
        ...base,
        input: { email: known, role: 'junior' },
      });
      const withoutAccount = await inviteMember(tx, {
        ...base,
        input: { email: `${randomUUID()}@example.test`, role: 'junior' },
      });
      expect(Object.keys(withAccount.invitation).sort()).toEqual(
        Object.keys(withoutAccount.invitation).sort(),
      );
      expect(Object.keys(withAccount).sort()).toEqual(Object.keys(withoutAccount).sort());
    });
  });

  it('checks the seat entitlement', async () => {
    await withTestDb(async (tx) => {
      const { ownerId, workspaceId } = await setup(tx);
      const assertCanAddSeat = vi.fn(() =>
        Promise.reject(new WorkspaceError('CONFLICT', 'No seats left')),
      );
      setEntitlements({ assertCanAddSeat });
      await expectCode(
        inviteMember(tx, {
          workspaceId,
          actorUserId: ownerId,
          input: { email: 'seat@example.test', role: 'clerk' },
          mailer: recordingMailer(),
          appUrl: APP_URL,
        }),
        'CONFLICT',
      );
      expect(assertCanAddSeat).toHaveBeenCalledWith(expect.anything(), workspaceId, 'clerk');
    });
  });

  it('sends through the console mailer in dev/CI', async () => {
    await withTestDb(async (tx) => {
      const { ownerId, workspaceId } = await setup(tx);
      const lines: string[] = [];
      const log = (obj: object, msg?: string) => {
        lines.push(`${msg ?? ''} ${JSON.stringify(obj)}`);
      };
      const logger: AuthLogger = { debug: log, info: log, warn: log, error: log };
      const { token } = await inviteMember(tx, {
        workspaceId,
        actorUserId: ownerId,
        input: { email: 'console@example.test', role: 'viewer' },
        mailer: consoleMailer(logger),
        appUrl: APP_URL,
      });
      expect(lines).toHaveLength(1);
      const line = lines[0] ?? '';
      expect(line.split('\n')).toContain(`${APP_URL}/invite/${token}`);
      expect(line).toContain('workspace.invitation');
      expect(line).toContain(AUTH_EMAIL_KEYS.invitation.subject);
      expect(line).toContain(AUTH_EMAIL_KEYS.invitation.body);
    });
  });
});

describe('reissueInvitation and revokeInvitation', () => {
  it('rotates the token, and a revoked token fails with REVOKED', async () => {
    await withTestDb(async (tx) => {
      const { ownerId, workspaceId } = await setup(tx);
      const mailer = recordingMailer();
      const base = { workspaceId, actorUserId: ownerId, mailer, appUrl: APP_URL };
      const first = await inviteMember(tx, {
        ...base,
        input: { email: 'revoke@example.test', role: 'junior' },
      });
      const reissued = await reissueInvitation(tx, { ...base, invitationId: first.invitation.id });
      expect(reissued.token).not.toBe(first.token);
      expect(mailer.sent).toHaveLength(2);

      await revokeInvitation(tx, {
        workspaceId,
        actorUserId: ownerId,
        invitationId: first.invitation.id,
      });
      const row = await invitationRow(tx, first.invitation.id);
      expect(row.revokedAt).not.toBeNull();
      expect(row.status).toBe('canceled');

      const userId = await newUser(tx, 'revoke@example.test');
      await expectReason(acceptInvitation(tx, { userId, token: reissued.token }), 'REVOKED');
      await expectCode(
        revokeInvitation(tx, {
          workspaceId,
          actorUserId: ownerId,
          invitationId: first.invitation.id,
        }),
        'NOT_FOUND',
      );
    });
  });
});

describe('acceptInvitation', () => {
  it('adds the matching user with the invited role, once', async () => {
    await withTestDb(async (tx) => {
      const { ownerId, workspaceId } = await setup(tx);
      const email = `${randomUUID()}@example.test`;
      const { token, invitation } = await inviteMember(tx, {
        workspaceId,
        actorUserId: ownerId,
        input: { email, role: 'clerk' },
        mailer: recordingMailer(),
        appUrl: APP_URL,
      });
      const userId = await newUser(tx, email);

      const accepted = await acceptInvitation(tx, { userId, token });
      expect(accepted).toMatchObject({ workspaceId, role: 'clerk' });
      expect(await memberRole(tx, userId, workspaceId)).toBe('clerk');
      const row = await invitationRow(tx, invitation.id);
      expect(row.acceptedAt).not.toBeNull();
      expect(row.status).toBe('accepted');

      await expectReason(acceptInvitation(tx, { userId, token }), 'USED');
    });
  });

  it('returns a distinct typed error for each failure', async () => {
    await withTestDb(async (tx) => {
      const { ownerId, workspaceId } = await setup(tx);
      const email = `${randomUUID()}@example.test`;
      const now = new Date('2026-10-19T10:00:00Z');
      const { token } = await inviteMember(tx, {
        workspaceId,
        actorUserId: ownerId,
        input: { email, role: 'junior' },
        mailer: recordingMailer(),
        appUrl: APP_URL,
        now,
      });
      const invitee = await newUser(tx, email);
      const stranger = await newUser(tx);

      const errors = [
        await expectReason(acceptInvitation(tx, { userId: invitee, token: 'nope' }), 'INVALID'),
        await expectReason(
          acceptInvitation(tx, {
            userId: invitee,
            token,
            now: new Date(now.getTime() + INVITATION_TTL_MS),
          }),
          'EXPIRED',
        ),
        await expectReason(
          acceptInvitation(tx, { userId: stranger, token, now }),
          'EMAIL_MISMATCH',
        ),
      ];
      expect(errors.map((e) => e.code)).toEqual(['NOT_FOUND', 'CONFLICT', 'FORBIDDEN']);
      expect(new Set(errors.map((e) => e.message)).size).toBe(3);
      expect(await memberRole(tx, stranger, workspaceId)).toBeNull();

      expect((await acceptInvitation(tx, { userId: invitee, token, now })).role).toBe('junior');
    });
  });

  it('reactivates a previously removed member with the invited role', async () => {
    await withTestDb(async (tx) => {
      const { ownerId, workspaceId } = await setup(tx);
      const former = await addMember(tx, workspaceId, 'advocate');
      await removeMember(tx, { workspaceId, actorUserId: ownerId, memberId: former.memberId });
      const [account] = await tx
        .select({ email: schema.user.email })
        .from(schema.user)
        .where(eq(schema.user.id, former.userId));

      const { token } = await inviteMember(tx, {
        workspaceId,
        actorUserId: ownerId,
        input: { email: account?.email ?? '', role: 'viewer' },
        mailer: recordingMailer(),
        appUrl: APP_URL,
      });
      const accepted = await acceptInvitation(tx, { userId: former.userId, token });
      expect(accepted.memberId).toBe(former.memberId);
      expect(await memberRole(tx, former.userId, workspaceId)).toBe('viewer');
    });
  });

  it('is rate limited per user', async () => {
    await withTestDb(async (tx) => {
      const userId = await newUser(tx);
      for (let i = 0; i < ACCEPT_RATE_LIMIT.max; i++) {
        await expectReason(
          acceptInvitation(tx, { userId, token: `guess-${String(i)}` }),
          'INVALID',
        );
      }
      await expectCode(acceptInvitation(tx, { userId, token: 'guess-last' }), 'RATE_LIMITED');
    });
  });
});
