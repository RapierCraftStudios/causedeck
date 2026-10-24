// The migration concierge against the database (#685): a 5,000-row dry run writes no matter,
// proceeding or import batch and reports mapping issues; an import interrupted after some chunks
// resumes to exactly the expected matters without duplicates; a rollback undoes every chunk; and
// another workspace cannot see or run it.
import { schema, type Transaction } from '@causedeck/db';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { buildForum } from '@causedeck/db/testing/matter-graph-fixtures';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { newUser, newWorkspace } from '../../__tests__/fixtures.ts';
import {
  getMigrationProgress,
  getMigrationReport,
  MAX_MIGRATION_ROWS,
  parseMigrationCsv,
  resumeMigrationRun,
  rollbackMigrationRun,
  runMigrationChunk,
  startMigrationRun,
} from '../index.ts';

const NOW = new Date('2026-11-10T06:00:00Z');
const MAPPING = {
  title: 'Title',
  caseType: 'Type',
  caseNumber: 'No',
  caseYear: 'Year',
  forumCode: 'Court',
  nextDate: 'Next',
};

function csvOf(forumCode: string, rows: number, bad = 0): string {
  const lines = ['Title,Type,No,Year,Court,Next'];
  for (let i = 0; i < rows; i++) {
    const broken = i < bad;
    lines.push(
      `Fictional ${String(i)} v. State,W.P.,${String(1000 + i)},2026,${forumCode},${broken ? 'not-a-date' : '2026-12-01'}`,
    );
  }
  return lines.join('\n');
}

async function world(tx: Transaction) {
  const { ownerId, workspaceId } = await newWorkspace(tx);
  const forum = await inWorkspace(tx, workspaceId, (s) => buildForum(s, workspaceId));
  const events: unknown[] = [];
  const deps = { db: tx, events: { emit: (e: unknown) => events.push(e) }, now: () => NOW };
  return { workspaceId, forum, deps, actor: { userId: ownerId, workspaceId } };
}

const counts = (tx: Transaction, workspaceId: string) =>
  inWorkspace(tx, workspaceId, async (s) => ({
    matters: (
      await s.select().from(schema.matter).where(eq(schema.matter.workspaceId, workspaceId))
    ).length,
    proceedings: (
      await s.select().from(schema.proceeding).where(eq(schema.proceeding.workspaceId, workspaceId))
    ).length,
    batches: (
      await s
        .select()
        .from(schema.importBatch)
        .where(eq(schema.importBatch.workspaceId, workspaceId))
    ).length,
  }));

describe('parseMigrationCsv', () => {
  it('maps columns, reads quoted cells and flags rows with codes', () => {
    const text = 'Title,Type,Court,Next\n"A, B v. State",W.P.,HC,31/12/2026\n,W.P.,HC,2026-02-30\n';
    const { rows, missingColumns } = parseMigrationCsv(
      text,
      { title: 'title', caseType: 'type', forumCode: 'court', nextDate: 'next', cnr: 'CNR' },
      '2026-11-10',
    );
    expect(missingColumns).toEqual(['cnr']);
    expect(rows[0]).toMatchObject({ title: 'A, B v. State', nextDate: '2026-12-31', issues: [] });
    expect(rows[1]?.issues).toEqual(['missing_title', 'bad_date']);
  });

  it('refuses a file over the row cap', () => {
    expect(() =>
      parseMigrationCsv(csvOf('HC', MAX_MIGRATION_ROWS + 1), MAPPING, '2026-11-10'),
    ).toThrow(RangeError);
  });
});

