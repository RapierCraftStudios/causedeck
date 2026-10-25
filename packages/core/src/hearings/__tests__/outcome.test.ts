// The hearing outcome (#62): L2 next date (a human resolution, anchored or typed, a conflict waits for
// a choice), all-or-nothing confirmation, reasons for dismissals, the L0 manual path, audit, events,
// delegated appearances and who may read or confirm.
import { schema } from '@causedeck/db';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { buildListing } from '@causedeck/db/testing/matter-graph-fixtures';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { WorkspaceError } from '../../shared/errors.ts';
import { confirmOutcome, getOutcomeProposal, recordManualOutcome } from '../index.ts';

import { addMember, world, HELD_ON } from './support.ts';

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  const error: unknown = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  if (error === undefined) return undefined;
  expect(error).toBeInstanceOf(WorkspaceError);
  return (error as WorkspaceError).code;
}

const outcome = { outcome: 'Adjourned for arguments' };

describe('getOutcomeProposal', () => {
  it('is processing without proposals and carries each line with its anchor once staged', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const before = await getOutcomeProposal(w.deps, w.owner, { hearingId: w.hearingId });
      expect(before.state).toBe('processing');
      await w.stage();
      const p = await getOutcomeProposal(w.deps, w.owner, { hearingId: w.hearingId });
      expect(p).toMatchObject({ state: 'ready', language: 'en' });
      expect(p.nextDate).toMatchObject({ value: '2026-11-03', anchorId: w.anchorId });
      expect(p.obligations).toHaveLength(1);
      expect(p.tasks).toHaveLength(1);
    });
  });

  it('marks an unanchored draft as needing the lawyer and leaves its field blank', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      await w.stage({ needsYou: true });
      await inWorkspace(tx, w.workspaceId, (s) =>
        s.update(schema.proposal).set({ anchors: [] }).where(eq(schema.proposal.kind, 'next_date')),
      );
      const p = await getOutcomeProposal(w.deps, w.owner, { hearingId: w.hearingId });
      expect(p.state).toBe('needs_you');
      expect(p.nextDate).toBeUndefined();
    });
  });

  it('gives a clerk no strategy text and denies a user outside the workspace', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      await w.stage();
      const clerk = await addMember(tx, w.workspaceId, 'clerk');
      const p = await getOutcomeProposal(
        w.deps,
        { userId: clerk, workspaceId: w.workspaceId },
        { hearingId: w.hearingId },
      );
      expect(p.summary).toBeUndefined();
      expect(p.obligations).toEqual([]);
      const other = await world(tx);
      expect(
        await codeOf(getOutcomeProposal(w.deps, other.owner, { hearingId: w.hearingId })),
      ).toBe('NOT_FOUND');
    });
  });
});

