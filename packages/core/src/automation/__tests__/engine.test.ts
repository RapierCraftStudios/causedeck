// The automation engine on the test database (#47): submit routes by level and drops nothing,
// accept/edit/dismiss record who and what, a dismissed draft never comes back, a confirmed next date
// is never overwritten, sensitive matters refuse AI drafts, and every step is audited.
import { schema } from '@causedeck/db';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import {
  acceptProposal,
  dismissProposal,
  editAndAccept,
  expireProposals,
  exportActivities,
  getAskFirst,
  KindNotEnabled,
  listProposalsForDigest,
  setAskFirst,
  submitProposals,
  WorkspaceError,
  getCanonicalNextDate,
  setSensitive,
} from '../../index.ts';

import { draft, rows, world } from './world.ts';

const CAPTURE = '00000000-0000-4000-8000-0000000000c1';
const UNDO_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

describe('submitProposals', () => {
  it('applies an L3 draft in the same transaction with an activity that can be undone for 7 days', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const { items } = await submitProposals(w.deps, w.owner, [
        draft({
          kind: 'document_attach',
          captureId: CAPTURE,
          payload: { documentId: w.documentId, matterId: w.otherMatterId },
          match: { score: 0.95, exact: 'case_number' },
        }),
      ]);
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({ status: 'applied', level: 'L3' });
      expect((await rows.document(w, w.documentId))?.matterId).toBe(w.otherMatterId);
      const [activity] = await rows.activities(w);
      expect(activity).toMatchObject({
        level: 'L3',
        actor: 'system',
        kind: 'document_attach',
        captureId: CAPTURE,
      });
      expect(activity?.undoPayload).toMatchObject({
        documentId: w.documentId,
        previousMatterId: w.matterId,
      });
      expect(activity ? activity.undoExpiresAt.getTime() - activity.createdAt.getTime() : 0).toBe(
        UNDO_DAYS_MS,
      );
      expect(activity?.undoneAt).toBeNull();
      const [proposal] = await rows.proposals(w);
      expect(proposal).toMatchObject({ status: 'accepted', level: 'L3' });
    });
  });

  it('leaves an L2 draft as a proposal that changes nothing, linked to its capture', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const { items } = await submitProposals(w.deps, w.owner, [
        draft({
          kind: 'task',
          captureId: CAPTURE,
          payload: { title: 'File reply', dueDate: '2026-11-05' },
        }),
      ]);
      expect(items[0]).toMatchObject({ status: 'proposed', level: 'L2' });
      expect(await rows.tasks(w)).toEqual([]);
      expect(await rows.activities(w)).toEqual([]);
      const [proposal] = await rows.proposals(w);
      expect(proposal).toMatchObject({ status: 'proposed', captureId: CAPTURE, kind: 'task' });
    });
  });

  it('drops nothing: an invalid draft becomes a needs-you record with its reason', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const { items } = await submitProposals(w.deps, w.owner, [
        { kind: 'task' },
        { kind: 'nonsense', payload: {} },
        'not even an object',
        draft({ kind: 'task', payload: { title: '' } }),
      ]);
      expect(items.map((i) => i.status)).toEqual([
        'needs_you',
        'needs_you',
        'needs_you',
        'needs_you',
      ]);
      expect(items.every((i) => i.proposalId !== null && (i.reason ?? '').length > 0)).toBe(true);
      const stored = await rows.proposals(w);
      expect(stored).toHaveLength(4);
      expect(stored.every((p) => p.needsYou && p.status === 'proposed')).toBe(true);
    });
  });

  it('keeps an unanchored AI draft, a low-confidence draft and a disabled kind as cards', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const ai = { type: 'ai', input: 'document' };
      const { items } = await submitProposals(w.deps, w.owner, [
        draft({ kind: 'task', source: ai, payload: { title: 'A' } }),
        draft({ kind: 'task', payload: { title: 'B' }, confidence: 0.2 }),
        draft({ kind: 'fee_entry', payload: { amount: 1 } }),
        draft({ kind: 'task', payload: { title: 'D' }, ambiguous: true }),
      ]);
      expect(items.map((i) => i.status)).toEqual([
        'needs_you',
        'needs_you',
        'needs_you',
        'needs_you',
      ]);
      expect(await rows.tasks(w)).toEqual([]);
    });
  });

  it('turns an L3 draft that cannot be applied into a card, rolling the change back', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const missing = '00000000-0000-4000-8000-0000000000aa';
      const { items } = await submitProposals(w.deps, w.owner, [
        draft({
          kind: 'document_attach',
          payload: { documentId: missing, matterId: w.otherMatterId },
          match: { score: 0.99, exact: 'cnr' },
        }),
      ]);
      expect(items[0]?.status).toBe('needs_you');
      expect(items[0]?.reason).toMatch(/could not be applied/);
      expect(await rows.activities(w)).toEqual([]);
      expect(await rows.proposals(w)).toHaveLength(1);
    });
  });

  it('never proposes the same draft twice, and never again once dismissed', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const one = draft({
        kind: 'task',
        captureId: CAPTURE,
        payload: { title: 'Call', dueDate: '2026-12-01' },
      });
      const first = await submitProposals(w.deps, w.owner, [one, one]);
      expect(first.items.map((i) => i.status)).toEqual(['proposed', 'duplicate']);
      const proposalId = first.items[0]?.proposalId ?? '';
      await dismissProposal(w.deps, w.owner, { proposalId, reason: 'not needed' });
      const again = await submitProposals(w.deps, w.owner, [one]);
      expect(again.items[0]).toMatchObject({ status: 'duplicate' });
      expect(again.items[0]?.reason).toMatch(/dismissed/);
      expect(await rows.proposals(w)).toHaveLength(1);
    });
  });

  it('refuses an AI draft for a sensitive matter, and takes a manual or deterministic one', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      await setSensitive(w.deps, w.owner, { matterId: w.matterId, sensitive: true });
      const payload = { title: 'Call', dueDate: '2026-12-02', matterId: w.matterId };
      const { items } = await submitProposals(w.deps, w.owner, [
        draft({
          kind: 'task',
          source: { type: 'ai', input: 'document' },
          anchors: ['00000000-0000-4000-8000-000000000001'],
          payload,
        }),
        draft({
          kind: 'task',
          source: { type: 'manual', input: 'form' },
          payload: { ...payload, title: 'By hand' },
        }),
        draft({ kind: 'task', payload: { ...payload, title: 'By rule' } }),
      ]);
      expect(items.map((i) => i.status)).toEqual(['refused', 'proposed', 'proposed']);
      expect(await rows.proposals(w)).toHaveLength(2);
    });
  });

  it('leaves proposals about a sensitive matter out of digests that leave the workspace', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      await submitProposals(w.deps, w.owner, [
        draft({
          kind: 'task',
          payload: { title: 'Open', dueDate: '2026-12-02', matterId: w.otherMatterId },
        }),
        draft({
          kind: 'task',
          payload: { title: 'Secret', dueDate: '2026-12-02', matterId: w.matterId },
        }),
        draft({ kind: 'task', payload: { title: 'Elsewhere', dueDate: '2026-12-03' } }),
      ]);
      await setSensitive(w.deps, w.owner, { matterId: w.matterId, sensitive: true });
      const digest = await listProposalsForDigest(w.deps, w.owner);
      expect(digest).toHaveLength(2);
      const stored = await rows.proposals(w);
      const secret = stored.find((p) => p.matterId === w.matterId);
      expect(digest.map((d) => d.id)).not.toContain(secret?.id);
    });
  });

  it('writes an audit event for the submit and for the apply', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      await submitProposals(w.deps, w.owner, [
        draft({
          kind: 'document_attach',
          payload: { documentId: w.documentId, matterId: w.otherMatterId },
          match: { score: 1, exact: 'cnr' },
        }),
      ]);
      expect(await rows.audit(w, 'automation.submitted')).toHaveLength(1);
      const applied = await rows.audit(w, 'automation.applied');
      expect(applied).toHaveLength(1);
      expect(applied[0]?.metadata).toMatchObject({ kind: 'document_attach', level: 'L3' });
    });
  });
});

