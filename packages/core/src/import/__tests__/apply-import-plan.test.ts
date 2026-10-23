// `applyImportPlan` and `undoImportBatch` against the database (#549): the plan is written through
// the matter-graph services with import provenance, applying twice is a no-op, the batch undoes
// within 7 days and not after, duplicates are offered as a merge, sensitive matters are excluded by
// default, the OCR cap leaves files unread, and another workspace cannot touch the batch.
import { randomUUID } from 'node:crypto';

import { schema, type Transaction } from '@causedeck/db';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { buildForum } from '@causedeck/db/testing/matter-graph-fixtures';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { newWorkspace } from '../../__tests__/fixtures.ts';
import { getWorkspaceEntitlements } from '../../billing/index.ts';
import { createMatter, createProceeding } from '../../matter-graph/index.ts';
import { WorkspaceError } from '../../shared/errors.ts';
import { applyImportPlan, undoImportBatch, splitByOcrAllowance } from '../index.ts';
import type { ImportPlan, PlanProceeding } from '../plan-types.ts';

const NOW = new Date('2026-11-10T06:00:00Z');
const source = { proposalId: randomUUID(), captureId: null, kind: 'new_proceeding', anchorIds: [] };

function proceeding(key: string, over: Partial<PlanProceeding>, forumCode: string): PlanProceeding {
  return {
    key,
    label: null,
    caseType: 'W.P.',
    caseNumber: '100',
    caseYear: 2026,
    forumCode,
    cnr: null,
    parentKey: null,
    parties: null,
    stage: null,
    nextDate: null,
    nextDateCandidates: [],
    sources: [source],
    ...over,
  };
}

function planOf(forumCode: string, number = '100'): ImportPlan {
  const main = proceeding(
    'p1',
    { caseNumber: number, nextDate: { date: '2026-11-12', sources: [source] } },
    forumCode,
  );
  const child = proceeding(
    'p2',
    { caseType: 'W.M.P.', caseNumber: '5', parentKey: 'p1' },
    forumCode,
  );
  return {
    version: 1,
    today: '2026-11-10',
    matters: [
      {
        tempId: 'm_1',
        title: 'Fictional v. State',
        proceedings: [main, child],
        nextDate: main.nextDate,
        issues: [],
        confidence: 0.9,
        reason: 'main petition with child proceedings',
        sources: [source],
      },
    ],
    history: [{ matterTempId: 'm_1', proceedingKey: 'p1', date: '2026-11-01', sources: [source] }],
    obligations: [
      { matterTempId: 'm_1', title: 'File counter', dueDate: '2026-11-20', sources: [source] },
    ],
    counts: { matchedRows: 2, unmatchedRowsCount: 0 },
  };
}

async function world(tx: Transaction, plan?: (forumCode: string) => ImportPlan) {
  const { ownerId, workspaceId } = await newWorkspace(tx);
  const forum = await inWorkspace(tx, workspaceId, (s) => buildForum(s, workspaceId));
  const batchId = randomUUID();
  await inWorkspace(tx, workspaceId, async (s) => {
    await s.insert(schema.importBatch).values({ id: batchId, workspaceId, status: 'ready' });
    await s
      .insert(schema.importPlan)
      .values({ workspaceId, batchId, plan: (plan ?? planOf)(forum.code) as never });
  });
  const events: unknown[] = [];
  const deps = { db: tx, events: { emit: (e: unknown) => events.push(e) }, now: () => NOW };
  return { workspaceId, batchId, forum, deps, actor: { userId: ownerId, workspaceId } };
}

const count = async (tx: Transaction, workspaceId: string, table: 'matter' | 'proceeding') =>
  (
    await inWorkspace(tx, workspaceId, (s) =>
      s.select().from(schema[table]).where(eq(schema[table].workspaceId, workspaceId)),
    )
  ).length;

