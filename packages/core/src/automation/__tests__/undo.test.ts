// Undo (#47): the 7-day window, the cascade through a capture's derived activities, the refusals,
// the threshold raised by each undo, and the bulk undo and reassign of a capture.
import { schema } from '@causedeck/db';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import {
  acceptProposal,
  confirmActivity,
  createProceeding,
  proposeNextDate,
  previewUndo,
  reassignCapture,
  submitProposals,
  undoActivity,
  undoCapture,
  UndoExpiredError,
  UndoRefusedError,
} from '../../index.ts';

import { draft, NOW, rows, world, type World } from './world.ts';

const CAPTURE = '00000000-0000-4000-8000-0000000000c1';
const OTHER_CAPTURE = '00000000-0000-4000-8000-0000000000c2';
const DAY = 24 * 60 * 60 * 1000;

/** A wrong-matter attach (the root) and two tasks derived from the same capture. */
async function misfiledCapture(w: World, captureId = CAPTURE) {
  const { items } = await submitProposals(w.deps, w.owner, [
    draft({
      kind: 'document_attach',
      captureId,
      payload: { documentId: w.documentId, matterId: w.otherMatterId },
      match: { score: 0.95, exact: 'case_number' },
    }),
    draft({
      kind: 'task',
      captureId,
      confidence: 0.9,
      payload: { title: 'Call the clerk', matterId: w.otherMatterId },
    }),
    draft({
      kind: 'task',
      captureId,
      confidence: 0.9,
      payload: { title: 'Collect copy', matterId: w.otherMatterId },
    }),
  ]);
  expect(items.map((i) => i.status)).toEqual(['applied', 'applied', 'applied']);
  return items;
}

describe('undoActivity', () => {
  it('reverses the action and everything derived from it in the cascade group', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const items = await misfiledCapture(w);
      const rootId = items[0]?.activityId ?? '';
      const children = await rows.activities(w);
      expect(children.filter((a) => a.parentActivityId === rootId)).toHaveLength(2);
      expect(new Set(children.map((a) => a.cascadeGroupId)).size).toBe(1);

      const preview = await previewUndo(w.deps, w.owner, { activityId: rootId });
      expect(preview).toMatchObject({ undoable: true, blockedReason: null });
      expect(preview.willRemove.map((i) => i.kind).sort()).toEqual([
        'document_attach',
        'task',
        'task',
      ]);

      const result = await undoActivity(w.deps, w.owner, { activityId: rootId });
      expect(result.undone).toHaveLength(3);
      expect((await rows.document(w, w.documentId))?.matterId).toBe(w.matterId);
      expect(await rows.tasks(w)).toEqual([]);
      const after = await rows.activities(w);
      expect(after.every((a) => a.undoneAt !== null && a.undoneBy === w.ownerId)).toBe(true);
      expect(await rows.audit(w, 'automation.undone')).toHaveLength(1);
    });
  });

  it('undoing a derived action leaves the root in place', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const items = await misfiledCapture(w);
      await undoActivity(w.deps, w.owner, { activityId: items[1]?.activityId ?? '' });
      expect(await rows.tasks(w)).toHaveLength(1);
      expect((await rows.document(w, w.documentId))?.matterId).toBe(w.otherMatterId);
    });
  });

  it('raises the threshold of the undone kind and pattern by 0.02, capped at 0.99', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const items = await misfiledCapture(w);
      await undoActivity(w.deps, w.owner, { activityId: items[1]?.activityId ?? '' });
      const [row] = await rows.thresholds(w);
      expect(row).toMatchObject({ kind: 'task', patternKey: 'task', threshold: '0.820' });
      // The next draft below the new threshold is a proposal.
      const next = await submitProposals(w.deps, w.owner, [
        draft({ kind: 'task', confidence: 0.81, payload: { title: 'Another' } }),
        draft({ kind: 'task', confidence: 0.83, payload: { title: 'Another again' } }),
      ]);
      expect(next.items.map((i) => i.status)).toEqual(['proposed', 'applied']);
      // Twenty more undos reach the cap and stay there.
      for (let i = 0; i < 12; i++) {
        const r = await submitProposals(w.deps, w.owner, [
          draft({ kind: 'task', confidence: 0.99, payload: { title: `Task ${String(i)}` } }),
        ]);
        await undoActivity(w.deps, w.owner, { activityId: r.items[0]?.activityId ?? '' });
      }
      expect(Number((await rows.thresholds(w))[0]?.threshold)).toBe(0.99);
    });
  });

  it('throws UndoExpiredError after 7 days', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const items = await misfiledCapture(w);
      w.clock.now = new Date(NOW.getTime() + 7 * DAY + 1000);
      const rootId = items[0]?.activityId ?? '';
      expect((await previewUndo(w.deps, w.owner, { activityId: rootId })).undoable).toBe(false);
      await expect(undoActivity(w.deps, w.owner, { activityId: rootId })).rejects.toBeInstanceOf(
        UndoExpiredError,
      );
      expect((await rows.document(w, w.documentId))?.matterId).toBe(w.otherMatterId);
    });
  });

  it('is still allowed on the last day', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const items = await misfiledCapture(w);
      w.clock.now = new Date(NOW.getTime() + 7 * DAY - 1000);
      await undoActivity(w.deps, w.owner, { activityId: items[0]?.activityId ?? '' });
    });
  });

  it('refuses an action the lawyer later confirmed, with a reason', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const items = await misfiledCapture(w);
      await confirmActivity(w.deps, w.owner, { activityId: items[1]?.activityId ?? '' });
      const error = await undoActivity(w.deps, w.owner, {
        activityId: items[1]?.activityId ?? '',
      }).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(UndoRefusedError);
      expect((error as Error).message).toMatch(/confirmed or edited/);
      // A cascade that would take a confirmed activity with it is refused whole.
      await expect(
        undoActivity(w.deps, w.owner, { activityId: items[0]?.activityId ?? '' }),
      ).rejects.toBeInstanceOf(UndoRefusedError);
      expect(await rows.tasks(w)).toHaveLength(2);
    });
  });

  it('refuses to undo a proposal the lawyer accepted, and to undo twice', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const { items } = await submitProposals(w.deps, w.owner, [
        draft({ kind: 'task', payload: { title: 'Dated', dueDate: '2026-12-01' } }),
      ]);
      const done = await acceptProposal(w.deps, w.owner, {
        proposalId: items[0]?.proposalId ?? '',
      });
      await expect(
        undoActivity(w.deps, w.owner, { activityId: done.activity.id }),
      ).rejects.toBeInstanceOf(UndoRefusedError);
      const auto = await misfiledCapture(w);
      await undoActivity(w.deps, w.owner, { activityId: auto[0]?.activityId ?? '' });
      await expect(
        undoActivity(w.deps, w.owner, { activityId: auto[0]?.activityId ?? '' }),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
    });
  });
});