describe('confirmOutcome', () => {
  it('rejects an unresolved next date, and a proposal date that no anchored source carries', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      await w.stage();
      const base = { hearingId: w.hearingId, ...outcome };
      expect(await codeOf(confirmOutcome(w.deps, w.owner, base as never))).toBe('VALIDATION');
      expect(
        await codeOf(
          confirmOutcome(w.deps, w.owner, {
            ...base,
            nextDate: { kind: 'date', date: '2026-12-01', source: 'proposal' },
          }),
        ),
      ).toBe('VALIDATION');
      const [row] = await inWorkspace(tx, w.workspaceId, (s) => s.select().from(schema.hearing));
      expect(row?.confirmationState).not.toBe('confirmed');
    });
  });

  it('applies the hearing, canonical date, obligation, task, proposals, audit and event together', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const ids = await w.stage();
      const result = await confirmOutcome(w.deps, w.owner, {
        hearingId: w.hearingId,
        ...outcome,
        nextDate: { kind: 'date', date: '2026-11-03', source: 'proposal' },
        obligations: [{ proposalId: ids['obligation_from_direction'] ?? null, action: 'confirm' }],
        tasks: [{ proposalId: ids['task'] ?? null, action: 'confirm' }],
      });
      expect(result).toMatchObject({ nextDate: '2026-11-03' });
      expect(result.obligationIds).toHaveLength(1);
      expect(result.taskIds).toHaveLength(1);
      const rows = await inWorkspace(tx, w.workspaceId, async (s) => ({
        hearing: await s.select().from(schema.hearing),
        listings: await s
          .select()
          .from(schema.listing)
          .where(and(eq(schema.listing.canonical, true))),
        proposals: await s.select().from(schema.proposal),
        audit: await s
          .select()
          .from(schema.auditEvent)
          .where(eq(schema.auditEvent.action, 'hearing.outcome_confirmed')),
        obligations: await s.select().from(schema.obligation),
      }));
      expect(rows.hearing[0]).toMatchObject({
        outcome: 'Adjourned for arguments',
        nextDateConfirmed: '2026-11-03',
        confirmationState: 'confirmed',
      });
      expect(rows.listings.map((l) => l.listDate)).toEqual(['2026-11-03']);
      expect(rows.proposals.every((p) => p.status === 'accepted')).toBe(true);
      expect(rows.audit).toHaveLength(1);
      expect(rows.obligations[0]).toMatchObject({
        confirmationState: 'confirmed',
        anchorId: w.anchorId,
        status: 'open',
      });
      expect(w.events.map((e) => e.type)).toContain('hearing.outcome_confirmed');
      expect(
        await codeOf(
          confirmOutcome(w.deps, w.owner, {
            hearingId: w.hearingId,
            ...outcome,
            nextDate: { kind: 'none' },
          }),
        ),
      ).toBe('CONFLICT');
    });
  });

  it('is all or nothing: a failing task leaves the hearing, date and obligations untouched', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const ids = await w.stage();
      const failing = confirmOutcome(w.deps, w.owner, {
        hearingId: w.hearingId,
        ...outcome,
        nextDate: { kind: 'date', date: '2026-11-03', source: 'proposal' },
        obligations: [{ proposalId: ids['obligation_from_direction'] ?? null, action: 'confirm' }],
        tasks: [{ proposalId: ids['obligation_from_direction'] ?? null, action: 'confirm' }],
      });
      expect(await codeOf(failing)).toBe('VALIDATION');
      const rows = await inWorkspace(tx, w.workspaceId, async (s) => ({
        hearing: await s.select().from(schema.hearing),
        obligations: await s.select().from(schema.obligation),
        canonical: await s.select().from(schema.listing).where(eq(schema.listing.canonical, true)),
      }));
      expect(rows.hearing[0]?.confirmationState).not.toBe('confirmed');
      expect(rows.obligations).toEqual([]);
      expect(rows.canonical).toEqual([]);
      expect(w.events.filter((e) => e.type === 'hearing.outcome_confirmed')).toEqual([]);
    });
  });

  it('keeps the canonical date on a conflict until the lawyer chooses, and logs the choice', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      await w.stage();
      await inWorkspace(tx, w.workspaceId, (s) =>
        buildListing(s, w.workspaceId, {
          proceedingId: w.proceedingId,
          listDate: '2026-11-17',
          canonical: true,
          confirmationState: 'confirmed',
        }),
      );
      const proposal = await getOutcomeProposal(w.deps, w.owner, { hearingId: w.hearingId });
      expect(proposal.conflict).toMatchObject({
        currentDate: '2026-11-17',
        proposedDate: '2026-11-03',
      });
      const input = {
        hearingId: w.hearingId,
        ...outcome,
        nextDate: { kind: 'date', date: '2026-11-03', source: 'proposal' },
      } as const;
      expect(await codeOf(confirmOutcome(w.deps, w.owner, input))).toBe('VALIDATION');
      const [still] = await inWorkspace(tx, w.workspaceId, (s) =>
        s.select().from(schema.listing).where(eq(schema.listing.canonical, true)),
      );
      expect(still?.listDate).toBe('2026-11-17');
      const done = await confirmOutcome(w.deps, w.owner, { ...input, conflictChoice: 'current' });
      expect(done.nextDate).toBe('2026-11-17');
      const [event] = await inWorkspace(tx, w.workspaceId, (s) =>
        s
          .select()
          .from(schema.auditEvent)
          .where(eq(schema.auditEvent.action, 'hearing.outcome_confirmed')),
      );
      expect(event?.metadata).toMatchObject({ conflictChoice: 'current' });
    });
  });

  it('records a dismissed obligation with its reason and creates nothing for it', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const ids = await w.stage();
      await confirmOutcome(w.deps, w.owner, {
        hearingId: w.hearingId,
        ...outcome,
        nextDate: { kind: 'to_be_notified' },
        obligations: [
          {
            proposalId: ids['obligation_from_direction'] ?? null,
            action: 'dismiss',
            reason: 'not applicable',
          },
        ],
      });
      const rows = await inWorkspace(tx, w.workspaceId, async (s) => ({
        obligations: await s.select().from(schema.obligation),
        dismissed: await s
          .select()
          .from(schema.proposal)
          .where(eq(schema.proposal.id, ids['obligation_from_direction'] ?? '')),
      }));
      expect(rows.obligations).toEqual([]);
      expect(rows.dismissed[0]).toMatchObject({
        status: 'dismissed',
        resolutionReason: 'not applicable',
      });
      expect(
        await codeOf(
          confirmOutcome(w.deps, w.owner, {
            hearingId: w.hearingId,
            ...outcome,
            nextDate: { kind: 'none' },
            obligations: [{ proposalId: null, action: 'dismiss' }],
          }),
        ),
      ).toBe('VALIDATION');
    });
  });

  it('notifies the owner when a junior who appeared for the lawyer confirms', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const junior = await addMember(tx, w.workspaceId, 'junior');
      await inWorkspace(tx, w.workspaceId, async (s) => {
        const [m] = await s
          .select({ id: schema.member.id })
          .from(schema.member)
          .where(eq(schema.member.userId, junior));
        const [ownerMember] = await s
          .select({ id: schema.member.id })
          .from(schema.member)
          .where(eq(schema.member.userId, w.ownerId));
        await s
          .update(schema.matter)
          .set({ ownerMemberId: ownerMember?.id ?? null })
          .where(eq(schema.matter.id, w.matterId));
        await s.insert(schema.appearance).values({
          workspaceId: w.workspaceId,
          hearingId: w.hearingId,
          memberId: m?.id ?? null,
          capacity: 'for_other',
        });
      });
      await recordManualOutcome(
        w.deps,
        { userId: junior, workspaceId: w.workspaceId },
        { hearingId: w.hearingId, ...outcome, nextDate: { kind: 'none' } },
      );
      expect(w.events.find((e) => e.type === 'hearing.outcome_confirmed')).toMatchObject({
        actorUserId: junior,
        notifyUserId: w.ownerId,
      });
    });
  });
});

describe('recordManualOutcome (L0)', () => {
  it('confirms a typed note with a typed date and no proposals', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const result = await recordManualOutcome(w.deps, w.owner, {
        hearingId: w.hearingId,
        ...outcome,
        nextDate: { kind: 'date', date: '2026-11-10', source: 'manual' },
      });
      expect(result).toMatchObject({ nextDate: '2026-11-10', obligationIds: [], taskIds: [] });
      const [row] = await inWorkspace(tx, w.workspaceId, (s) =>
        s.select().from(schema.listing).where(eq(schema.listing.canonical, true)),
      );
      expect(row).toMatchObject({ listDate: '2026-11-10', sourceType: 'manual' });
      expect(HELD_ON).toBe('2026-10-12');
    });
  });

  it('denies a viewer and a clerk', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      for (const role of ['viewer', 'clerk'] as const) {
        const userId = await addMember(tx, w.workspaceId, role);
        expect(
          await codeOf(
            recordManualOutcome(
              w.deps,
              { userId, workspaceId: w.workspaceId },
              { hearingId: w.hearingId, ...outcome, nextDate: { kind: 'none' } },
            ),
          ),
        ).toBe('FORBIDDEN');
      }
    });
  });
});
