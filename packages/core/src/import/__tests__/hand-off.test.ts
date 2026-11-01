// Hand a photographed cause list from the capture inbox to list import (#1073) against the
// database: the capture joins a new batch, the list reader then reads it as a list (not as a diary
// photo), and anything else, or another workspace's capture, is refused. The capture-side status
// move (`needs_you -> ready`) is tested with the capture domain (`capture.test.ts`).
import { randomUUID } from 'node:crypto';

import { parseAdvocate, type ParsedCauseList } from '@causedeck/adapters';
import { schema, type Transaction } from '@causedeck/db';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { newWorkspace } from '../../__tests__/fixtures.ts';
import {
  getImportProgress,
  processImportFile,
  saveAdvocateProfile,
  startImportFromCapture,
  type ListParser,
} from '../index.ts';

const NOW = new Date('2026-11-10T06:00:00Z');
const ME = 'Mr. R. Fictional MS/123/1900';

async function seedPhoto(
  tx: Transaction,
  workspaceId: string,
  ownerId: string,
  over: {
    channel?: 'camera' | 'upload';
    route?: string | null;
    status?: 'needs_you' | 'ready' | 'failed';
  } = {},
) {
  const captureId = randomUUID();
  await inWorkspace(tx, workspaceId, async (s) => {
    await s.insert(schema.capture).values({
      id: captureId,
      workspaceId,
      channel: over.channel ?? 'camera',
      status: over.status ?? 'needs_you',
      mime: 'image/jpeg',
      sizeBytes: 10,
      createdBy: ownerId,
      sourceMeta: over.route === null ? {} : { cameraRoute: over.route ?? 'cause_list' },
    });
    const documentId = randomUUID();
    await s.insert(schema.document).values({
      id: documentId,
      workspaceId,
      kind: 'cause_list',
      storageKey: `ws/${workspaceId}/document/${documentId}`,
      sha256: documentId.replaceAll('-', '').repeat(2),
      sourceCaptureId: captureId,
      textStatus: 'ocr',
    });
    await s.insert(schema.documentPage).values({
      workspaceId,
      documentId,
      pageNo: 1,
      text: 'FILE 7',
      textSource: 'ocr',
    });
  });
  return captureId;
}

const list: ParsedCauseList = {
  adapterId: 'mock.adapter',
  adapterVersion: '1.0.0',
  forumCode: 'madras-hc',
  listDate: '2026-11-12',
  rows: [
    {
      anchor: { page: 1, quote: '7. W.P. 7/2026', rowIndex: 7 },
      confidence: 0.9,
      caseTypeRaw: 'W.P.',
      caseType: 'wp',
      caseNumber: '7',
      caseYear: 2026,
      matchKey: 'madras-hc:wp:7:2026',
      parties: 'PARTY 7 VS STATE 7',
      stageRaw: 'FOR ADMISSION',
      stageNorm: 'admission',
      advocates: [parseAdvocate(ME)],
    },
  ],
  diagnostics: {
    unmappedHeadings: [],
    unknownCaseTypes: [],
    rowsSkippedNoAnchor: 0,
    hallsSeen: [],
    hallsUnreadable: [],
  },
  status: 'ok',
};
const parser: ListParser = () =>
  Promise.resolve({ outcome: 'parsed', adapterId: 'mock.adapter', list });

describe('hand a photographed cause list to list import', () => {
  it('links the capture to a new batch and reads it as a list', async () => {
    await withTestDb(async (tx) => {
      const { ownerId, workspaceId } = await newWorkspace(tx);
      const actor = { userId: ownerId, workspaceId };
      const deps = { db: tx, now: () => NOW, parser };
      const captureId = await seedPhoto(tx, workspaceId, ownerId);

      const { batchId } = await startImportFromCapture(deps, actor, { captureId });
      expect(await getImportProgress(deps, actor, batchId)).toMatchObject({
        total: 1,
        files: { pending: 1 },
      });

      await saveAdvocateProfile(tx, actor, { enrolmentNumbers: ['MS/123/1900'], confirmed: true });
      const outcome = await processImportFile(deps, { workspaceId, batchId, captureId });
      expect(outcome).toMatchObject({ outcome: 'parsed', adapterId: 'mock.adapter', rows: 1 });
    });
  });

  it('accepts a capture already ready and refuses anything that is not a photographed list', async () => {
    await withTestDb(async (tx) => {
      const { ownerId, workspaceId } = await newWorkspace(tx);
      const actor = { userId: ownerId, workspaceId };
      const deps = { db: tx, now: () => NOW };
      const ready = await seedPhoto(tx, workspaceId, ownerId, { status: 'ready' });
      expect(
        (await startImportFromCapture(deps, actor, { captureId: ready })).batchId,
      ).toBeTruthy();

      const diary = await seedPhoto(tx, workspaceId, ownerId, { route: null });
      const upload = await seedPhoto(tx, workspaceId, ownerId, { channel: 'upload' });
      const failed = await seedPhoto(tx, workspaceId, ownerId, { status: 'failed' });
      for (const id of [diary, upload, failed]) {
        await expect(startImportFromCapture(deps, actor, { captureId: id })).rejects.toMatchObject({
          code: 'CONFLICT',
        });
      }
    });
  });

  it('does not see another workspace’s capture and changes nothing there', async () => {
    await withTestDb(async (tx) => {
      const a = await newWorkspace(tx);
      const b = await newWorkspace(tx);
      const aCapture = await seedPhoto(tx, a.workspaceId, a.ownerId);
      const actorB = { userId: b.ownerId, workspaceId: b.workspaceId };
      await expect(
        startImportFromCapture({ db: tx }, actorB, { captureId: aCapture }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      const [row] = await inWorkspace(tx, a.workspaceId, (s) =>
        s
          .select({ status: schema.capture.status })
          .from(schema.capture)
          .where(
            and(eq(schema.capture.workspaceId, a.workspaceId), eq(schema.capture.id, aCapture)),
          ),
      );
      expect(row?.status).toBe('needs_you');
    });
  });
});
