// The document preview read model (#393) on the test database: one page's text with the version
// chain, page clamping, a document without pages, and access (restricted matter, junior scope,
// another workspace, the `document` domain switched off). Every text is fictional.
import { randomUUID } from 'node:crypto';

import { schema, type Transaction } from '@causedeck/db';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { buildDocument, buildMatter } from '@causedeck/db/testing/matter-graph-fixtures';
import { describe, expect, it } from 'vitest';

import {
  getDocumentPreview,
  restrictMatter,
  WorkspaceError,
  type GraphEvent,
  type MatterGraphDeps,
} from '../../index.ts';
import { addMember, newWorkspace } from '../../__tests__/fixtures.ts';

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  const error: unknown = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  if (error === undefined) return undefined;
  expect(error).toBeInstanceOf(WorkspaceError);
  return (error as WorkspaceError).code;
}

async function world(tx: Transaction) {
  const { ownerId, workspaceId } = await newWorkspace(tx);
  const events: GraphEvent[] = [];
  const deps: MatterGraphDeps = { db: tx, events: { emit: (e) => void events.push(e) } };
  const run = <T>(fn: (s: Transaction) => Promise<T>) => inWorkspace(tx, workspaceId, fn);
  const seeded = await run(async (s) => {
    const matter = await buildMatter(s, workspaceId, { title: 'Preview matter (fictional)' });
    const first = await buildDocument(s, workspaceId, {
      matterId: matter.id,
      kind: 'pleading',
      language: 'ta',
    });
    const second = await buildDocument(s, workspaceId, {
      matterId: matter.id,
      kind: 'pleading',
      supersedesDocumentId: first.id,
      textStatus: 'layer',
    });
    await s.insert(schema.documentPage).values(
      [1, 2, 3].map((pageNo) => ({
        workspaceId,
        documentId: first.id,
        pageNo,
        text: `Page ${String(pageNo)} text (fictional)`,
        textSource: 'layer',
        lang: 'ta',
        ocrConfidence: pageNo === 2 ? '0.875' : null,
      })),
    );
    return { matterId: matter.id, firstId: first.id, secondId: second.id };
  });
  return { ...seeded, ownerId, workspaceId, deps, events, run };
}

describe('getDocumentPreview (#393)', () => {
  it('returns the asked page with its text and the version chain', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const actor = { userId: w.ownerId, workspaceId: w.workspaceId };
      const preview = await getDocumentPreview(w.deps, actor, {
        documentId: w.firstId,
        pageNo: 2,
      });
      expect(preview.document).toMatchObject({
        id: w.firstId,
        matterId: w.matterId,
        kind: 'pleading',
        language: 'ta',
        source: { type: 'manual' },
        supersedesDocumentId: null,
        supersededByDocumentId: w.secondId,
      });
      expect(preview.pageCount).toBe(3);
      expect(preview.page).toEqual({
        pageNo: 2,
        text: 'Page 2 text (fictional)',
        textSource: 'layer',
        lang: 'ta',
        ocrConfidence: 0.875,
      });
      expect(preview.pageImage).toBeNull();

      // Past the last page: clamped. No page given: the first.
      const last = await getDocumentPreview(w.deps, actor, { documentId: w.firstId, pageNo: 40 });
      expect(last.page?.pageNo).toBe(3);
      const first = await getDocumentPreview(w.deps, actor, { documentId: w.firstId });
      expect(first.page?.pageNo).toBe(1);

      // The later version: no pages yet, and it names the one it replaces.
      const later = await getDocumentPreview(w.deps, actor, { documentId: w.secondId });
      expect(later.pageCount).toBe(0);
      expect(later.page).toBeNull();
      expect(later.document.supersedesDocumentId).toBe(w.firstId);
      expect(later.document.supersededByDocumentId).toBeNull();
      expect(w.events).toEqual([]);
    });
  });

  it('hides documents of matters the actor may not read, and refuses without document.read', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const junior = await addMember(tx, w.workspaceId, 'junior');
      const advocate = await addMember(tx, w.workspaceId, 'advocate');
      const viewer = await addMember(tx, w.workspaceId, 'viewer');
      const other = await newWorkspace(tx);
      const read = (userId: string, workspaceId = w.workspaceId, deps = w.deps) =>
        getDocumentPreview(deps, { userId, workspaceId }, { documentId: w.firstId });

      // A viewer may read documents; a junior not assigned to the matter cannot see it.
      expect((await read(viewer)).page?.pageNo).toBe(1);
      expect(await codeOf(read(junior))).toBe('NOT_FOUND');
      expect(await codeOf(read(other.ownerId, other.workspaceId))).toBe('NOT_FOUND');
      expect(await codeOf(read(other.ownerId))).toBe('NOT_FOUND');
      expect(
        await codeOf(
          getDocumentPreview(
            w.deps,
            { userId: w.ownerId, workspaceId: w.workspaceId },
            { documentId: randomUUID() },
          ),
        ),
      ).toBe('NOT_FOUND');

      // A document with no matter is not previewed here.
      const loose = await w.run((s) => buildDocument(s, w.workspaceId));
      expect(
        await codeOf(
          getDocumentPreview(
            w.deps,
            { userId: w.ownerId, workspaceId: w.workspaceId },
            { documentId: loose.id },
          ),
        ),
      ).toBe('NOT_FOUND');

      // The `document` domain switched off: readable matter, documents FORBIDDEN.
      const noDocuments = {
        ...w.deps,
        settings: { disabledDomains: new Set(['document'] as const) },
      };
      expect(await codeOf(read(w.ownerId, w.workspaceId, noDocuments))).toBe('FORBIDDEN');

      // A restricted matter hides its documents from members not on the list.
      await restrictMatter(
        tx,
        { userId: w.ownerId, workspaceId: w.workspaceId },
        {
          matterId: w.matterId,
          allowedUserIds: [],
        },
      );
      expect(await codeOf(read(advocate))).toBe('NOT_FOUND');
      expect(w.events).toEqual([]);
    });
  });
});