describe('acceptProposal, editAndAccept, dismissProposal', () => {
  it('accepting runs the handler and writes an L2 activity by the accepting user', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const { items } = await submitProposals(w.deps, w.owner, [
        draft({
          kind: 'task',
          payload: { title: 'File reply', dueDate: '2026-11-05', matterId: w.matterId },
        }),
      ]);
      const proposalId = items[0]?.proposalId ?? '';
      const done = await acceptProposal(w.deps, w.owner, { proposalId });
      expect(done.proposal).toMatchObject({ status: 'accepted', resolvedBy: w.ownerId });
      expect(done.proposal.resolvedAt).not.toBeNull();
      expect(done.activity).toMatchObject({ level: 'L2', actor: 'user', actorUserId: w.ownerId });
      const tasks = await rows.tasks(w);
      expect(tasks).toHaveLength(1);
      expect(tasks[0]).toMatchObject({ title: 'File reply', confirmationState: 'confirmed' });
      await expect(acceptProposal(w.deps, w.owner, { proposalId })).rejects.toBeInstanceOf(
        WorkspaceError,
      );
    });
  });

  it('edit-and-accept applies the edited payload and keeps the diff', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const { items } = await submitProposals(w.deps, w.owner, [
        draft({ kind: 'task', payload: { title: 'File reply', dueDate: '2026-11-05' } }),
      ]);
      const proposalId = items[0]?.proposalId ?? '';
      const done = await editAndAccept(w.deps, w.owner, {
        proposalId,
        payload: { title: 'File reply and rejoinder', dueDate: '2026-11-05' },
      });
      expect(done.proposal.status).toBe('edited');
      expect(done.proposal.editDiff).toEqual({
        title: { from: 'File reply', to: 'File reply and rejoinder' },
      });
      expect((await rows.tasks(w))[0]?.title).toBe('File reply and rejoinder');
    });
  });

  it('dismissing records who, when and why, and applies nothing', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const { items } = await submitProposals(w.deps, w.owner, [
        draft({ kind: 'task', payload: { title: 'X', dueDate: '2026-11-05' } }),
      ]);
      const proposalId = items[0]?.proposalId ?? '';
      const row = await dismissProposal(w.deps, w.owner, {
        proposalId,
        reason: 'duplicate of a task',
      });
      expect(row).toMatchObject({
        status: 'dismissed',
        resolvedBy: w.ownerId,
        resolutionReason: 'duplicate of a task',
      });
      expect(await rows.tasks(w)).toEqual([]);
      expect(await rows.audit(w, 'automation.dismissed')).toHaveLength(1);
    });
  });

  it('refuses to accept a kind that is not enabled yet', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const { items } = await submitProposals(w.deps, w.owner, [
        draft({ kind: 'fee_entry', payload: { amount: 1 } }),
      ]);
      const proposalId = items[0]?.proposalId ?? '';
      await expect(acceptProposal(w.deps, w.owner, { proposalId })).rejects.toBeInstanceOf(
        KindNotEnabled,
      );
    });
  });

  it('expires proposals nobody answered', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      await submitProposals(w.deps, w.owner, [
        draft({ kind: 'task', payload: { title: 'Old', dueDate: '2026-11-05' } }),
      ]);
      expect(await expireProposals(w.deps, w.owner, { before: new Date('2020-01-01') })).toEqual({
        expired: 0,
      });
      expect(await expireProposals(w.deps, w.owner, { before: new Date('2100-01-01') })).toEqual({
        expired: 1,
      });
      expect((await rows.proposals(w))[0]?.status).toBe('expired');
    });
  });
});