describe('undoCapture and reassignCapture', () => {
  it('undoes everything auto-applied from one capture and nothing from another', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      await misfiledCapture(w);
      await submitProposals(w.deps, w.owner, [
        draft({
          kind: 'task',
          captureId: OTHER_CAPTURE,
          confidence: 0.9,
          payload: { title: 'Elsewhere' },
        }),
      ]);
      const result = await undoCapture(w.deps, w.owner, { captureId: CAPTURE });
      expect(result.undone).toHaveLength(3);
      expect(result.skipped).toEqual([]);
      expect((await rows.tasks(w)).map((t) => t.title)).toEqual(['Elsewhere']);
      expect((await rows.document(w, w.documentId))?.matterId).toBe(w.matterId);
    });
  });

  it('reports what it left alone: a confirmed action is skipped, not undone', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const items = await misfiledCapture(w);
      await confirmActivity(w.deps, w.owner, { activityId: items[2]?.activityId ?? '' });
      const result = await undoCapture(w.deps, w.owner, { captureId: CAPTURE });
      expect(result.undone).toHaveLength(2);
      expect(result.skipped).toHaveLength(1);
      expect(result.skipped[0]?.reason).toMatch(/confirmed or edited/);
    });
  });

  it('moves a capture to another matter in one go and records the corrected match', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      await misfiledCapture(w);
      const result = await reassignCapture(w.deps, w.owner, {
        captureId: CAPTURE,
        matterId: w.matterId,
      });
      expect(result.moved).toEqual({ documents: 1, tasks: 2, obligations: 0, listings: 0 });
      expect((await rows.document(w, w.documentId))?.matterId).toBe(w.matterId);
      const tasks = await rows.tasks(w);
      expect(tasks.map((t) => t.matterId)).toEqual([w.matterId, w.matterId]);
      expect(tasks.every((t) => t.confirmationState === 'corrected')).toBe(true);
      expect((await rows.proposals(w)).every((p) => p.matterId === w.matterId)).toBe(true);
      // The person corrected it, so the system's own actions are theirs now.
      const original = (await rows.activities(w)).find((a) => a.kind === 'document_attach');
      await expect(
        undoActivity(w.deps, w.owner, { activityId: original?.id ?? '' }),
      ).rejects.toBeInstanceOf(UndoRefusedError);
      expect(await rows.audit(w, 'automation.reassigned')).toHaveLength(1);
    });
  });

  it('refuses a matter of another workspace', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const other = await world(tx);
      await misfiledCapture(w);
      await expect(
        reassignCapture(w.deps, w.owner, { captureId: CAPTURE, matterId: other.matterId }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  it('moves list data to the matching listing of the new matter and puts the old one back', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const mine = { sourceType: 'manual' } as const;
      const other = await createProceeding(w.deps, w.owner, {
        matterId: w.otherMatterId,
        forumId: w.forumId,
        caseType: 'W.P.',
        number: '202',
        year: 2026,
        provenance: mine,
      });
      const propose = async (proceedingId: string) => {
        const result = await proposeNextDate(w.deps, w.owner, {
          proceedingId,
          date: '2026-11-11',
          provenance: mine,
        });
        if (result.kind !== 'proposal') throw new Error('expected a proposal');
        return result.listingId;
      };
      const wrong = await propose(w.proceedingId);
      const right = await propose(other.id);
      const { items } = await submitProposals(w.deps, w.owner, [
        draft({
          kind: 'listing_update',
          captureId: CAPTURE,
          match: { score: 1, exact: 'case_number' },
          payload: { listingId: wrong, itemNo: '14' },
        }),
      ]);
      expect(items[0]?.status).toBe('applied');
      const itemNo = async (id: string) =>
        inWorkspace(w.tx, w.workspaceId, async (s) => {
          const [row] = await s.select().from(schema.listing).where(eq(schema.listing.id, id));
          return row?.itemNo ?? null;
        });
      expect(await itemNo(wrong)).toBe('14');
      const result = await reassignCapture(w.deps, w.owner, {
        captureId: CAPTURE,
        matterId: w.otherMatterId,
      });
      expect(result.moved.listings).toBe(1);
      expect(await itemNo(wrong)).toBeNull();
      expect(await itemNo(right)).toBe('14');
    });
  });
});
