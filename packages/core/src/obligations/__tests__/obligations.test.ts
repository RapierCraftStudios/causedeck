// The obligation service (#67) on the test database: creation guards, closure (service and direct
// SQL), reschedule versus miss, order reconciliation, defects, certified copies, the queue (and
// its p95 on the seeded dataset), roles, audit events, the proposal handler and the undo cascade.
import { schema, type Transaction } from '@causedeck/db';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import {
  buildAnchor,
  buildDocument,
  buildForum,
  buildMatter,
  buildOrder,
  buildProceeding,
} from '@causedeck/db/testing/matter-graph-fixtures';
import { seedObligationQueue } from '@causedeck/db/seed/obligation-fixtures';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { addMember, failure, newWorkspace, sqlState } from '../../__tests__/fixtures.ts';
import {
  applyForCertifiedCopy,
  closeObligation,
  createObligation,
  createObligationFromProposal,
  cureDefect,
  markDirectionNotApplicable,
  missedObligations,
  queryQueue,
  raiseDefect,
  reconcileOrder,
  reopenObligation,
  representFiling,
  allocateRegistryNumber,
  sendObligationReminders,
  transitionCertifiedCopy,
  updateObligation,
  countUnresolvedDirections,
} from '../index.ts';

const NOW = new Date('2026-11-10T06:00:00Z'); // 2026-11-10 11:30 IST, a Tuesday
const deps = (tx: Transaction) => ({ db: tx, now: () => NOW });
const manual = { sourceType: 'manual' as const };

async function memberId(tx: Transaction, workspaceId: string, userId: string): Promise<string> {
  const [row] = await inWorkspace(tx, workspaceId, (s) =>
    s
      .select({ id: schema.member.id })
      .from(schema.member)
      .where(and(eq(schema.member.organizationId, workspaceId), eq(schema.member.userId, userId))),
  );
  if (row === undefined) throw new Error('no member');
  return row.id;
}

async function world(tx: Transaction) {
  const { ownerId, workspaceId } = await newWorkspace(tx);
  const owner = { userId: ownerId, workspaceId };
  const ownerMemberId = await memberId(tx, workspaceId, ownerId);
  const forum = await inWorkspace(tx, workspaceId, (s) => buildForum(s, workspaceId));
  const matter = await inWorkspace(tx, workspaceId, (s) => buildMatter(s, workspaceId));
  const proceeding = await inWorkspace(tx, workspaceId, (s) =>
    buildProceeding(s, workspaceId, { matterId: matter.id, forumId: forum.id, state: 'sr_fr' }),
  );
  return {
    tx,
    workspaceId,
    owner,
    ownerMemberId,
    matterId: matter.id,
    forumId: forum.id,
    proceedingId: proceeding.id,
  };
}
type World = Awaited<ReturnType<typeof world>>;

const task = (w: World, extra: Record<string, unknown> = {}) => ({
  matterId: w.matterId,
  source: 'internal' as const,
  description: 'Call the registry',
  dueDate: '2026-11-12',
  ownerMemberId: w.ownerMemberId,
  provenance: manual,
  ...extra,
});

const auditCount = async (w: World, action: string) =>
  (
    await inWorkspace(w.tx, w.workspaceId, (s) =>
      s
        .select({ id: schema.auditEvent.id })
        .from(schema.auditEvent)
        .where(
          and(
            eq(schema.auditEvent.workspaceId, w.workspaceId),
            eq(schema.auditEvent.action, action),
          ),
        ),
    )
  ).length;

