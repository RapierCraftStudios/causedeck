// The bootstrap import batch against the database (#550): per-file progress and the retry of a failed
// file, a 200-file synthetic bundle that ends in a plan with mock providers, the matched-only rule
// (no identifiers: nothing is staged and the batch asks for them; the profile is saved only after
// confirmation; another advocate's row is never stored), attachments (no dedicated adapter, past the
// OCR cap) and the captures a batch accepts. The court adapters are replaced by a mock parser.
import { randomUUID } from 'node:crypto';

import { parseAdvocate, type ParsedCauseList, type ParsedListRow } from '@causedeck/adapters';
import { schema, type Transaction } from '@causedeck/db';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

import { newWorkspace } from '../../__tests__/fixtures.ts';
import {
  addImportFiles,
  createImportBatch,
  finishImportBatch,
  getAdvocateProfile,
  getImportProgress,
  listRowPayloads,
  markImportFileFailed,
  markImportFilesOverCap,
  NEEDS_ADAPTER_NOTE,
  NEEDS_DEDICATED_ADAPTER,
  OVER_OCR_CAP,
  processImportFile,
  saveAdvocateProfile,
  startImportProcessing,
  type ListParser,
} from '../index.ts';

const NOW = new Date('2026-11-10T06:00:00Z');
const ME = 'Mr. R. Fictional MS/123/1900';
const SECRET = 'SECRET-OTHER-ADVOCATE';

function row(
  no: number,
  options: { advocate?: string; parties?: string; children?: boolean } = {},
): ParsedListRow {
  const key = `madras-hc:wp:${String(no)}:2026`;
  return {
    anchor: { page: 1, quote: `${String(no)}. W.P. ${String(no)}/2026`, rowIndex: no },
    confidence: 0.9,
    caseTypeRaw: 'W.P.',
    caseType: 'wp',
    caseNumber: String(no),
    caseYear: 2026,
    matchKey: key,
    parties: options.parties ?? `PARTY ${String(no)} VS STATE ${String(no)}`,
    stageRaw: 'FOR ADMISSION',
    stageNorm: 'admission',
    advocates: [parseAdvocate(options.advocate ?? ME)],
    ...(options.children === true
      ? {
          children: [
            {
              caseTypeCode: 'wmp',
              caseTypeRaw: 'W.M.P.',
              number: '7',
              year: 2026,
              matchKey: `madras-hc:wmp:${String(no)}7:2026`,
              parentProceedingKey: key,
            },
          ],
        }
      : {}),
  };
}

function listOf(rows: ParsedListRow[]): ParsedCauseList {
  return {
    adapterId: 'mock.adapter',
    adapterVersion: '1.0.0',
    forumCode: 'madras-hc',
    listDate: '2026-11-12',
    rows,
    diagnostics: {
      unmappedHeadings: [],
      unknownCaseTypes: [],
      rowsSkippedNoAnchor: 0,
      hallsSeen: [],
      hallsUnreadable: [],
    },
    status: 'ok',
  };
}

/** A parser that reads the file number from the first line of the text. */
function mockParser(rowsOf: (no: number) => ParsedListRow[] = (no) => [row(no)]): ListParser {
  return (input) => {
    const no = Number.parseInt(/FILE (\d+)/.exec(input.text)?.[1] ?? '0', 10);
    return Promise.resolve({
      outcome: 'parsed',
      adapterId: 'mock.adapter',
      list: listOf(rowsOf(no)),
    });
  };
}

async function world(tx: Transaction) {
  const { ownerId, workspaceId } = await newWorkspace(tx);
  const actor = { userId: ownerId, workspaceId };
  const deps = { db: tx, now: () => NOW };
  const { batchId } = await createImportBatch(deps, actor);
  return { tx, ownerId, workspaceId, actor, deps, batchId };
}
type World = Awaited<ReturnType<typeof world>>;

