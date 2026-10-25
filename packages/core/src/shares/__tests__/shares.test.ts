import { schema, withWorkspace, type Transaction } from '@causedeck/db';
import { insertBriefFixture } from '@causedeck/db/seed/brief-fixtures';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { referralFunnel } from '../../activation/index.ts';
import { setBriefNote } from '../../briefs/index.ts';
import { failure, newWorkspace } from '../../__tests__/fixtures.ts';
import {
  claimBriefShare,
  createBriefShare,
  importSharedMatter,
  revokeBriefShare,
  viewBriefShare,
} from '../index.ts';

const events = { emit: () => undefined };

async function seedBrief(tx: Transaction) {
  const { ownerId, workspaceId } = await newWorkspace(tx);
  const fixture = await inWorkspace(tx, workspaceId, async (s) => {
    const [m] = await s.select().from(schema.member).where(eq(schema.member.userId, ownerId));
    if (m === undefined) throw new Error('owner member');
    return insertBriefFixture(s, { workspaceId, ownerMemberId: m.id, date: '2026-10-26' });
  });
  return { ownerId, workspaceId, actor: { userId: ownerId, workspaceId }, fixture };
}

describe('brief sharing (#507)', () => {
  it('shows a non-user only the sanitised snapshot, until it expires', async () => {
    await withTestDb(async (tx) => {
      const { actor, fixture, workspaceId } = await seedBrief(tx);
      await setBriefNote({ db: tx }, actor, { listingId: fixture.listingId, note: 'PRIVATE-NOTE' });
      const share = await createBriefShare({ db: tx }, actor, fixture.listingId);
      const view = await viewBriefShare(tx, share.token);
      expect(view.state).toBe('VALID');
      const text = JSON.stringify(view);
      expect(text).not.toContain('PRIVATE-NOTE');
      expect(text).not.toContain(workspaceId);
      expect(text).not.toContain(fixture.listingId);
      expect(text).not.toContain('document_id');
      expect(Object.keys(view.state === 'VALID' ? view.snapshot : {}).sort()).toEqual([
        'assembledAt',
        'lastHearing',
        'lastOrder',
        'matterTitle',
        'openObligations',
        'stage',
        'synopsis',
      ]);
      const later = new Date(share.expiresAt.getTime() + 1000);
      expect((await viewBriefShare(tx, share.token, later)).state).toBe('EXPIRED');
      expect((await viewBriefShare(tx, 'not-a-real-token-at-all')).state).toBe('INVALID');
    });
  });

  it('revokes at once, and only for the creator or an owner of the same workspace', async () => {
    await withTestDb(async (tx) => {
      const { actor, fixture, workspaceId } = await seedBrief(tx);
      const share = await createBriefShare({ db: tx }, actor, fixture.listingId);
      const other = await newWorkspace(tx);
      await failure(revokeBriefShare({ db: tx }, { userId: other.ownerId, workspaceId }, share.id));
      expect((await viewBriefShare(tx, share.token)).state).toBe('VALID');
      await revokeBriefShare({ db: tx }, actor, share.id);
      expect((await viewBriefShare(tx, share.token)).state).toBe('REVOKED');
      await failure(revokeBriefShare({ db: tx }, actor, share.id));
    });
  });

  it('converts a new user: claim, import into their workspace, credit both sides once', async () => {
    await withTestDb(async (tx) => {
      const { actor, fixture } = await seedBrief(tx);
      const share = await createBriefShare({ db: tx }, actor, fixture.listingId);
      const invitee = await newWorkspace(tx);
      const claim = await claimBriefShare(tx, { userId: invitee.ownerId, token: share.token });
      expect(claim.referred).toBe(true);
      const invitee2 = { userId: invitee.ownerId, workspaceId: invitee.workspaceId };
      const imported = await importSharedMatter({ db: tx, events }, invitee2, share.token);
      expect(imported.credit).toEqual({ granted: true, months: 1 });
      const credits = await tx.select().from(schema.referralCredit);
      expect(credits.map((c) => c.side).sort()).toEqual(['invitee', 'referrer']);
      expect(credits.find((c) => c.side === 'referrer')?.userId).toBe(actor.userId);
      const again = await importSharedMatter({ db: tx, events }, invitee2, share.token);
      expect(again.credit).toBeNull();
      expect(await tx.select().from(schema.referralCredit)).toHaveLength(2);
      const matter = await withWorkspace(tx, invitee2, (w) =>
        w.select().from(schema.matter).where(eq(schema.matter.id, imported.matterId)),
      );
      expect(matter[0]?.workspaceId).toBe(invitee.workspaceId);
      const funnel = await referralFunnel(tx);
      expect(funnel.accepted).toBeGreaterThanOrEqual(1);
      expect(funnel.activated).toBeGreaterThanOrEqual(1);
      expect(funnel.credited).toBeGreaterThanOrEqual(1);
      expect(funnel.invitesSent).toBeGreaterThanOrEqual(1);
    });
  });

  it('does not refer the sharer to themselves, and a revoked link cannot be claimed or imported', async () => {
    await withTestDb(async (tx) => {
      const { actor, fixture } = await seedBrief(tx);
      const share = await createBriefShare({ db: tx }, actor, fixture.listingId);
      expect(await claimBriefShare(tx, { userId: actor.userId, token: share.token })).toEqual({
        referralId: null,
        referred: false,
      });
      await revokeBriefShare({ db: tx }, actor, share.id);
      const invitee = await newWorkspace(tx);
      await failure(claimBriefShare(tx, { userId: invitee.ownerId, token: share.token }));
      await failure(
        importSharedMatter(
          { db: tx, events },
          { userId: invitee.ownerId, workspaceId: invitee.workspaceId },
          share.token,
        ),
      );
    });
  });
});
