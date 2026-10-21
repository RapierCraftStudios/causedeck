// The proceeding state machine on the test database (#363, ADR 0016): numbering keeps the SR, FR
// and diary numbers, a cure deadline rides on the defects event, every transition stamps
// `state_changed_at`, appends one history row and emits `proceeding.state_changed`, a state change
// is never `proposed`, and a disallowed pair, a viewer or another workspace's proceeding writes
// and emits nothing.
import { schema, type Transaction } from '@causedeck/db';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { buildForum } from '@causedeck/db/testing/matter-graph-fixtures';
import { and, asc, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import {
  createMatter,
  createProceeding,
  InvalidTransitionError,
  transitionProceeding,
  WorkspaceError,
  type GraphEvent,
  type MatterGraphDeps,
} from '../../index.ts';
import { addMember, newWorkspace } from '../../__tests__/fixtures.ts';

const MANUAL = { sourceType: 'manual' } as const;

interface World {
  tx: Transaction;
  workspaceId: string;
  ownerId: string;
  forumId: string;
  events: GraphEvent[];
  deps: MatterGraphDeps;
  owner: { userId: string; workspaceId: string };
}

async function world(tx: Transaction): Promise<World> {
  const { ownerId, workspaceId } = await newWorkspace(tx);
  const forum = await inWorkspace(tx, workspaceId, (s) => buildForum(s, workspaceId));
  const events: GraphEvent[] = [];
  return {
    tx,
    workspaceId,
    ownerId,
    forumId: forum.id,
    events,
    deps: { db: tx, events: { emit: (e) => events.push(e) } },
    owner: { userId: ownerId, workspaceId },
  };
}

/** A proceeding in `filed` with SR, FR and diary numbers, in a (sensitive) matter. */
async function filed(w: World, sensitive = false) {
  const m = await createMatter(w.deps, w.owner, { title: 'Fictional v. State', sensitive });
  const p = await createProceeding(w.deps, w.owner, {
    matterId: m.id,
    forumId: w.forumId,
    caseType: 'W.P.',
    srNo: 'SR 41',
    frNo: 'FR 7',
    diaryNo: 'D-2024-99',
    provenance: MANUAL,
  });
  w.events.length = 0;
  return { matterId: m.id, proceedingId: p.id };
}

async function history(w: World, proceedingId: string) {
  return inWorkspace(w.tx, w.workspaceId, (s) =>
    s
      .select()
      .from(schema.proceedingStateChange)
      .where(
        and(
          eq(schema.proceedingStateChange.workspaceId, w.workspaceId),
          eq(schema.proceedingStateChange.proceedingId, proceedingId),
        ),
      )
      .orderBy(asc(schema.proceedingStateChange.changedAt), asc(schema.proceedingStateChange.id)),
  );
}

async function proceedingRow(w: World, proceedingId: string) {
  const [row] = await inWorkspace(w.tx, w.workspaceId, (s) =>
    s.select().from(schema.proceeding).where(eq(schema.proceeding.id, proceedingId)),
  );
  if (!row) throw new Error('proceeding not found');
  return row;
}

async function errorOf(promise: Promise<unknown>): Promise<WorkspaceError> {
  const error: unknown = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(WorkspaceError);
  return error as WorkspaceError;
}

describe('transitionProceeding', () => {
  it('walks filed -> sr_fr -> defects -> re_presented -> numbered -> disposed with history and events', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const { matterId, proceedingId } = await filed(w, true);
      const before = await proceedingRow(w, proceedingId);

      const first = await transitionProceeding(w.deps, w.owner, { proceedingId, to: 'sr_fr' });
      expect(first.proceeding.state).toBe('sr_fr');
      expect(first.proceeding.stateChangedAt.getTime()).toBeGreaterThanOrEqual(
        before.stateChangedAt.getTime(),
      );
      expect(first.stateChange).toMatchObject({
        fromState: 'filed',
        toState: 'sr_fr',
        reason: null,
        cureDeadline: null,
        sourceType: 'manual',
        confirmationState: 'confirmed',
      });
      expect(first.stateChange.changedAt).toEqual(first.proceeding.stateChangedAt);

      const defects = await transitionProceeding(w.deps, w.owner, {
        proceedingId,
        to: 'defects',
        reason: 'Registry returned with objections',
        cureDeadline: '2026-11-02',
      });
      expect(defects.stateChange.cureDeadline).toBe('2026-11-02');
      await transitionProceeding(w.deps, w.owner, { proceedingId, to: 're_presented' });
      const numbered = await transitionProceeding(w.deps, w.owner, {
        proceedingId,
        to: 'numbered',
        number: '0123',
        year: 24,
      });
      expect(numbered.proceeding).toMatchObject({
        state: 'numbered',
        number: '123',
        year: 2024,
        // History is not erased: the pre-numbering identifiers stay.
        srNo: 'SR 41',
        frNo: 'FR 7',
        diaryNo: 'D-2024-99',
      });
      await transitionProceeding(w.deps, w.owner, { proceedingId, to: 'disposed' });

      const rows = await history(w, proceedingId);
      expect(rows.map((r) => `${r.fromState}->${r.toState}`)).toEqual([
        'filed->sr_fr',
        'sr_fr->defects',
        'defects->re_presented',
        're_presented->numbered',
        'numbered->disposed',
      ]);
      const ownerMember = rows[0]?.actorMemberId;
      expect(ownerMember).toEqual(expect.any(String));
      expect(rows.every((r) => r.actorMemberId === ownerMember)).toBe(true);

      expect(w.events).toHaveLength(5);
      expect(w.events.every((e) => e.type === 'proceeding.state_changed')).toBe(true);
      expect(w.events[1]).toEqual({
        type: 'proceeding.state_changed',
        workspaceId: w.workspaceId,
        actorUserId: w.ownerId,
        matterId,
        sensitive: true,
        proceedingId,
        stateChangeId: defects.stateChange.id,
        from: 'sr_fr',
        to: 'defects',
        reason: 'Registry returned with objections',
        actor: { userId: w.ownerId, memberId: ownerMember },
        provenance: {
          sourceType: 'manual',
          sourceRef: null,
          anchorId: null,
          confidence: null,
          confirmationState: 'confirmed',
        },
        cureDeadline: '2026-11-02',
      });
      expect(w.events[0]).not.toHaveProperty('cureDeadline');
    });
  });

  it('reopens a disposed proceeding only with a reason, and needs the number and year again', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const { proceedingId } = await filed(w);
      await transitionProceeding(w.deps, w.owner, { proceedingId, to: 'sr_fr' });
      await transitionProceeding(w.deps, w.owner, {
        proceedingId,
        to: 'numbered',
        number: '55',
        year: 2025,
      });
      await transitionProceeding(w.deps, w.owner, { proceedingId, to: 'disposed' });
      w.events.length = 0;

      const noReason = await errorOf(
        transitionProceeding(w.deps, w.owner, {
          proceedingId,
          to: 'numbered',
          number: '55',
          year: 2025,
        }),
      );
      expect(noReason).toBeInstanceOf(InvalidTransitionError);
      expect(noReason.code).toBe('CONFLICT');
      expect(
        (await errorOf(transitionProceeding(w.deps, w.owner, { proceedingId, to: 'numbered' })))
          .code,
      ).toBe('VALIDATION');

      const reopened = await transitionProceeding(w.deps, w.owner, {
        proceedingId,
        to: 'numbered',
        number: '55',
        year: 2025,
        reason: 'Restored on review petition',
      });
      expect(reopened.stateChange).toMatchObject({
        fromState: 'disposed',
        toState: 'numbered',
        reason: 'Restored on review petition',
      });
      expect(w.events).toHaveLength(1);
    });
  });

  it('refuses a disallowed pair, a proposed change and misplaced fields without writing or emitting', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const { proceedingId } = await filed(w);
      const before = await proceedingRow(w, proceedingId);

      for (const to of ['filed', 'defects', 're_presented', 'disposed'] as const) {
        const error = await errorOf(transitionProceeding(w.deps, w.owner, { proceedingId, to }));
        expect(error, to).toBeInstanceOf(InvalidTransitionError);
      }
      // filed -> numbered is not in the table, even with a number and a year.
      expect(
        await errorOf(
          transitionProceeding(w.deps, w.owner, {
            proceedingId,
            to: 'numbered',
            number: '1',
            year: 2024,
          }),
        ),
      ).toBeInstanceOf(InvalidTransitionError);
      expect(
        (
          await errorOf(
            transitionProceeding(w.deps, w.owner, {
              proceedingId,
              to: 'sr_fr',
              provenance: { ...MANUAL, confirmationState: 'proposed' },
            }),
          )
        ).code,
      ).toBe('VALIDATION');
      expect(
        (
          await errorOf(
            transitionProceeding(w.deps, w.owner, {
              proceedingId,
              to: 'sr_fr',
              cureDeadline: '2026-11-02',
            }),
          )
        ).code,
      ).toBe('VALIDATION');

      expect(await proceedingRow(w, proceedingId)).toEqual(before);
      expect(await history(w, proceedingId)).toEqual([]);
      expect(w.events).toEqual([]);
    });
  });

  it('records the caller-given provenance (an adapter fact, corrected by the lawyer)', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const { proceedingId } = await filed(w);
      const { stateChange } = await transitionProceeding(w.deps, w.owner, {
        proceedingId,
        to: 'sr_fr',
        provenance: {
          sourceType: 'adapter',
          sourceRef: 'status:SR41',
          confidence: '0.9',
          confirmationState: 'corrected',
        },
      });
      expect(stateChange).toMatchObject({
        sourceType: 'adapter',
        sourceRef: 'status:SR41',
        confidence: '0.900',
        confirmationState: 'corrected',
      });
    });
  });

  it('is CONFLICT when numbering would duplicate an existing case number', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const a = await filed(w);
      const b = await filed(w);
      for (const { proceedingId } of [a, b]) {
        await transitionProceeding(w.deps, w.owner, { proceedingId, to: 'sr_fr' });
      }
      await transitionProceeding(w.deps, w.owner, {
        proceedingId: a.proceedingId,
        to: 'numbered',
        number: '9',
        year: 2024,
      });
      const error = await errorOf(
        transitionProceeding(w.deps, w.owner, {
          proceedingId: b.proceedingId,
          to: 'numbered',
          number: '0009',
          year: 24,
        }),
      );
      expect(error.code).toBe('CONFLICT');
      expect(error).not.toBeInstanceOf(InvalidTransitionError);
    });
  });

  it('is FORBIDDEN for a viewer and NOT_FOUND for another workspace or an unknown id', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const { proceedingId } = await filed(w);
      const viewer = await addMember(tx, w.workspaceId, 'viewer');
      expect(
        (
          await errorOf(
            transitionProceeding(
              w.deps,
              { userId: viewer, workspaceId: w.workspaceId },
              { proceedingId, to: 'sr_fr' },
            ),
          )
        ).code,
      ).toBe('FORBIDDEN');

      const other = await world(tx);
      expect(
        (
          await errorOf(
            transitionProceeding(other.deps, other.owner, { proceedingId, to: 'sr_fr' }),
          )
        ).code,
      ).toBe('NOT_FOUND');
      expect(
        (
          await errorOf(
            transitionProceeding(w.deps, w.owner, {
              proceedingId: '00000000-0000-4000-8000-000000000000',
              to: 'sr_fr',
            }),
          )
        ).code,
      ).toBe('NOT_FOUND');
      expect((await proceedingRow(w, proceedingId)).state).toBe('filed');
      expect(w.events).toEqual([]);
      expect(other.events).toEqual([]);
    });
  });
});