/** A processed `bulk_import` capture with a cause-list document, linked to the batch. */
async function seedFile(w: World, no: number, over: { kind?: 'cause_list' | 'order' } = {}) {
  const captureId = randomUUID();
  await inWorkspace(w.tx, w.workspaceId, async (s) => {
    await s.insert(schema.capture).values({
      id: captureId,
      workspaceId: w.workspaceId,
      channel: 'bulk_import',
      status: 'ready',
      mime: 'application/pdf',
      sizeBytes: 10,
      originalFilename: `list-${String(no)}.pdf`,
      createdBy: w.ownerId,
    });
    const documentId = randomUUID();
    await s.insert(schema.document).values({
      id: documentId,
      workspaceId: w.workspaceId,
      kind: over.kind ?? 'cause_list',
      storageKey: `ws/${w.workspaceId}/document/${documentId}`,
      sha256: documentId.replaceAll('-', '').repeat(2),
      sourceCaptureId: captureId,
      textStatus: 'layer',
    });
    await s.insert(schema.documentPage).values({
      workspaceId: w.workspaceId,
      documentId,
      pageNo: 1,
      text: `FILE ${String(no)}`,
      textSource: 'layer',
    });
  });
  return captureId;
}

async function seedBatch(w: World, count: number): Promise<string[]> {
  const ids: string[] = [];
  for (let no = 1; no <= count; no++) ids.push(await seedFile(w, no));
  await addImportFiles(w.deps, w.actor, { batchId: w.batchId, captureIds: ids });
  return ids;
}

const proposalsOf = (w: World) =>
  inWorkspace(w.tx, w.workspaceId, (s) =>
    s.select().from(schema.proposal).where(eq(schema.proposal.workspaceId, w.workspaceId)),
  );

const fileRow = async (w: World, captureId: string) => {
  const rows = await inWorkspace(w.tx, w.workspaceId, (s) =>
    s
      .select()
      .from(schema.importBatchFile)
      .where(
        and(
          eq(schema.importBatchFile.workspaceId, w.workspaceId),
          eq(schema.importBatchFile.captureId, captureId),
        ),
      ),
  );
  return rows[0];
};

const confirm = (w: World) =>
  saveAdvocateProfile(w.tx, w.actor, { enrolmentNumbers: ['MS/123/1900'], confirmed: true });

describe('listRowPayloads', () => {
  it('stages the row and each child reference with the row advocates and a parent key', () => {
    const list = listOf([row(3, { children: true })]);
    const payloads = listRowPayloads(list, list.rows[0] as ParsedListRow);
    expect(payloads).toHaveLength(2);
    expect(payloads[0]).toMatchObject({
      matchKey: 'madras-hc:wp:3:2026',
      forumCode: 'madras-hc',
      listDate: '2026-11-12',
      caseNumber: '3',
    });
    expect(payloads[1]).toMatchObject({
      matchKey: 'madras-hc:wmp:37:2026',
      parentProceedingKey: 'madras-hc:wp:3:2026',
      caseTypeRaw: 'W.M.P.',
    });
    expect(payloads[1]?.['advocates']).toEqual(payloads[0]?.['advocates']);
  });
});

