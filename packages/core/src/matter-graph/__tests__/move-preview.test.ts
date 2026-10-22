// Merge and split previews (#392) on the test database: a preview lists exactly what the merge or
// split then moves, names the refusal the merge would raise (sensitive, restricted, merged,
// archived) instead of throwing it, writes nothing, emits nothing, and keeps the merge's access
// rules (a viewer is FORBIDDEN; another workspace's matter is the typed cross-workspace error).
import { schema, type Transaction } from '@causedeck/db';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import {
  buildDocument,
  buildForum,
  buildMatter,
  buildObligation,
  buildProceeding,
  buildProceedingLink,
} from '@causedeck/db/testing/matter-graph-fixtures';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import {
  CrossWorkspaceError,
  mergeMatters,
  previewMergeMatters,
  previewSplitMatter,
  restrictMatter,
  splitMatter,
  WorkspaceError,
  type GraphEvent,
  type MatterGraphDeps,
} from '../../index.ts';
import { addMember, newWorkspace } from '../../__tests__/fixtures.ts';

interface World {
  tx: Transaction;
  workspaceId: string;
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
    forumId: forum.id,
    events,
    deps: { db: tx, events: { emit: (e) => events.push(e) } },
    owner: { userId: ownerId, workspaceId },
    in: (fn) => inWorkspace(tx, workspaceId, fn),
  };
}

let seq = 0;

/** A matter with two proceedings, a document and an obligation on each proceeding. */
async function seedMatter(w: World, sensitive = false) {
  return w.in(async (s) => {
    const m = await buildMatter(s, w.workspaceId, { sensitive });
    const proceedings = [];
    const obligations = [];
    for (let i = 0; i < 2; i += 1) {
      seq += 1;
      const p = await buildProceeding(s, w.workspaceId, {
        matterId: m.id,
        forumId: w.forumId,
        number: String(1000 + seq),
        year: 2026,
      });
      proceedings.push(p.id);
      const ob = await buildObligation(s, w.workspaceId, { matterId: m.id, proceedingId: p.id });
      obligations.push(ob.id);
    }
    const doc = await buildDocument(s, w.workspaceId, { matterId: m.id });
    return { matterId: m.id, proceedings, obligations, documentId: doc.id };
  });
}

async function graph(w: World) {
  return w.in(async (s) => ({
    matters: await s.select().from(schema.matter).orderBy(schema.matter.id),
    proceedings: await s.select().from(schema.proceeding).orderBy(schema.proceeding.id),
    documents: await s.select().from(schema.document).orderBy(schema.document.id),
    obligations: await s.select().from(schema.obligation).orderBy(schema.obligation.id),
  }));
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

const sorted = (ids: string[]) => [...ids].sort();

describe('previewMergeMatters', () => {
  it('lists what mergeMatters then moves, and writes nothing', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const into = await seedMatter(w);
      const from = await seedMatter(w);
      const before = await graph(w);
      const preview = await previewMergeMatters(w.deps, w.owner, {
        intoMatterId: into.matterId,
        fromMatterId: from.matterId,
      });
      expect(preview.blocked).toBeNull();
      // Seeded in one transaction (one `created_at`), so the order between them is the id's.
      expect(sorted(preview.proceedings.map((p) => p.id))).toEqual(sorted(from.proceedings));
      expect(preview.proceedings[0]).toMatchObject({ year: 2026 });
      expect(preview.documentIds).toEqual([from.documentId]);
      expect(sorted(preview.obligationIds)).toEqual(sorted(from.obligations));
      expect(await graph(w)).toEqual(before);
      expect(w.events).toEqual([]);

      const merged = await mergeMatters(w.deps, w.owner, {
        intoMatterId: into.matterId,
        fromMatterId: from.matterId,
      });
      expect(sorted(merged.moved.proceedingIds)).toEqual(
        sorted(preview.proceedings.map((p) => p.id)),
      );
      expect(merged.moved.documentIds).toEqual(preview.documentIds);
      expect(sorted(merged.moved.obligationIds)).toEqual(sorted(preview.obligationIds));
    });
  });

  it('names the refusal: sensitive either way, restricted, merged, archived', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const plain = await seedMatter(w);
      const sensitive = await seedMatter(w, true);
      const restricted = await seedMatter(w);
      await restrictMatter(tx, w.owner, { matterId: restricted.matterId, allowedUserIds: [] });
      const blocked = async (intoMatterId: string, fromMatterId: string) =>
        (await previewMergeMatters(w.deps, w.owner, { intoMatterId, fromMatterId })).blocked;

      const intoPlain = await previewMergeMatters(w.deps, w.owner, {
        intoMatterId: plain.matterId,
        fromMatterId: sensitive.matterId,
      });
      expect(intoPlain).toMatchObject({
        blocked: 'sensitive',
        intoSensitive: false,
        fromSensitive: true,
      });
      expect(await blocked(sensitive.matterId, plain.matterId)).toBe('sensitive');
      expect(await blocked(plain.matterId, restricted.matterId)).toBe('restricted');

      const archived = await seedMatter(w);
      await w.in((s) =>
        s
          .update(schema.matter)
          .set({ status: 'archived' })
          .where(eq(schema.matter.id, archived.matterId)),
      );
      expect(await blocked(plain.matterId, archived.matterId)).toBe('archived');
      const other = await seedMatter(w);
      const third = await seedMatter(w);
      await mergeMatters(w.deps, w.owner, {
        intoMatterId: third.matterId,
        fromMatterId: other.matterId,
      });
      w.events.length = 0;
      expect(await blocked(plain.matterId, other.matterId)).toBe('merged');
      // Every blocked preview matches a merge refusal.
      expect(
        await codeOf(
          mergeMatters(w.deps, w.owner, {
            intoMatterId: plain.matterId,
            fromMatterId: sensitive.matterId,
          }),
        ),
      ).toBe('CONFLICT');
      expect(w.events).toEqual([]);
    });
  });

  it('keeps the merge access rules', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const v = await world(tx);
      const mine = await seedMatter(w);
      const second = await seedMatter(w);
      const theirs = await seedMatter(v);
      const viewer = await addMember(tx, w.workspaceId, 'viewer');
      expect(
        await codeOf(
          previewMergeMatters(
            w.deps,
            { userId: viewer, workspaceId: w.workspaceId },
            { intoMatterId: mine.matterId, fromMatterId: second.matterId },
          ),
        ),
      ).toBe('FORBIDDEN');
      await expect(
        previewMergeMatters(w.deps, w.owner, {
          intoMatterId: mine.matterId,
          fromMatterId: theirs.matterId,
        }),
      ).rejects.toBeInstanceOf(CrossWorkspaceError);
      expect(
        await codeOf(
          previewMergeMatters(w.deps, w.owner, {
            intoMatterId: mine.matterId,
            fromMatterId: mine.matterId,
          }),
        ),
      ).toBe('VALIDATION');
    });
  });
});

