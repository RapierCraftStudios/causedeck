// The audit feed query and the audit.read gate (#229, #26 part 4): owners always, advocates unless
// the workspace turns it off, juniors/clerks/viewers and non-members never; filters, keyset paging
// and owner-only IPs. Every test runs in a rolled-back app-role transaction.
import { withTestDb } from '@causedeck/db/testing';
import type { Transaction } from '@causedeck/db';
import { describe, expect, it } from 'vitest';

import { WorkspaceError } from '../../workspaces/index.ts';
import { authorizeAuditRead, queryAudit, record } from '../index.ts';
import {
  addMember,
  failure,
  newUser,
  newWorkspace,
  setAdvocatesCanReadAudit,
} from '../../__tests__/fixtures.ts';

async function seed(tx: Transaction) {
  const { ownerId, workspaceId } = await newWorkspace(tx);
  const roles = {
    advocate: await addMember(tx, workspaceId, 'advocate'),
    junior: await addMember(tx, workspaceId, 'junior'),
    clerk: await addMember(tx, workspaceId, 'clerk'),
    viewer: await addMember(tx, workspaceId, 'viewer'),
  };
  const ctx = (userId: string) => ({ db: tx, workspaceId, userId });
  return { ownerId, workspaceId, roles, ctx };
}

async function code(promise: Promise<unknown>): Promise<string | undefined> {
  const error = await failure(promise);
  expect(error).toBeInstanceOf(WorkspaceError);
  return (error as WorkspaceError).code;
}

describe('audit.read gate', () => {
  it('allows owners and advocates; denies juniors, clerks, viewers and non-members', async () => {
    await withTestDb(async (tx) => {
      const { ownerId, roles, ctx } = await seed(tx);
      expect(await authorizeAuditRead(ctx(ownerId))).toBe('owner');
      expect(await authorizeAuditRead(ctx(roles.advocate))).toBe('advocate');
      for (const role of ['junior', 'clerk', 'viewer'] as const) {
        expect(await code(authorizeAuditRead(ctx(roles[role]))), role).toBe('FORBIDDEN');
        expect(await code(queryAudit(ctx(roles[role]))), role).toBe('FORBIDDEN');
      }
      expect(await code(queryAudit(ctx(await newUser(tx))))).toBe('NOT_FOUND');
      return null;
    });
  });

  it('denies advocates when the workspace turns advocates_can_read_audit off', async () => {
    await withTestDb(async (tx) => {
      const { ownerId, workspaceId, roles, ctx } = await seed(tx);
      await setAdvocatesCanReadAudit(tx, workspaceId, false);
      expect(await code(queryAudit(ctx(roles.advocate)))).toBe('FORBIDDEN');
      expect((await queryAudit(ctx(ownerId))).events).toBeDefined();
      await setAdvocatesCanReadAudit(tx, workspaceId, true);
      expect((await queryAudit(ctx(roles.advocate))).events).toBeDefined();
      return null;
    });
  });
});

describe('queryAudit', () => {
  it('pages newest first without gaps or repeats, and filters by actor, action group and date', async () => {
    await withTestDb(async (tx) => {
      const { ownerId, workspaceId, roles, ctx } = await seed(tx);
      const actx = (userId: string) => ({
        db: tx,
        workspaceId,
        actor: { userId, kind: 'user' as const },
      });
      for (let i = 0; i < 5; i++) {
        await record(actx(ownerId), { action: 'member.role_changed', metadata: { n: i } });
      }
      await record(actx(roles.advocate), { action: 'flag.changed' });

      const all = await queryAudit(ctx(ownerId), { limit: 200 });
      const ids: string[] = [];
      let cursor: string | undefined;
      for (;;) {
        const page = await queryAudit(ctx(ownerId), { limit: 2, ...(cursor ? { cursor } : {}) });
        ids.push(...page.events.map((e) => e.id));
        if (!page.nextCursor) break;
        cursor = page.nextCursor;
      }
      expect(ids).toEqual(all.events.map((e) => e.id));
      expect(new Set(ids).size).toBe(ids.length);
      const times = all.events.map((e) => e.createdAt);
      expect([...times].sort().reverse()).toEqual(times);

      const byAdvocate = await queryAudit(ctx(ownerId), { actorUserId: roles.advocate });
      expect(byAdvocate.events.map((e) => e.action)).toEqual(['flag.changed']);
      const members = await queryAudit(ctx(ownerId), { actionGroup: 'member' });
      expect(members.events).toHaveLength(5);
      expect(members.events.every((e) => e.action.startsWith('member.'))).toBe(true);
      const exact = await queryAudit(ctx(ownerId), { actionGroup: 'flag.changed' });
      expect(exact.events).toHaveLength(1);
      const future = await queryAudit(ctx(ownerId), { from: new Date(Date.now() + 86_400_000) });
      expect(future.events).toEqual([]);
      return null;
    });
  });

  it('shows the truncated IP to owners only and never a raw user agent', async () => {
    await withTestDb(async (tx) => {
      const { ownerId, workspaceId, roles, ctx } = await seed(tx);
      await record(
        {
          db: tx,
          workspaceId,
          actor: { userId: ownerId, kind: 'user' },
          ip: '203.0.113.7',
          userAgent: 'Mozilla/5.0 Secret',
        },
        { action: 'member.removed' },
      );
      const [asOwner] = (await queryAudit(ctx(ownerId))).events;
      expect(asOwner?.ip).toBe('203.0.113.0/24');
      const [asAdvocate] = (await queryAudit(ctx(roles.advocate))).events;
      expect(asAdvocate).toBeDefined();
      expect(asAdvocate && 'ip' in asAdvocate).toBe(false);
      expect(JSON.stringify(asAdvocate)).not.toContain('Mozilla');
      expect(asAdvocate?.userAgentHash).toMatch(/^[0-9a-f]{64}$/);
      return null;
    });
  });

  it('rejects bad input', async () => {
    await withTestDb(async (tx) => {
      const { ownerId, ctx } = await seed(tx);
      expect(await code(queryAudit(ctx(ownerId), { cursor: 'not-a-cursor' }))).toBe('VALIDATION');
      expect(await code(queryAudit(ctx(ownerId), { limit: 0 }))).toBe('VALIDATION');
      expect(await code(queryAudit(ctx(ownerId), { limit: 201 }))).toBe('VALIDATION');
      expect(await code(queryAudit(ctx(ownerId), { actionGroup: "x' or 1=1" }))).toBe('VALIDATION');
      const now = new Date();
      expect(await code(queryAudit(ctx(ownerId), { from: now, to: now }))).toBe('VALIDATION');
      return null;
    });
  });
});