describe('applyImportPlan', () => {
  it('writes the plan with import provenance, once, and undoes it within 7 days', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const first = await applyImportPlan(w.deps, w.actor, { batchId: w.batchId });
      expect(first.created).toMatchObject({
        matters: 1,
        proceedings: 2,
        hearings: 1,
        obligations: 1,
      });
      const again = await applyImportPlan(w.deps, w.actor, { batchId: w.batchId });
      expect(again).toEqual(first);
      expect(await count(tx, w.workspaceId, 'proceeding')).toBe(2);

      const rows = await inWorkspace(tx, w.workspaceId, async (s) => ({
        proceedings: await s.select().from(schema.proceeding),
        activities: await s
          .select()
          .from(schema.activity)
          .where(eq(schema.activity.workspaceId, w.workspaceId)),
        batch: await s
          .select()
          .from(schema.importBatch)
          .where(eq(schema.importBatch.id, w.batchId)),
      }));
      expect(rows.proceedings.every((p) => p.sourceType === 'import')).toBe(true);
      expect(rows.proceedings.every((p) => p.confirmationState === 'confirmed')).toBe(true);
      expect(rows.activities).toHaveLength(2);
      expect(new Set(rows.activities.map((a) => a.cascadeGroupId)).size).toBe(1);
      expect(rows.batch[0]).toMatchObject({ status: 'applied', planHash: first.planHash });

      await expect(
        applyImportPlan(w.deps, w.actor, {
          batchId: w.batchId,
          decisions: { includeSensitive: ['other'] },
        }),
      ).rejects.toMatchObject({ code: 'CONFLICT' });

      const undone = await undoImportBatch(w.deps, w.actor, { batchId: w.batchId });
      expect(undone.undone).toBe(1);
      expect(await count(tx, w.workspaceId, 'proceeding')).toBe(0);
      const matters = await inWorkspace(tx, w.workspaceId, (s) => s.select().from(schema.matter));
      expect(matters.every((m) => m.status === 'archived')).toBe(true);
      await expect(undoImportBatch(w.deps, w.actor, { batchId: w.batchId })).rejects.toMatchObject({
        code: 'CONFLICT',
      });
    });
  });

  it('refuses an undo after the 7-day window', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      await applyImportPlan(w.deps, w.actor, { batchId: w.batchId });
      const late = { ...w.deps, now: () => new Date(NOW.getTime() + 8 * 24 * 60 * 60 * 1000) };
      await expect(undoImportBatch(late, w.actor, { batchId: w.batchId })).rejects.toMatchObject({
        name: 'UndoExpiredError',
      });
      expect(await count(tx, w.workspaceId, 'proceeding')).toBe(2);
    });
  });

  it('offers a duplicate as a merge, and merges into the existing matter on request', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const existing = await createMatter(w.deps, w.actor, { title: 'Existing' });
      const dup = await createProceeding(w.deps, w.actor, {
        matterId: existing.id,
        forumId: w.forum.id,
        caseType: 'W.P.',
        number: '100',
        year: 2026,
        provenance: { sourceType: 'manual' },
      });
      const offered = await applyImportPlan(w.deps, w.actor, { batchId: w.batchId });
      expect(offered.duplicates).toMatchObject([
        { existingProceedingId: dup.id, existingMatterId: existing.id },
      ]);
      expect(offered.created.matters).toBe(0);
      expect(await count(tx, w.workspaceId, 'proceeding')).toBe(1);
    });
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const existing = await createMatter(w.deps, w.actor, { title: 'Existing' });
      await createProceeding(w.deps, w.actor, {
        matterId: existing.id,
        forumId: w.forum.id,
        caseType: 'W.P.',
        number: '100',
        year: 2026,
        provenance: { sourceType: 'manual' },
      });
      const merged = await applyImportPlan(w.deps, w.actor, {
        batchId: w.batchId,
        decisions: { matters: { m_1: { action: 'merge' } } },
      });
      expect(merged.created).toMatchObject({ matters: 0, proceedings: 1 });
      const children = await inWorkspace(tx, w.workspaceId, (s) =>
        s
          .select()
          .from(schema.proceeding)
          .where(and(eq(schema.proceeding.matterId, existing.id))),
      );
      expect(children).toHaveLength(2);
    });
  });

  it('excludes a matter that touches a sensitive matter unless included', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const existing = await createMatter(w.deps, w.actor, { title: 'Hidden', sensitive: true });
      await createProceeding(w.deps, w.actor, {
        matterId: existing.id,
        forumId: w.forum.id,
        caseType: 'W.P.',
        number: '100',
        year: 2026,
        provenance: { sourceType: 'manual' },
      });
      const result = await applyImportPlan(w.deps, w.actor, { batchId: w.batchId });
      expect(result.excluded).toEqual([{ matterTempId: 'm_1', reason: 'sensitive' }]);
      expect(result.created.matters).toBe(0);
    });
  });

  it('refuses a blocking issue the decisions do not resolve', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx, (code) => {
        const plan = planOf(code);
        plan.matters[0]?.issues.push({
          code: 'conflicting_dates',
          blocking: true,
          proceedingKey: 'p1',
        });
        return plan;
      });
      await expect(applyImportPlan(w.deps, w.actor, { batchId: w.batchId })).rejects.toMatchObject({
        code: 'VALIDATION',
      });
      const done = await applyImportPlan(w.deps, w.actor, {
        batchId: w.batchId,
        decisions: { resolvedDates: { p1: '2026-11-15' } },
      });
      expect(done.created.matters).toBe(1);
    });
  });

  it("denies workspace B on workspace A's batch and leaves A unchanged", async () => {
    await withTestDb(async (tx) => {
      const a = await world(tx);
      const b = await newWorkspace(tx);
      const actorB = { userId: b.ownerId, workspaceId: b.workspaceId };
      const error: unknown = await applyImportPlan(a.deps, actorB, { batchId: a.batchId }).then(
        () => undefined,
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(WorkspaceError);
      expect((error as WorkspaceError).code).toBe('NOT_FOUND');
      const batch = await inWorkspace(tx, a.workspaceId, (s) =>
        s.select().from(schema.importBatch).where(eq(schema.importBatch.id, a.batchId)),
      );
      expect(batch[0]?.status).toBe('ready');
    });
  });
});

describe('splitByOcrAllowance', () => {
  it('keeps files past the OCR cap as attachments without reading them', async () => {
    await withTestDb(async (tx) => {
      const { workspaceId } = await newWorkspace(tx);
      const ent = await inWorkspace(tx, workspaceId, (s) =>
        getWorkspaceEntitlements(s, workspaceId, NOW),
      );
      const cap = ent.ocr_pages;
      const files = Array.from({ length: (cap ?? 3) + 2 }, (_, i) => ({
        id: `f${String(i)}`,
        pages: 1,
      }));
      const split = await splitByOcrAllowance({ db: tx, workspaceId, now: () => NOW }, files);
      if (cap === null) {
        expect(split.attachOnly).toEqual([]);
      } else {
        expect(split.read).toHaveLength(cap);
        expect(split.attachOnly).toHaveLength(2);
      }
    });
  });
});