describe('next_date', () => {
  it('never overwrites a confirmed next date: a differing proposal is a conflict card, applied only on accept', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const first = await submitProposals(w.deps, w.owner, [
        draft({ kind: 'next_date', payload: { proceedingId: w.proceedingId, date: '2026-11-10' } }),
      ]);
      expect(first.items[0]?.status).toBe('proposed');
      const confirmedFirst = await acceptProposal(w.deps, w.owner, {
        proposalId: first.items[0]?.proposalId ?? '',
      });
      expect(confirmedFirst.activity.level).toBe('L2');
      const canonical = await getCanonicalNextDate(w.deps, w.owner, {
        proceedingId: w.proceedingId,
      });
      expect(canonical?.listDate).toBe('2026-11-10');

      const second = await submitProposals(w.deps, w.owner, [
        draft({
          kind: 'next_date',
          confidence: 0.99,
          payload: { proceedingId: w.proceedingId, date: '2026-12-15' },
          match: { score: 1, exact: 'case_number' },
        }),
      ]);
      expect(second.items[0]).toMatchObject({ status: 'proposed', level: 'L2' });
      const conflictRow = (await rows.proposals(w)).find(
        (p) => p.id === second.items[0]?.proposalId,
      );
      expect(conflictRow?.entityRefs).toMatchObject({ conflict: true });
      // Both sources are kept, and the confirmed date has not moved.
      const listings = await inWorkspace(w.tx, w.workspaceId, (s) =>
        s.select().from(schema.listing).where(eq(schema.listing.proceedingId, w.proceedingId)),
      );
      expect(listings.map((l) => l.listDate).sort()).toEqual(['2026-11-10', '2026-12-15']);
      expect(
        (await getCanonicalNextDate(w.deps, w.owner, { proceedingId: w.proceedingId }))?.listDate,
      ).toBe('2026-11-10');

      await acceptProposal(w.deps, w.owner, { proposalId: second.items[0]?.proposalId ?? '' });
      expect(
        (await getCanonicalNextDate(w.deps, w.owner, { proceedingId: w.proceedingId }))?.listDate,
      ).toBe('2026-12-15');
    });
  });

  it('supersedes a proposal for the date that is already confirmed', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const staged = await submitProposals(w.deps, w.owner, [
        draft({ kind: 'next_date', payload: { proceedingId: w.proceedingId, date: '2026-11-10' } }),
      ]);
      await acceptProposal(w.deps, w.owner, { proposalId: staged.items[0]?.proposalId ?? '' });
      const again = await submitProposals(w.deps, w.owner, [
        draft({
          kind: 'next_date',
          captureId: CAPTURE,
          payload: { proceedingId: w.proceedingId, date: '2026-11-10' },
        }),
      ]);
      expect(again.items[0]?.status).toBe('superseded');
    });
  });
});

