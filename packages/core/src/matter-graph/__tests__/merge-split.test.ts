// Matter-graph merges and splits (#365, part 4 of #33) on the test database: what each moves, the
// refusals (sensitivity, restriction, merged or archived, another workspace, disagreeing sources),
// the crossing links a split reports, the identifier attribution of a proceeding merge, and undo
// round trips that compare a whole-graph snapshot before the operation and after its undo.
import { randomUUID } from 'node:crypto';

import { schema, withWorkspace, type Transaction } from '@causedeck/db';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import {
  buildDocument,
  buildForum,
  buildHearing,
  buildListing,
  buildMatter,
  buildObligation,
  buildOrder,
  buildPerson,
  buildProceeding,
  buildProceedingLink,
  buildRoleEdge,
  buildTask,
} from '@causedeck/db/testing/matter-graph-fixtures';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import {
  CrossWorkspaceError,
  mergeMatters,
  mergeProceedings,
  restrictMatter,
  splitMatter,
  undoMerge,
  undoMergeProceedings,
  undoSplit,
  WorkspaceError,
  type GraphEvent,
  type MatterGraphDeps,
} from '../../index.ts';
import { addMember, newWorkspace } from '../../__tests__/fixtures.ts';

interface World {
  tx: Transaction;
  workspaceId: string;
  ownerId: string;
  forumId: string;
  events: GraphEvent[];
  deps: MatterGraphDeps;
  owner: { userId: string; workspaceId: string };
  in: <T>(fn: (s: Transaction) => Promise<T>) => Promise<T>;
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
    in: (fn) => inWorkspace(tx, workspaceId, fn),
  };
}

/** Every graph row of the workspace, ordered by id. */
async function snapshot(w: World) {
  return w.in(async (s) => {
    return {
      matters: await s.select().from(schema.matter).orderBy(schema.matter.id),
      restrictions: await s
        .select()
        .from(schema.matterRestriction)
        .orderBy(schema.matterRestriction.id),
      proceedings: await s.select().from(schema.proceeding).orderBy(schema.proceeding.id),
      links: await s.select().from(schema.proceedingLink).orderBy(schema.proceedingLink.id),
      documents: await s.select().from(schema.document).orderBy(schema.document.id),
      roleEdges: await s.select().from(schema.roleEdge).orderBy(schema.roleEdge.id),
      listings: await s.select().from(schema.listing).orderBy(schema.listing.id),
      hearings: await s.select().from(schema.hearing).orderBy(schema.hearing.id),
      orders: await s.select().from(schema.order).orderBy(schema.order.id),
      obligations: await s.select().from(schema.obligation).orderBy(schema.obligation.id),
      tasks: await s.select().from(schema.task).orderBy(schema.task.id),
    };
  });
}

/** A matter with one proceeding carrying a listing (+ hearing), order, obligation and task. */
async function seedMatter(w: World, overrides: { sensitive?: boolean; number?: string } = {}) {
  return w.in(async (s) => {
    const m = await buildMatter(s, w.workspaceId, { sensitive: overrides.sensitive ?? false });
    const p = await buildProceeding(s, w.workspaceId, {
      matterId: m.id,
      forumId: w.forumId,
      number: overrides.number ?? String(Math.floor(Math.random() * 1e6)),
      year: 2026,
    });
    const doc = await buildDocument(s, w.workspaceId, { matterId: m.id });
    const l = await buildListing(s, w.workspaceId, { proceedingId: p.id, canonical: true });
    await buildHearing(s, w.workspaceId, { listingId: l.id });
    const o = await buildOrder(s, w.workspaceId, { proceedingId: p.id, documentId: doc.id });
    const ob = await buildObligation(s, w.workspaceId, { matterId: m.id, proceedingId: p.id });
    const t = await buildTask(s, w.workspaceId, { matterId: m.id, proceedingId: p.id });
    const person = await buildPerson(s, w.workspaceId);
    const edge = await buildRoleEdge(s, w.workspaceId, {
      fromPersonId: person.id,
      kind: 'instructed_by',
      matterId: m.id,
    });
    return {
      matterId: m.id,
      proceedingId: p.id,
      documentId: doc.id,
      listingId: l.id,
      orderId: o.id,
      obligationId: ob.id,
      taskId: t.id,
      edgeId: edge.id,
    };
  });
}

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  const error: unknown = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  if (error === undefined) return undefined;
  expect(error).toBeInstanceOf(WorkspaceError);
  return (error as WorkspaceError).code;
}