describe('createObligation', () => {
  it('writes the row, a created event and an audit event', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const row = await createObligation(deps(tx), w.owner, task(w));
      expect(row).toMatchObject({
        status: 'open',
        source: 'internal',
        confirmationState: 'confirmed',
      });
      const events = await inWorkspace(tx, w.workspaceId, (s) =>
        s.select().from(schema.obligationEvent),
      );
      expect(events.map((e) => e.kind)).toEqual(['created']);
      expect(await auditCount(w, 'obligation.created')).toBe(1);
    });
  });

  it('rejects missing provenance, a rule source and an undated non-task', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const noProv = createObligation(
        deps(tx),
        w.owner,
        task(w, { source: 'order_direction', provenance: { sourceType: 'document' } }),
      );
      await expect(noProv).rejects.toMatchObject({ code: 'VALIDATION' });
      await expect(
        createObligation(deps(tx), w.owner, task(w, { provenance: undefined })),
      ).rejects.toMatchObject({
        code: 'VALIDATION',
      });
      await expect(
        createObligation(deps(tx), w.owner, task(w, { source: 'rule' })),
      ).rejects.toMatchObject({
        code: 'VALIDATION',
      });
      await expect(
        createObligation(deps(tx), w.owner, task(w, { source: 'order_direction', dueDate: null })),
      ).rejects.toMatchObject({ code: 'VALIDATION' });
      const undated = await createObligation(deps(tx), w.owner, task(w, { dueDate: null }));
      expect(undated.dueDate).toBeNull();
    });
  });
});

describe('closure', () => {
  it('needs a reason type and words for not_applicable; reopen keeps the history', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const row = await createObligation(deps(tx), w.owner, task(w));
      await expect(
        closeObligation(deps(tx), w.owner, row.id, { reason: 'not_applicable' }),
      ).rejects.toMatchObject({ code: 'VALIDATION' });
      const closed = await closeObligation(deps(tx), w.owner, row.id, { reason: 'lawyer_action' });
      expect(closed).toMatchObject({ status: 'done', closedReasonType: 'lawyer_action' });
      await expect(
        closeObligation(deps(tx), w.owner, row.id, { reason: 'lawyer_action' }),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
      const reopened = await reopenObligation(deps(tx), w.owner, row.id, {
        reason: 'Listed again',
      });
      expect(reopened.status).toBe('open');
      const kinds = (
        await inWorkspace(tx, w.workspaceId, (s) => s.select().from(schema.obligationEvent))
      ).map((e) => e.kind);
      expect(kinds).toEqual(expect.arrayContaining(['created', 'closed', 'reopened']));
      expect(await auditCount(w, 'obligation.closed')).toBe(1);
    });
  });

  it('is enforced by the database: a direct update without a reason fails', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const row = await createObligation(deps(tx), w.owner, task(w));
      const direct = inWorkspace(tx, w.workspaceId, (s) =>
        s
          .update(schema.obligation)
          .set({ status: 'done', closedAt: NOW })
          .where(eq(schema.obligation.id, row.id)),
      );
      expect(sqlState(await failure(direct))).toBe('23514');
    });
  });
});

describe('reschedule versus miss', () => {
  it('needs a reason, is kept in obligation_event and is not counted as a miss', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const row = await createObligation(deps(tx), w.owner, task(w, { dueDate: '2026-11-05' }));
      await expect(
        updateObligation(deps(tx), w.owner, row.id, { dueDate: '2026-11-20' }),
      ).rejects.toMatchObject({ code: 'VALIDATION' });
      await updateObligation(deps(tx), w.owner, row.id, {
        dueDate: '2026-11-20',
        reason: 'Hearing adjourned',
      });
      const events = await inWorkspace(tx, w.workspaceId, (s) =>
        s
          .select()
          .from(schema.obligationEvent)
          .where(eq(schema.obligationEvent.kind, 'rescheduled')),
      );
      expect(events).toMatchObject([
        { fromValue: '2026-11-05', toValue: '2026-11-20', reason: 'Hearing adjourned' },
      ]);
      const missed = await createObligation(deps(tx), w.owner, task(w, { dueDate: '2026-11-01' }));
      expect(missed.status).toBe('open');
      const report = await missedObligations(deps(tx), w.owner, {
        from: '2026-10-01',
        to: '2026-11-30',
      });
      expect(report).toEqual({ missed: 1, rescheduled: 1 });
    });
  });
});