describe('migration runs', () => {
  it('dry-runs 5,000 matters without writing and reports mapping issues', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const before = await counts(tx, w.workspaceId);
      const run = await startMigrationRun(w.deps, w.actor, {
        mode: 'dry_run',
        csv: csvOf(w.forum.code, MAX_MIGRATION_ROWS, 7),
        mapping: MAPPING,
      });
      expect(run).toMatchObject({
        status: 'succeeded',
        totalRows: MAX_MIGRATION_ROWS,
        errorRows: 7,
        processedRows: MAX_MIGRATION_ROWS,
      });
      expect(await counts(tx, w.workspaceId)).toEqual(before);
      const report = await getMigrationReport(w.deps, w.actor, { runId: run.runId });
      expect(report.issueCounts).toEqual({ bad_date: 7 });
      expect(report.issues[0]).toEqual({ row: 1, code: 'bad_date' });
      await expect(runMigrationChunk(w.deps, w.actor, { runId: run.runId })).rejects.toMatchObject({
        code: 'CONFLICT',
      });
    });
  });

  it('flags an unknown court and a row repeated in the file', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const csv = `${csvOf('NO-SUCH-COURT', 1)}\n${csvOf(w.forum.code, 1).split('\n')[1] ?? ''}\n${csvOf(w.forum.code, 1).split('\n')[1] ?? ''}`;
      const run = await startMigrationRun(w.deps, w.actor, {
        mode: 'dry_run',
        csv,
        mapping: MAPPING,
      });
      const report = await getMigrationReport(w.deps, w.actor, { runId: run.runId });
      expect(report.issueCounts).toEqual({ unknown_forum: 1, duplicate_in_file: 1 });
    });
  });

  it('resumes an interrupted import to exactly the expected matters, then rolls it back', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const chunkSize = 5;
      const total = chunkSize * 2 + 6;
      const run = await startMigrationRun(w.deps, w.actor, {
        mode: 'import',
        csv: csvOf(w.forum.code, total, 3),
        mapping: MAPPING,
        chunkSize,
      });
      expect(run).toMatchObject({ status: 'queued', errorRows: 3, chunks: { total: 3, done: 0 } });
      expect((await counts(tx, w.workspaceId)).matters).toBe(0);

      const partial = await resumeMigrationRun(w.deps, w.actor, { runId: run.runId, maxChunks: 1 });
      expect(partial).toMatchObject({ status: 'running', chunks: { total: 3, done: 1 } });
      expect((await counts(tx, w.workspaceId)).matters).toBe(chunkSize);

      const done = await resumeMigrationRun(w.deps, w.actor, { runId: run.runId });
      expect(done).toMatchObject({ status: 'succeeded', processedRows: total, errorRows: 3 });
      expect((await counts(tx, w.workspaceId)).matters).toBe(total - 3);
      const again = await resumeMigrationRun(w.deps, w.actor, { runId: run.runId });
      expect(again.chunks).toEqual({ total: 3, done: 3 });
      expect((await counts(tx, w.workspaceId)).matters).toBe(total - 3);

      const rolled = await rollbackMigrationRun(w.deps, w.actor, { runId: run.runId });
      expect(rolled.status).toBe('rolled_back');
      const rows = await inWorkspace(tx, w.workspaceId, (s) =>
        s.select().from(schema.migrationRunRow),
      );
      expect(rows.filter((r) => r.state === 'rolled_back')).toHaveLength(total - 3);
      const live = await inWorkspace(tx, w.workspaceId, (s) =>
        s.select().from(schema.matter).where(eq(schema.matter.workspaceId, w.workspaceId)),
      );
      expect(live.every((m) => m.status === 'archived')).toBe(true);
    });
  });

  it('keeps a run to its workspace and to its owner', async () => {
    await withTestDb(async (tx) => {
      const a = await world(tx);
      const b = await newWorkspace(tx);
      const run = await startMigrationRun(a.deps, a.actor, {
        mode: 'dry_run',
        csv: csvOf(a.forum.code, 2),
        mapping: MAPPING,
      });
      const intruder = { userId: b.ownerId, workspaceId: a.workspaceId };
      await expect(
        getMigrationProgress(a.deps, intruder, { runId: run.runId }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(
        startMigrationRun(a.deps, intruder, {
          mode: 'dry_run',
          csv: csvOf('x', 1),
          mapping: MAPPING,
        }),
      ).rejects.toBeDefined();
      const stranger = { userId: await newUser(tx), workspaceId: b.workspaceId };
      await expect(
        getMigrationProgress(
          a.deps,
          { ...stranger, workspaceId: b.workspaceId },
          { runId: run.runId },
        ),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });
});
