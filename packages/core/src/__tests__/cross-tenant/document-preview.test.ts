// Cross-tenant document preview (#393): user `ub`, working in workspace B, calls
// `getDocumentPreview` with workspace A's document (attached to A's matter, with a page of text).
// Claiming A, from B's scope, or from B's own workspace, every call must be NOT_FOUND, FORBIDDEN or
// VALIDATION (`denies`), return no text and emit nothing; A's own owner can read the page, so the
// probe is sound. Kept beside services.test.ts and driven by the same registry
// (`@causedeck/db/testing/cross-tenant-registry`), like next-date-choice.test.ts.
import { schema, type Database, type Transaction } from '@causedeck/db';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { SERVICE_TESTS } from '@causedeck/db/testing/cross-tenant-registry';
import { seedTwoTenants, type TwoTenants } from '@causedeck/db/testing/two-tenants';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import * as core from '../../index.ts';

const THIS_FILE = 'packages/core/src/__tests__/cross-tenant/document-preview.test.ts';

interface Fixture extends TwoTenants {
  tx: Transaction;
  /** Run `fn` as `ub` inside workspace B's scope. */
  asB: <T>(fn: (s: Transaction) => Promise<T>) => Promise<T>;
  /** A's document with page 1 ('Seed page'). */
  documentId: string;
}

type Case = (f: Fixture) => Promise<void>;

/** Rejects with a WorkspaceError whose code is NOT_FOUND, FORBIDDEN or VALIDATION. */
async function expectDenied(promise: Promise<unknown>): Promise<void> {
  const error: unknown = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error, 'expected NOT_FOUND, FORBIDDEN or VALIDATION').toBeInstanceOf(core.WorkspaceError);
  expect(['NOT_FOUND', 'FORBIDDEN', 'VALIDATION']).toContain((error as core.WorkspaceError).code);
}

function graphDeps(db: Database | Transaction) {
  const events: core.GraphEvent[] = [];
  return { deps: { db, events: { emit: (e: core.GraphEvent) => events.push(e) } }, events };
}

const CASES: Record<string, Case> = {
  getDocumentPreview: async (f) => {
    const input = { documentId: f.documentId, pageNo: 1 };
    const { deps, events } = graphDeps(f.tx);
    // ub claiming A: no scope, and from B's scope.
    await expectDenied(core.getDocumentPreview(deps, { userId: f.ub, workspaceId: f.a.id }, input));
    await expectDenied(
      f.asB((s) =>
        core.getDocumentPreview({ ...deps, db: s }, { userId: f.ub, workspaceId: f.a.id }, input),
      ),
    );
    // ub in B with A's document id: not visible.
    await expectDenied(core.getDocumentPreview(deps, { userId: f.ub, workspaceId: f.b.id }, input));
    expect(events).toEqual([]);
    // A's own owner reads the page: the probe is sound.
    const preview = await core.getDocumentPreview(
      deps,
      { userId: f.ua, workspaceId: f.a.id },
      input,
    );
    expect(preview.page?.text).toBe('Seed page');
  },
  getDocumentPageImage: async (f) => {
    // A's page 1 has a stored preview image.
    await inWorkspace(f.tx, f.a.id, (s) =>
      s
        .update(schema.documentPage)
        .set({ previewKey: 'blobs/a-page-1-preview' })
        .where(eq(schema.documentPage.documentId, f.documentId)),
    );
    const input = { documentId: f.documentId, pageNo: 1 };
    const { deps, events } = graphDeps(f.tx);
    await expectDenied(
      core.getDocumentPageImage(deps, { userId: f.ub, workspaceId: f.a.id }, input),
    );
    await expectDenied(
      f.asB((s) =>
        core.getDocumentPageImage({ ...deps, db: s }, { userId: f.ub, workspaceId: f.a.id }, input),
      ),
    );
    await expectDenied(
      core.getDocumentPageImage(deps, { userId: f.ub, workspaceId: f.b.id }, input),
    );
    expect(events).toEqual([]);
    // A's own owner resolves the key (and the preview names the route): the probe is sound.
    const image = await core.getDocumentPageImage(
      deps,
      { userId: f.ua, workspaceId: f.a.id },
      input,
    );
    expect(image).toEqual({ key: 'blobs/a-page-1-preview', mime: 'image/webp' });
    const preview = await core.getDocumentPreview(
      deps,
      { userId: f.ua, workspaceId: f.a.id },
      input,
    );
    expect(preview.pageImage).toEqual({
      url: `/api/documents/${f.documentId}/pages/1/image?workspaceId=${f.a.id}`,
    });
  },
};

const registered = Object.entries(SERVICE_TESTS)
  .filter(([, entry]) => entry.test === THIS_FILE)
  .map(([name]) => name);

describe('cross-tenant document preview: ub on workspace B against A (#393)', () => {
  it('has a case for every service the registry points here', () => {
    expect(registered).toContain('getDocumentPreview');
    expect(registered).toContain('getDocumentPageImage');
    expect(registered.filter((name) => !(name in CASES))).toEqual([]);
    expect(Object.keys(CASES).filter((name) => !registered.includes(name))).toEqual([]);
  });

  it.each(registered)('%s', async (name) => {
    const run = CASES[name];
    if (run === undefined) throw new Error(`no cross-tenant case for ${name}`);
    await withTestDb(async (tx) => {
      const seeded = await seedTwoTenants(tx);
      const documentId = seeded.a.rows.document_page?.documentId;
      if (documentId === undefined) throw new Error('two-tenant document_page seed missing');
      await run({
        ...seeded,
        tx,
        asB: (fn) => inWorkspace(tx, seeded.b.id, fn, seeded.ub),
        documentId,
      });
    });
  });
});