describe('previewSplitMatter', () => {
  it('lists what splitMatter then moves, counts crossing links, and writes nothing', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const m = await seedMatter(w);
      const [stays, moves] = m.proceedings as [string, string];
      await w.in((s) =>
        buildProceedingLink(s, w.workspaceId, {
          fromProceedingId: stays,
          toProceedingId: moves,
          kind: 'connected',
        }),
      );
      const before = await graph(w);
      const preview = await previewSplitMatter(w.deps, w.owner, {
        matterId: m.matterId,
        proceedingIds: [moves],
      });
      expect(preview).toMatchObject({ blocked: null, crossingLinks: 1 });
      expect(preview.proceedings.map((p) => p.id)).toEqual([moves]);
      expect(preview.obligationIds).toEqual([m.obligations[1]]);
      expect(await graph(w)).toEqual(before);
      expect(w.events).toEqual([]);

      const split = await splitMatter(w.deps, w.owner, {
        matterId: m.matterId,
        proceedingIds: [moves],
        newTitle: 'Writ appeal',
      });
      expect(split.moved.proceedingIds).toEqual([moves]);
      expect(split.moved.obligationIds).toEqual(preview.obligationIds);
      expect(split.crossing).toHaveLength(preview.crossingLinks);
    });
  });

  it('refuses proceedings of another matter or workspace, a viewer, and names an archived matter', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const v = await world(tx);
      const m = await seedMatter(w);
      const other = await seedMatter(w);
      const theirs = await seedMatter(v);
      const viewer = await addMember(tx, w.workspaceId, 'viewer');
      const own = m.proceedings[0] ?? '';
      expect(
        await codeOf(
          previewSplitMatter(w.deps, w.owner, {
            matterId: m.matterId,
            proceedingIds: [other.proceedings[0] ?? ''],
          }),
        ),
      ).toBe('VALIDATION');
      await expect(
        previewSplitMatter(w.deps, w.owner, {
          matterId: m.matterId,
          proceedingIds: [theirs.proceedings[0] ?? ''],
        }),
      ).rejects.toBeInstanceOf(CrossWorkspaceError);
      expect(
        await codeOf(
          previewSplitMatter(
            w.deps,
            { userId: viewer, workspaceId: w.workspaceId },
            { matterId: m.matterId, proceedingIds: [own] },
          ),
        ),
      ).toBe('FORBIDDEN');
      await w.in((s) =>
        s.update(schema.matter).set({ status: 'archived' }).where(eq(schema.matter.id, m.matterId)),
      );
      const archived = await previewSplitMatter(w.deps, w.owner, {
        matterId: m.matterId,
        proceedingIds: [own],
      });
      expect(archived.blocked).toBe('archived');
    });
  });
});