describe('mergeMatters and undoMerge', () => {
  it('moves every row of the source, marks it merged, and undo restores the graph exactly', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const into = await seedMatter(w);
      const from = await seedMatter(w);
      // A matter merged into the source earlier, and a link across the two matters.
      const earlier = await w.in((s) =>
        buildMatter(s, w.workspaceId, { mergedIntoMatterId: from.matterId }),
      );
      const link = await w.in((s) =>
        buildProceedingLink(s, w.workspaceId, {
          fromProceedingId: into.proceedingId,
          toProceedingId: from.proceedingId,
          kind: 'connected',
        }),
      );
      const before = await snapshot(w);

      const result = await mergeMatters(w.deps, w.owner, {
        intoMatterId: into.matterId,
        fromMatterId: from.matterId,
      });
      expect(result.from.mergedIntoMatterId).toBe(into.matterId);
      expect(result.moved).toMatchObject({
        proceedingIds: [from.proceedingId],
        documentIds: [from.documentId],
        roleEdgeIds: [from.edgeId],
        obligationIds: [from.obligationId],
        taskIds: [from.taskId],
        mergedMatterIds: [earlier.id],
        linkIds: [link.id],
      });
      const after = await snapshot(w);
      const onInto = (rows: { id: string; matterId: string | null }[], id: string) =>
        rows.find((r) => r.id === id)?.matterId;
      expect(onInto(after.proceedings, from.proceedingId)).toBe(into.matterId);
      expect(onInto(after.documents, from.documentId)).toBe(into.matterId);
      expect(onInto(after.roleEdges, from.edgeId)).toBe(into.matterId);
      expect(onInto(after.obligations, from.obligationId)).toBe(into.matterId);
      expect(onInto(after.tasks, from.taskId)).toBe(into.matterId);
      expect(after.matters.find((m) => m.id === earlier.id)?.mergedIntoMatterId).toBe(
        into.matterId,
      );
      expect(after.links).toEqual(before.links);
      expect(w.events).toEqual([
        expect.objectContaining({
          type: 'matter.merged',
          matterId: into.matterId,
          fromMatterId: from.matterId,
          sensitive: false,
          documentIds: [from.documentId],
        }),
      ]);

      // The payload survives storage as JSON.
      const payload: unknown = JSON.parse(JSON.stringify(result.undo));
      await undoMerge(w.deps, w.owner, { payload: payload as typeof result.undo });
      expect(await snapshot(w)).toEqual(before);
      expect(w.events.at(-1)).toMatchObject({ type: 'matter.merge_undone' });
    });
  });

  it('emits sensitive: true for documents moved into a sensitive matter', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const into = await seedMatter(w, { sensitive: true });
      const from = await seedMatter(w, { sensitive: true });
      await mergeMatters(w.deps, w.owner, {
        intoMatterId: into.matterId,
        fromMatterId: from.matterId,
      });
      expect(w.events).toEqual([
        expect.objectContaining({
          type: 'matter.merged',
          sensitive: true,
          documentIds: [from.documentId],
        }),
      ]);
    });
  });

  it('refuses mixed sensitivity, differing restrictions, merged or archived matters', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const plain = await seedMatter(w);
      const sensitive = await seedMatter(w, { sensitive: true });
      const restricted = await seedMatter(w);
      await restrictMatter(tx, w.owner, { matterId: restricted.matterId, allowedUserIds: [] });
      const before = await snapshot(w);
      const merge = (intoMatterId: string, fromMatterId: string) =>
        codeOf(mergeMatters(w.deps, w.owner, { intoMatterId, fromMatterId }));
      expect(await merge(plain.matterId, sensitive.matterId)).toBe('CONFLICT');
      expect(await merge(sensitive.matterId, plain.matterId)).toBe('CONFLICT');
      expect(await merge(plain.matterId, restricted.matterId)).toBe('CONFLICT');
      expect(await merge(restricted.matterId, plain.matterId)).toBe('CONFLICT');
      expect(await snapshot(w)).toEqual(before);
      expect(w.events).toEqual([]);

      const archived = await seedMatter(w);
      await w.in((s) =>
        s
          .update(schema.matter)
          .set({ status: 'archived' })
          .where(eq(schema.matter.id, archived.matterId)),
      );
      expect(await merge(plain.matterId, archived.matterId)).toBe('CONFLICT');
      const other = await seedMatter(w);
      await mergeMatters(w.deps, w.owner, {
        intoMatterId: plain.matterId,
        fromMatterId: other.matterId,
      });
      expect(await merge(plain.matterId, other.matterId)).toBe('CONFLICT');
      expect(await merge(other.matterId, plain.matterId)).toBe('CONFLICT');
      expect(
        await codeOf(
          mergeMatters(w.deps, w.owner, {
            intoMatterId: plain.matterId,
            fromMatterId: plain.matterId,
          }),
        ),
      ).toBe('VALIDATION');
    });
  });

  it('refuses a viewer, and a merge naming a matter of another workspace with a typed error', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const v = await world(tx);
      const mine = await seedMatter(w);
      const theirs = await seedMatter(v);
      const viewer = await addMember(tx, w.workspaceId, 'viewer');
      const second = await seedMatter(w);
      expect(
        await codeOf(
          mergeMatters(
            w.deps,
            { userId: viewer, workspaceId: w.workspaceId },
            { intoMatterId: mine.matterId, fromMatterId: second.matterId },
          ),
        ),
      ).toBe('FORBIDDEN');
      const theirsBefore = await snapshot(v);
      for (const [intoMatterId, fromMatterId] of [
        [mine.matterId, theirs.matterId],
        [theirs.matterId, mine.matterId],
      ] as const) {
        await expect(
          mergeMatters(w.deps, w.owner, { intoMatterId, fromMatterId }),
        ).rejects.toBeInstanceOf(CrossWorkspaceError);
      }
      // From inside the other workspace's scope.
      await expect(
        withWorkspace(tx, { workspaceId: v.workspaceId }, (s) =>
          mergeMatters({ ...w.deps, db: s }, w.owner, {
            intoMatterId: mine.matterId,
            fromMatterId: second.matterId,
          }),
        ),
      ).rejects.toBeInstanceOf(CrossWorkspaceError);
      expect(await snapshot(v)).toEqual(theirsBefore);
      expect(w.events).toEqual([]);
    });
  });

  it('refuses an undo once a moved row has moved again', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const into = await seedMatter(w);
      const from = await seedMatter(w);
      const elsewhere = await seedMatter(w);
      const { undo } = await mergeMatters(w.deps, w.owner, {
        intoMatterId: into.matterId,
        fromMatterId: from.matterId,
      });
      await w.in((s) =>
        s
          .update(schema.document)
          .set({ matterId: elsewhere.matterId })
          .where(eq(schema.document.id, from.documentId)),
      );
      expect(await codeOf(undoMerge(w.deps, w.owner, { payload: undo }))).toBe('CONFLICT');
      expect(
        await codeOf(
          undoMerge(w.deps, w.owner, {
            payload: { ...undo, op: 'matter.split' } as unknown as typeof undo,
          }),
        ),
      ).toBe('VALIDATION');
    });
  });
});