describe('reconcileOrder', () => {
  it('marks each direction and counts the unresolved ones', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const doc = await inWorkspace(tx, w.workspaceId, (s) => buildDocument(s, w.workspaceId));
      const [a1, a2] = await inWorkspace(tx, w.workspaceId, async (s) => {
        const first = await buildAnchor(s, w.workspaceId, { documentId: doc.id });
        const second = await buildAnchor(s, w.workspaceId, { documentId: doc.id });
        return [first, second] as const;
      });
      const ord = await inWorkspace(tx, w.workspaceId, (s) =>
        buildOrder(s, w.workspaceId, {
          proceedingId: w.proceedingId,
          documentId: doc.id,
          operativeDirections: [
            { text: 'File counter', anchorId: a1.id },
            { text: 'Serve notice', anchorId: a2.id },
          ],
        }),
      );
      const before = await reconcileOrder(deps(tx), w.owner, { orderId: ord.id });
      expect(before).toMatchObject({ reconciled: false, unresolvedCount: 2 });
      await createObligation(
        deps(tx),
        w.owner,
        task(w, {
          source: 'order_direction',
          sourceOrderId: ord.id,
          provenance: { sourceType: 'document', anchorId: a1.id },
        }),
      );
      const mid = await reconcileOrder(deps(tx), w.owner, { orderId: ord.id });
      expect(mid.directions.map((d) => d.state)).toEqual(['obligation', 'unresolved']);
      expect(await countUnresolvedDirections(deps(tx), w.owner, w.matterId)).toBe(1);
      await expect(
        markDirectionNotApplicable(deps(tx), w.owner, {
          orderId: ord.id,
          anchorId: a2.id,
          reason: ' ',
        }),
      ).rejects.toMatchObject({ code: 'VALIDATION' });
      const done = await markDirectionNotApplicable(deps(tx), w.owner, {
        orderId: ord.id,
        anchorId: a2.id,
        reason: 'Already served',
      });
      expect(done).toMatchObject({ reconciled: true, unresolvedCount: 0 });
      expect(done.directions[1]).toMatchObject({
        state: 'not_applicable',
        reason: 'Already served',
      });
    });
  });
});

describe('defects and registry numbers', () => {
  it('raise moves the proceeding to defects, cure closes the obligation, re-present follows', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const defect = await raiseDefect(deps(tx), w.owner, {
        proceedingId: w.proceedingId,
        description: 'Court fee short',
        raisedOn: '2026-11-10',
        cureBy: '2026-11-17',
        ownerMemberId: w.ownerMemberId,
        provenance: manual,
      });
      const state = async () =>
        (
          await inWorkspace(tx, w.workspaceId, (s) =>
            s.select().from(schema.proceeding).where(eq(schema.proceeding.id, w.proceedingId)),
          )
        )[0];
      expect((await state())?.state).toBe('defects');
      const [raised] = await inWorkspace(tx, w.workspaceId, (s) =>
        s.select().from(schema.obligation).where(eq(schema.obligation.id, defect.obligationId)),
      );
      expect(raised).toMatchObject({
        source: 'registry_defect',
        dueDate: '2026-11-17',
        status: 'open',
      });
      await cureDefect(deps(tx), w.owner, { defectId: defect.id, curedOn: '2026-11-12' });
      const [closed] = await inWorkspace(tx, w.workspaceId, (s) =>
        s.select().from(schema.obligation).where(eq(schema.obligation.id, defect.obligationId)),
      );
      expect(closed?.status).toBe('done');
      await representFiling(deps(tx), w.owner, {
        proceedingId: w.proceedingId,
        srNo: 'SR 1234/2026',
      });
      const after = await state();
      expect(after).toMatchObject({ state: 're_presented', srNo: 'SR 1234/2026' });
      await allocateRegistryNumber(deps(tx), w.owner, {
        proceedingId: w.proceedingId,
        frNo: 'FR 77/2026',
      });
      expect((await state())?.frNo).toBe('FR 77/2026');
    });
  });
});