describe('import batch', () => {
  it('reports per-file progress, fails a file whose attempts ran out and retries it', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      await confirm(w);
      const [a, b, c] = await seedBatch(w, 3);
      expect(await getImportProgress(w.deps, w.actor, w.batchId)).toMatchObject({
        status: 'pending',
        total: 3,
        files: { pending: 3 },
        needsIdentifiers: false,
      });

      const flaky = vi.fn(mockParser());
      flaky.mockImplementationOnce(() => Promise.reject(new Error('adapter crashed')));
      const deps = { ...w.deps, parser: flaky };
      const input = (captureId: string) => ({
        workspaceId: w.workspaceId,
        batchId: w.batchId,
        captureId,
      });
      await expect(processImportFile(deps, input(a as string))).rejects.toThrow('adapter crashed');
      expect((await fileRow(w, a as string))?.status).toBe('pending');
      await markImportFileFailed(deps, input(a as string));
      expect(await processImportFile(deps, input(b as string))).toMatchObject({
        outcome: 'parsed',
      });
      expect(await processImportFile(deps, input(c as string))).toMatchObject({
        outcome: 'parsed',
      });
      // Idempotent: a file that ended is skipped.
      expect(await processImportFile(deps, input(b as string))).toEqual({ outcome: 'skipped' });

      const progress = await getImportProgress(w.deps, w.actor, w.batchId);
      expect(progress.files).toMatchObject({ parsed: 2, failed: 1, pending: 0 });
      expect(await finishImportBatch(deps, w)).toMatchObject({ outcome: 'ready', matters: 2 });

      // Retry the failed file only.
      const redo = await startImportProcessing(deps, {
        workspaceId: w.workspaceId,
        batchId: w.batchId,
        reprocess: 'failed',
      });
      expect(redo.map((file) => file.captureId)).toEqual([a]);
      expect(await processImportFile(deps, { ...input(a as string), force: true })).toMatchObject({
        outcome: 'parsed',
      });
      expect(await finishImportBatch(deps, w)).toMatchObject({ outcome: 'ready', matters: 3 });
    });
  });

  it('waits for a capture still in the pipeline', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const [a] = await seedBatch(w, 1);
      await inWorkspace(tx, w.workspaceId, (s) =>
        s
          .update(schema.capture)
          .set({ status: 'processing' })
          .where(eq(schema.capture.id, a as string)),
      );
      const result = await processImportFile(
        { ...w.deps, parser: mockParser() },
        { workspaceId: w.workspaceId, batchId: w.batchId, captureId: a as string },
      );
      expect(result).toEqual({ outcome: 'waiting' });
      expect((await fileRow(w, a as string))?.status).toBe('pending');
    });
  });

  it('turns a 200-file synthetic bundle into a plan well inside five minutes', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      await confirm(w);
      const ids = await seedBatch(w, 200);
      const deps = { ...w.deps, parser: mockParser() };
      const started = Date.now();
      const pending = await startImportProcessing(deps, {
        workspaceId: w.workspaceId,
        batchId: w.batchId,
      });
      expect(pending).toHaveLength(200);
      for (const captureId of ids) {
        await processImportFile(deps, {
          workspaceId: w.workspaceId,
          batchId: w.batchId,
          captureId,
        });
      }
      const done = await finishImportBatch(deps, w);
      expect(Date.now() - started).toBeLessThan(5 * 60_000);
      expect(done).toMatchObject({ outcome: 'ready', matters: 200, matchedRows: 200 });
      const progress = await getImportProgress(w.deps, w.actor, w.batchId);
      expect(progress).toMatchObject({ status: 'ready', total: 200, files: { parsed: 200 } });
    });
  }, 300_000);

  it('imports no list rows without identifiers, asks for them and saves them only once confirmed', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const [a] = await seedBatch(w, 1);
      const deps = { ...w.deps, parser: mockParser() };
      const input = { workspaceId: w.workspaceId, batchId: w.batchId, captureId: a as string };

      expect(await processImportFile(deps, input)).toMatchObject({ outcome: 'unmatched', rows: 0 });
      expect(await proposalsOf(w)).toEqual([]);
      expect(await finishImportBatch(deps, w)).toEqual({ outcome: 'needs_identifiers' });
      expect(await getImportProgress(deps, w.actor, w.batchId)).toMatchObject({
        status: 'pending',
        needsIdentifiers: true,
      });

      // A proposal is not a save.
      const proposed = await saveAdvocateProfile(tx, w.actor, {
        enrolmentNumbers: [' ms / 123 / 1900 '],
        aliases: ['R. Fictional, Adv.'],
        confirmed: false,
      });
      expect(proposed.saved).toBe(false);
      expect(proposed.identifiers.enrolmentNumbers).toEqual(['MS/123/1900']);
      expect(await getAdvocateProfile(tx, w.actor)).toEqual({ enrolmentNumbers: [], aliases: [] });
      await expect(
        saveAdvocateProfile(tx, w.actor, { enrolmentNumbers: [], aliases: [], confirmed: true }),
      ).rejects.toMatchObject({ code: 'VALIDATION' });

      const saved = await confirm(w);
      expect(saved.saved).toBe(true);
      expect((await getAdvocateProfile(tx, w.actor)).enrolmentNumbers).toEqual(['MS/123/1900']);

      const redo = await startImportProcessing(deps, {
        workspaceId: w.workspaceId,
        batchId: w.batchId,
        reprocess: 'unmatched',
      });
      expect(redo.map((file) => file.captureId)).toEqual([a]);
      expect(await processImportFile(deps, { ...input, force: true })).toMatchObject({
        outcome: 'parsed',
        rows: 1,
      });
      expect(await finishImportBatch(deps, w)).toMatchObject({ outcome: 'ready', matters: 1 });
    });
  });

  it('never stores a row of another advocate', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      await confirm(w);
      const [a] = await seedBatch(w, 1);
      const deps = {
        ...w.deps,
        parser: mockParser(() => [
          row(1),
          row(2, { advocate: `Mr. Z. Stranger MS/999/2001 ${SECRET}`, parties: SECRET }),
        ]),
      };
      await processImportFile(deps, {
        workspaceId: w.workspaceId,
        batchId: w.batchId,
        captureId: a as string,
      });
      const stored = await proposalsOf(w);
      expect(stored).toHaveLength(1);
      expect(JSON.stringify(stored)).not.toContain(SECRET);
      await finishImportBatch(deps, w);
      const plans = await inWorkspace(tx, w.workspaceId, (s) =>
        s.select().from(schema.importPlan).where(eq(schema.importPlan.batchId, w.batchId)),
      );
      expect(JSON.stringify(plans)).not.toContain(SECRET);
    });
  });

  it('keeps a list no dedicated adapter reads as an attachment with a note', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      await confirm(w);
      const [a] = await seedBatch(w, 1);
      const parser: ListParser = () => Promise.resolve({ outcome: 'needs_adapter' });
      const result = await processImportFile(
        { ...w.deps, parser },
        { workspaceId: w.workspaceId, batchId: w.batchId, captureId: a as string },
      );
      expect(result).toEqual({ outcome: 'unmatched', adapterId: NEEDS_DEDICATED_ADAPTER, rows: 0 });
      const [cap] = await inWorkspace(tx, w.workspaceId, (s) =>
        s
          .select()
          .from(schema.capture)
          .where(eq(schema.capture.id, a as string)),
      );
      expect(cap?.sourceMeta).toMatchObject({ importNote: NEEDS_ADAPTER_NOTE });
      expect(await proposalsOf(w)).toEqual([]);
      // A profile change does not requeue it.
      expect(
        await startImportProcessing(w.deps, {
          workspaceId: w.workspaceId,
          batchId: w.batchId,
          reprocess: 'unmatched',
        }),
      ).toEqual([]);
    });
  });

  it('keeps files past the OCR cap unread', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      await confirm(w);
      const [a, b] = await seedBatch(w, 2);
      const parser = vi.fn(mockParser());
      await markImportFilesOverCap(w.deps, {
        workspaceId: w.workspaceId,
        batchId: w.batchId,
        captureIds: [a as string],
      });
      expect(await fileRow(w, a as string)).toMatchObject({
        status: 'unmatched',
        adapterId: OVER_OCR_CAP,
      });
      expect(parser).not.toHaveBeenCalled();
      const redo = await startImportProcessing(
        { ...w.deps, parser },
        { workspaceId: w.workspaceId, batchId: w.batchId, reprocess: 'unmatched' },
      );
      expect(redo.map((file) => file.captureId)).toEqual([b]);
    });
  });

  it('accepts only the bulk_import captures of its own workspace', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const other = await world(tx);
      const own = await seedFile(w, 1);
      const foreign = await seedFile(other, 2);
      const share = randomUUID();
      await inWorkspace(tx, w.workspaceId, (s) =>
        s.insert(schema.capture).values({
          id: share,
          workspaceId: w.workspaceId,
          channel: 'share',
          mime: 'application/pdf',
          sizeBytes: 10,
          createdBy: w.ownerId,
        }),
      );
      const result = await addImportFiles(w.deps, w.actor, {
        batchId: w.batchId,
        captureIds: [own, foreign, share, own],
      });
      expect(result).toEqual({ added: 1, skipped: 2 });
      await expect(getImportProgress(w.deps, other.actor, w.batchId)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      await expect(
        addImportFiles(w.deps, other.actor, { batchId: w.batchId, captureIds: [foreign] }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });
});