describe('splitMatter and undoSplit', () => {
  it('moves the selected proceedings with their docket, reports crossing links, and undo restores', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const m = await seedMatter(w);
      await restrictMatter(tx, w.owner, { matterId: m.matterId, allowedUserIds: [w.ownerId] });
      const ids = await w.in(async (s) => {
        const child = await buildProceeding(s, w.workspaceId, {
          matterId: m.matterId,
          forumId: w.forumId,
          caseTypeCode: 'WMP',
          number: '11570',
          year: 2026,
          parentProceedingId: m.proceedingId,
        });
        const parentOf = await buildProceedingLink(s, w.workspaceId, {
          fromProceedingId: m.proceedingId,
          toProceedingId: child.id,
          kind: 'parent_of',
        });
        const sibling = await buildProceeding(s, w.workspaceId, {
          matterId: m.matterId,
          forumId: w.forumId,
          caseTypeCode: 'WA',
          number: '2101',
          year: 2026,
        });
        const connected = await buildProceedingLink(s, w.workspaceId, {
          fromProceedingId: sibling.id,
          toProceedingId: m.proceedingId,
          kind: 'connected',
        });
        const l = await buildListing(s, w.workspaceId, { proceedingId: child.id, canonical: true });
        const ob = await buildObligation(s, w.workspaceId, {
          matterId: m.matterId,
          proceedingId: child.id,
        });
        return { child: child.id, sibling: sibling.id, parentOf, connected, listing: l.id, ob };
      });
      const before = await snapshot(w);

      const result = await splitMatter(w.deps, w.owner, {
        matterId: m.matterId,
        proceedingIds: [ids.child, ids.sibling],
        newTitle: 'Split matter',
      });
      expect(result.matter).toMatchObject({ title: 'Split matter', sensitive: false });
      expect(result.moved.proceedingIds.sort()).toEqual([ids.child, ids.sibling].sort());
      expect(result.moved.obligationIds).toEqual([ids.ob.id]);
      expect(result.crossing).toEqual(
        expect.arrayContaining([
          {
            linkId: ids.parentOf.id,
            kind: 'parent_of',
            fromProceedingId: m.proceedingId,
            toProceedingId: ids.child,
          },
          {
            linkId: ids.connected.id,
            kind: 'connected',
            fromProceedingId: ids.sibling,
            toProceedingId: m.proceedingId,
          },
          {
            linkId: null,
            kind: 'parent_proceeding',
            fromProceedingId: m.proceedingId,
            toProceedingId: ids.child,
          },
        ]),
      );
      expect(result.crossing).toHaveLength(3);
      const after = await snapshot(w);
      expect(after.links).toEqual(before.links);
      expect(after.proceedings.find((p) => p.id === ids.child)).toMatchObject({
        matterId: result.matter.id,
        parentProceedingId: m.proceedingId,
      });
      // The listing follows its proceeding; the restriction is copied.
      expect(after.listings.find((l) => l.id === ids.listing)?.proceedingId).toBe(ids.child);
      expect(after.restrictions.find((r) => r.matterId === result.matter.id)).toMatchObject({
        allowedUserIds: [w.ownerId],
      });
      expect(w.events).toEqual([
        expect.objectContaining({ type: 'matter.split', newMatterId: result.matter.id }),
      ]);

      await undoSplit(w.deps, w.owner, { payload: result.undo });
      expect(await snapshot(w)).toEqual(before);
    });
  });

  it('refuses proceedings of another matter or workspace, and an undo once the new matter grew', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const v = await world(tx);
      const m = await seedMatter(w);
      const other = await seedMatter(w);
      const theirs = await seedMatter(v);
      const split = (proceedingIds: string[]) =>
        splitMatter(w.deps, w.owner, { matterId: m.matterId, proceedingIds, newTitle: 'X' });
      expect(await codeOf(split([other.proceedingId]))).toBe('VALIDATION');
      await expect(split([theirs.proceedingId])).rejects.toBeInstanceOf(CrossWorkspaceError);
      expect(await codeOf(split([]))).toBe('VALIDATION');

      const { matter, undo } = await split([m.proceedingId]);
      await w.in((s) => buildDocument(s, w.workspaceId, { matterId: matter.id }));
      expect(await codeOf(undoSplit(w.deps, w.owner, { payload: undo }))).toBe('CONFLICT');
    });
  });
});