describe('certified copies', () => {
  it('moves applied -> ready -> collected, dated and sourced, and appears in the queue', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const copy = await applyForCertifiedCopy(deps(tx), w.owner, {
        matterId: w.matterId,
        proceedingId: w.proceedingId,
        description: 'Certified copy of the order',
        appliedOn: '2026-11-10',
        followUpOn: '2026-11-12',
        ownerMemberId: w.ownerMemberId,
        provenance: manual,
      });
      const queue = await queryQueue(deps(tx), w.owner);
      expect(queue.this_week.map((o) => o.id)).toContain(copy.obligationId);
      await expect(
        transitionCertifiedCopy(deps(tx), w.owner, {
          certifiedCopyId: copy.id,
          to: 'collected',
          on: '2026-11-12',
          sourceRef: 'Registry slip 9',
        }),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
      const ready = await transitionCertifiedCopy(deps(tx), w.owner, {
        certifiedCopyId: copy.id,
        to: 'ready',
        on: '2026-11-12',
        sourceRef: 'Registry notice board',
      });
      expect(ready).toMatchObject({ status: 'ready', readyOn: '2026-11-12' });
      const collected = await transitionCertifiedCopy(deps(tx), w.owner, {
        certifiedCopyId: copy.id,
        to: 'collected',
        on: '2026-11-13',
        sourceRef: 'Registry slip 9',
      });
      expect(collected).toMatchObject({ status: 'collected', collectedOn: '2026-11-13' });
      const [row] = await inWorkspace(tx, w.workspaceId, (s) =>
        s.select().from(schema.obligation).where(eq(schema.obligation.id, copy.obligationId)),
      );
      expect(row?.status).toBe('done');
    });
  });
});

describe('queryQueue', () => {
  it('groups by due date, sorts overdue oldest first and filters', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const make = (description: string, dueDate: string | null) =>
        createObligation(deps(tx), w.owner, task(w, { description, dueDate }));
      await make('late', '2026-11-08');
      await make('later-late', '2026-11-01');
      await make('now', '2026-11-10');
      await make('soon', '2026-11-12');
      await make('far', '2026-12-30');
      await make('none', null);
      const q = await queryQueue(deps(tx), w.owner);
      expect(q.overdue.map((o) => o.description)).toEqual(['later-late', 'late']);
      expect(q.today.map((o) => o.description)).toEqual(['now']);
      expect(q.this_week.map((o) => o.description)).toEqual(['soon']);
      expect(q.later.map((o) => o.description)).toEqual(['far']);
      expect(q.undated.map((o) => o.description)).toEqual(['none']);
      const none = await queryQueue(deps(tx), w.owner, { source: 'order_direction' });
      expect(Object.values(none).flat()).toEqual([]);
    });
  });

  it('answers within 150 ms (p95) on the seeded dataset', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      await inWorkspace(tx, w.workspaceId, (s) =>
        seedObligationQueue(s, {
          workspaceId: w.workspaceId,
          matterId: w.matterId,
          ownerMemberId: w.ownerMemberId,
          today: '2026-11-10',
          count: 2000,
        }),
      );
      const times: number[] = [];
      for (let i = 0; i < 20; i++) {
        const start = performance.now();
        await queryQueue(deps(tx), w.owner, { limit: 50 });
        times.push(performance.now() - start);
      }
      times.sort((a, b) => a - b);
      expect(times[Math.ceil(times.length * 0.95) - 1]).toBeLessThan(150);
    });
  });
});

describe('roles', () => {
  it('viewer reads only; clerk tracks tasks but not order directions; junior sees assigned matters only', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const viewer = {
        userId: await addMember(tx, w.workspaceId, 'viewer'),
        workspaceId: w.workspaceId,
      };
      const clerk = {
        userId: await addMember(tx, w.workspaceId, 'clerk'),
        workspaceId: w.workspaceId,
      };
      const junior = {
        userId: await addMember(tx, w.workspaceId, 'junior'),
        workspaceId: w.workspaceId,
      };
      await expect(createObligation(deps(tx), viewer, task(w))).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      await createObligation(deps(tx), clerk, task(w));
      await expect(
        createObligation(
          deps(tx),
          clerk,
          task(w, {
            source: 'order_direction',
            provenance: { sourceType: 'document', sourceRef: 'x' },
          }),
        ),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect(Object.values(await queryQueue(deps(tx), viewer)).flat()).toHaveLength(1);
      expect(Object.values(await queryQueue(deps(tx), junior)).flat()).toHaveLength(0);
      await expect(createObligation(deps(tx), junior, task(w))).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });
  });
});