describe('ask-first dial and thresholds', () => {
  it('downgrades an L3 draft to a proposal for a user who asked to be asked first', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const attach = (title: string) =>
        draft({
          kind: 'task',
          confidence: 0.9,
          payload: { title },
        });
      expect((await submitProposals(w.deps, w.owner, [attach('one')])).items[0]?.status).toBe(
        'applied',
      );
      await setAskFirst(w.deps, w.owner, { kind: 'task', askFirst: true });
      expect(await getAskFirst(w.deps, w.owner)).toEqual(['task']);
      expect((await submitProposals(w.deps, w.owner, [attach('two')])).items[0]?.status).toBe(
        'proposed',
      );
      await setAskFirst(w.deps, w.owner, { kind: 'task', askFirst: false });
      expect((await submitProposals(w.deps, w.owner, [attach('three')])).items[0]?.status).toBe(
        'applied',
      );
    });
  });

  it('exports activities with the source, level and undo fields', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      await submitProposals(w.deps, w.owner, [
        draft({ kind: 'task', payload: { title: 'Call' }, confidence: 0.9 }),
      ]);
      const [row] = await exportActivities(w.deps, w.owner);
      expect(row).toMatchObject({
        kind: 'task',
        level: 'L3',
        actor: 'system',
        input_source: 'document',
        confirmed_at: null,
        undone_at: null,
      });
      expect(row?.undo_payload).not.toBeNull();
      expect(row?.undo_expires_at).toBeTruthy();
      expect(row).toHaveProperty('model');
      expect(row).toHaveProperty('region');
      expect(row).toHaveProperty('parent_activity_id');
      expect(row).toHaveProperty('cascade_group_id');
    });
  });
});