describe('mergeProceedings and undoMergeProceedings', () => {
  const CNR = 'TNCH010012342026';

  async function pair(w: World, theirs: { listDate?: string; srNo?: string } = {}) {
    const m = await seedMatter(w, { number: '10234' });
    return w.in(async (s) => {
      await s
        .update(schema.proceeding)
        .set({ srNo: 'SR 1' })
        .where(eq(schema.proceeding.id, m.proceedingId));
      // The same W.P. imported again without normalisation (`W-P`, `010234`, so the identity index
      // let it in), from the court's site: a CNR and a diary number are new.
      const dup = await buildProceeding(s, w.workspaceId, {
        matterId: m.matterId,
        forumId: w.forumId,
        caseTypeCode: 'W-P',
        caseTypeRaw: 'W-P',
        number: '010234',
        year: 2026,
        cnr: CNR,
        diaryNo: 'D 77',
        srNo: theirs.srNo ?? null,
        sourceType: 'adapter',
        sourceRef: 'ecourts:case/1',
      });
      const l = await buildListing(s, w.workspaceId, {
        proceedingId: dup.id,
        canonical: true,
        ...(theirs.listDate === undefined ? {} : { listDate: theirs.listDate }),
      });
      const doc = await buildDocument(s, w.workspaceId, { matterId: m.matterId });
      const o = await buildOrder(s, w.workspaceId, { proceedingId: dup.id, documentId: doc.id });
      const ob = await buildObligation(s, w.workspaceId, {
        matterId: m.matterId,
        proceedingId: dup.id,
      });
      const t = await buildTask(s, w.workspaceId, { proceedingId: dup.id });
      const person = await buildPerson(s, w.workspaceId);
      const edge = await buildRoleEdge(s, w.workspaceId, {
        fromPersonId: person.id,
        kind: 'appears_for',
        proceedingId: dup.id,
      });
      const child = await buildProceeding(s, w.workspaceId, {
        matterId: m.matterId,
        forumId: w.forumId,
        caseTypeCode: 'WMP',
        number: '11570',
        year: 2026,
        parentProceedingId: dup.id,
      });
      const appeal = await buildProceeding(s, w.workspaceId, {
        matterId: m.matterId,
        forumId: w.forumId,
        caseTypeCode: 'WA',
        number: '2101',
        year: 2026,
      });
      const self = await buildProceedingLink(s, w.workspaceId, {
        fromProceedingId: m.proceedingId,
        toProceedingId: dup.id,
        kind: 'connected',
      });
      const duplicate = await buildProceedingLink(s, w.workspaceId, {
        fromProceedingId: appeal.id,
        toProceedingId: dup.id,
        kind: 'appeal_from',
      });
      await buildProceedingLink(s, w.workspaceId, {
        fromProceedingId: appeal.id,
        toProceedingId: m.proceedingId,
        kind: 'appeal_from',
      });
      const repointed = await buildProceedingLink(s, w.workspaceId, {
        fromProceedingId: dup.id,
        toProceedingId: child.id,
        kind: 'parent_of',
      });
      return {
        ...m,
        dup: dup.id,
        dupListing: l.id,
        dupOrder: o.id,
        dupObligation: ob.id,
        dupTask: t.id,
        dupEdge: edge.id,
        child: child.id,
        links: { self: self.id, duplicate: duplicate.id, repointed: repointed.id },
      };
    });
  }

  it('keeps the union of identifiers with their sources, re-points the docket, and undo restores', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const g = await pair(w);
      const before = await snapshot(w);

      const result = await mergeProceedings(w.deps, w.owner, {
        intoProceedingId: g.proceedingId,
        fromProceedingId: g.dup,
      });
      expect(result.proceeding).toMatchObject({
        id: g.proceedingId,
        caseTypeCode: 'WP',
        number: '10234',
        cnr: CNR,
        srNo: 'SR 1',
        diaryNo: 'D 77',
      });
      expect(result.identifierSources).toMatchObject({
        cnr: { proceedingId: g.dup, sourceType: 'adapter', sourceRef: 'ecourts:case/1' },
        diaryNo: { proceedingId: g.dup, sourceType: 'adapter' },
        srNo: { proceedingId: g.proceedingId, sourceType: 'manual', sourceRef: null },
        number: { proceedingId: g.proceedingId },
      });
      expect(result.undo.after.identifierSources).toEqual(result.identifierSources);
      expect(w.events).toEqual([
        expect.objectContaining({
          type: 'proceeding.merged',
          proceedingId: g.proceedingId,
          fromProceedingId: g.dup,
          identifierSources: result.identifierSources,
          sensitive: false,
        }),
      ]);
      expect(result.moved.deletedLinkIds.sort()).toEqual([g.links.self, g.links.duplicate].sort());
      expect(result.moved.linkIds).toEqual([g.links.repointed]);
      expect(result.moved.demotedListingId).toBe(g.dupListing);

      const after = await snapshot(w);
      expect(after.proceedings.some((p) => p.id === g.dup)).toBe(false);
      for (const rows of [after.listings, after.orders, after.obligations, after.tasks]) {
        expect(rows.filter((r) => r.proceedingId === g.dup)).toEqual([]);
      }
      expect(after.listings.find((l) => l.id === g.dupListing)?.proceedingId).toBe(g.proceedingId);
      expect(after.orders.find((o) => o.id === g.dupOrder)?.proceedingId).toBe(g.proceedingId);
      expect(after.obligations.find((o) => o.id === g.dupObligation)?.proceedingId).toBe(
        g.proceedingId,
      );
      expect(after.roleEdges.find((e) => e.id === g.dupEdge)?.proceedingId).toBe(g.proceedingId);
      expect(after.proceedings.find((p) => p.id === g.child)?.parentProceedingId).toBe(
        g.proceedingId,
      );
      expect(
        after.listings.filter((l) => l.proceedingId === g.proceedingId && l.canonical),
      ).toHaveLength(1);

      // A stored payload is input: it cannot send an obligation to a matter the merge never touched.
      const tampered = structuredClone(result.undo);
      for (const r of tampered.before.rows.obligation) r.matterId = randomUUID();
      expect(await codeOf(undoMergeProceedings(w.deps, w.owner, { payload: tampered }))).toBe(
        'VALIDATION',
      );
      await undoMergeProceedings(w.deps, w.owner, {
        payload: JSON.parse(JSON.stringify(result.undo)) as typeof result.undo,
      });
      expect(await snapshot(w)).toEqual(before);
      expect(w.events.at(-1)).toMatchObject({ type: 'proceeding.merge_undone' });
    });
  });

  it('refuses disagreeing identifiers or next dates, and proceedings of another workspace', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const g = await pair(w, { srNo: 'SR 2' });
      const before = await snapshot(w);
      expect(
        await codeOf(
          mergeProceedings(w.deps, w.owner, {
            intoProceedingId: g.proceedingId,
            fromProceedingId: g.dup,
          }),
        ),
      ).toBe('CONFLICT');
      expect(await snapshot(w)).toEqual(before);

      const h = await world(tx);
      const k = await pair(h, { listDate: '2026-12-01' });
      expect(
        await codeOf(
          mergeProceedings(h.deps, h.owner, {
            intoProceedingId: k.proceedingId,
            fromProceedingId: k.dup,
          }),
        ),
      ).toBe('CONFLICT');
      expect(
        await codeOf(
          mergeProceedings(h.deps, h.owner, {
            intoProceedingId: k.proceedingId,
            fromProceedingId: k.child,
          }),
        ),
      ).toBe('VALIDATION');
      await expect(
        mergeProceedings(w.deps, w.owner, {
          intoProceedingId: g.proceedingId,
          fromProceedingId: k.dup,
        }),
      ).rejects.toBeInstanceOf(CrossWorkspaceError);
      const [stillThere] = await inWorkspace(tx, h.workspaceId, (s) =>
        s
          .select({ id: schema.proceeding.id })
          .from(schema.proceeding)
          .where(
            and(eq(schema.proceeding.workspaceId, h.workspaceId), eq(schema.proceeding.id, k.dup)),
          ),
      );
      expect(stillThere?.id).toBe(k.dup);
      expect(w.events).toEqual([]);
      expect(h.events).toEqual([]);
    });
  });
});