describe('proposal confirmation and undo', () => {
  it('creates through the guards, records the confirmer, and deleting cascades the history', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const row = await inWorkspace(tx, w.workspaceId, (s) =>
        createObligationFromProposal(
          s,
          w.owner,
          {
            matterId: w.matterId,
            source: 'order_direction',
            description: 'File counter',
            dueDate: '2026-11-20',
            provenance: {
              sourceType: 'ai',
              sourceRef: 'order.pdf#p1',
              confirmationState: 'confirmed',
            },
          },
          NOW,
        ),
      );
      expect(row.ownerMemberId).toBe(w.ownerMemberId);
      const [created] = await inWorkspace(tx, w.workspaceId, (s) =>
        s.select().from(schema.obligationEvent),
      );
      expect(created).toMatchObject({ kind: 'created', actorMemberId: w.ownerMemberId });
      await expect(
        inWorkspace(tx, w.workspaceId, (s) =>
          createObligationFromProposal(s, w.owner, {
            matterId: w.matterId,
            source: 'rule',
            description: 'Limitation',
            dueDate: '2026-11-20',
            provenance: manual,
          }),
        ),
      ).rejects.toMatchObject({ code: 'VALIDATION' });
      await inWorkspace(tx, w.workspaceId, (s) =>
        s.delete(schema.obligation).where(eq(schema.obligation.id, row.id)),
      );
      expect(
        await inWorkspace(tx, w.workspaceId, (s) => s.select().from(schema.obligationEvent)),
      ).toEqual([]);
    });
  });
});

describe('reminders', () => {
  it('notifies the owner once per local day, with counts only', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      await createObligation(deps(tx), w.owner, task(w, { dueDate: '2026-11-05' }));
      await createObligation(deps(tx), w.owner, task(w, { dueDate: '2026-11-11' }));
      await createObligation(deps(tx), w.owner, task(w, { dueDate: '2026-12-31' }));
      const first = await sendObligationReminders({ db: tx, now: () => NOW }, w.workspaceId);
      expect(first).toEqual({ notified: 1, alreadyReminded: 0 });
      const second = await sendObligationReminders({ db: tx, now: () => NOW }, w.workspaceId);
      expect(second).toEqual({ notified: 0, alreadyReminded: 1 });
      const rows = await inWorkspace(tx, w.workspaceId, (s) =>
        s.select().from(schema.notification),
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.body).toBe('1 overdue, 1 due within 2 days.');
    });
  });
});

describe('strategy descriptions (R16)', () => {
  it('hides a strategy description from a clerk; owner and advocate set the flag, nobody else', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const member = async (role: 'advocate' | 'clerk' | 'junior') => ({
        userId: await addMember(tx, w.workspaceId, role),
        workspaceId: w.workspaceId,
      });
      const advocate = await member('advocate');
      const clerk = await member('clerk');
      const junior = await member('junior');
      const secret = await createObligation(
        deps(tx),
        w.owner,
        task(w, { description: 'Settle at 40' }),
      );
      const plain = await createObligation(
        deps(tx),
        w.owner,
        task(w, { description: 'File vakalatnama' }),
      );
      const description = async (actor: typeof clerk, id: string) =>
        Object.values(await queryQueue(deps(tx), actor))
          .flat()
          .find((r) => r.id === id)?.description;

      await expect(
        updateObligation(deps(tx), clerk, secret.id, { strategy: true }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(
        updateObligation(deps(tx), junior, secret.id, { strategy: true }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await updateObligation(deps(tx), w.owner, secret.id, { strategy: true });
      expect(await description(w.owner, secret.id)).toBe('Settle at 40');
      expect(await description(advocate, secret.id)).toBe('Settle at 40');
      // The clerk still sees the task, but not the note; other descriptions are intact.
      expect(await description(clerk, secret.id)).toBe('');
      expect(await description(clerk, plain.id)).toBe('File vakalatnama');
      await updateObligation(deps(tx), advocate, secret.id, { strategy: false });
      expect(await description(clerk, secret.id)).toBe('Settle at 40');
      await updateObligation(deps(tx), advocate, secret.id, { strategy: true });

      // A clerk cannot edit a strategy obligation, but still tracks the others.
      await expect(
        updateObligation(deps(tx), clerk, secret.id, { basis: 'x' }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await updateObligation(deps(tx), clerk, plain.id, { basis: 'x' });
      await createObligation(deps(tx), clerk, task(w));
    });
  });
});
