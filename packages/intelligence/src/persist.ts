// Persistence (#45): one transaction writes the `document` and its `document_page` rows (the
// `simple`-config tsvector is a generated column, so it fills itself), after the page images are
// stored through the storage package (workspace envelope encryption, a `blob` row each). A
// document exists once per `(capture, pipelineVersion)`: a re-run finds it and writes nothing.
import { schema, withWorkspace, type Queryable } from '@causedeck/db';
import type { DocumentKind, DocumentTextStatus } from '@causedeck/db/schema';
import { storeSystemBlob, type KeyProvider, type ObjectStore } from '@causedeck/storage';
import { and, desc, eq, isNotNull, ne, sql } from 'drizzle-orm';

import type { PageDraft, SkipReason } from './pipeline/steps.ts';
import { hammingDistance } from './pipeline/steps.ts';
import type { PageImages } from './render/thumbs.ts';

const { document, documentPage } = schema;

export interface PersistPage extends PageDraft {
  /** Rendered images; `null` when the page could not be rendered. */
  images: PageImages | null;
}

export interface PersistInput {
  workspaceId: string;
  captureId: string;
  /** The capture's raw object (`blob.key`): the document's `storage_key`. */
  rawStorageKey: string;
  sha256: string;
  pipelineVersion: string;
  kind: DocumentKind;
  classificationConfidence: number;
  language: string | null;
  textStatus: DocumentTextStatus;
  skippedReason: SkipReason | null;
  lowConfidencePages: number[];
  simhash: string | null;
  nearDuplicateDistance: number;
  pages: PersistPage[];
}

export interface PersistResult {
  documentId: string;
  /** False when the document already existed. */
  created: boolean;
  /** An earlier document whose text is a near-duplicate; the pipeline never merges or deletes. */
  nearDuplicateOf: string | null;
}

export interface ExistingDocument {
  documentId: string;
  kind: DocumentKind;
  language: string | null;
  textStatus: DocumentTextStatus;
  lowConfidencePages: number[];
  hasText: boolean;
}

/** Runs inside the persisting transaction, e.g. to move the capture on in the same commit. */
export type PersistHook = (tx: Queryable, result: PersistResult) => Promise<void>;

export interface Persister {
  findExisting(
    workspaceId: string,
    captureId: string,
    pipelineVersion: string,
  ): Promise<ExistingDocument | null>;
  persist(input: PersistInput, hook?: PersistHook): Promise<PersistResult>;
}

export interface DbPersisterOptions {
  db: Queryable;
  store: ObjectStore;
  keys: KeyProvider;
  now?: () => Date;
}

const IMAGE_CONCURRENCY = 4;
const NEAR_DUPLICATE_SCAN = 5000;

export function createDbPersister(options: DbPersisterOptions): Persister {
  const { db, store, keys } = options;
  const now = options.now ?? (() => new Date());

  async function selectExisting(
    tx: Queryable,
    workspaceId: string,
    captureId: string,
    pipelineVersion: string,
  ): Promise<ExistingDocument | null> {
      const [row] = await tx
        .select({
          id: document.id,
          kind: document.kind,
          language: document.language,
          textStatus: document.textStatus,
          low: document.lowConfidencePages,
        })
        .from(document)
        .where(
          and(
            eq(document.workspaceId, workspaceId),
            eq(document.sourceCaptureId, captureId),
            eq(document.pipelineVersion, pipelineVersion),
          ),
        );
      if (row === undefined) return null;
      const [withText] = await tx
        .select({ id: documentPage.id })
        .from(documentPage)
        .where(
          and(
            eq(documentPage.workspaceId, workspaceId),
            eq(documentPage.documentId, row.id),
            sql`coalesce(${documentPage.text}, '') <> ''`,
          ),
        )
        .limit(1);
      return {
        documentId: row.id,
        kind: row.kind,
        language: row.language,
        textStatus: row.textStatus,
        lowConfidencePages: row.low,
        hasText: withText !== undefined,
      };
  }

  function findExisting(
    workspaceId: string,
    captureId: string,
    pipelineVersion: string,
  ): Promise<ExistingDocument | null> {
    return withWorkspace(db, { workspaceId }, (tx) =>
      selectExisting(tx, workspaceId, captureId, pipelineVersion),
    );
  }

  async function storeImages(
    workspaceId: string,
    pages: readonly PersistPage[],
  ): Promise<Map<number, { imageKey: string; previewKey: string }>> {
    const stored = new Map<number, { imageKey: string; previewKey: string }>();
    const ctx = { db, store, keys, workspaceId, now };
    const withImages = pages.filter((page) => page.images !== null);
    for (let start = 0; start < withImages.length; start += IMAGE_CONCURRENCY) {
      await Promise.all(
        withImages.slice(start, start + IMAGE_CONCURRENCY).map(async (page) => {
          const images = page.images;
          if (images === null) return;
          const base = `page-${String(page.pageNo)}`;
          const [thumb, preview] = await Promise.all([
            storeSystemBlob(ctx, {
              kind: 'image',
              filename: `${base}.webp`,
              mime: 'image/webp',
              bytes: images.thumbnail,
            }),
            storeSystemBlob(ctx, {
              kind: 'image',
              filename: `${base}-preview.webp`,
              mime: 'image/webp',
              bytes: images.preview,
            }),
          ]);
          stored.set(page.pageNo, { imageKey: thumb.key, previewKey: preview.key });
        }),
      );
    }
    return stored;
  }

  async function nearDuplicate(
    tx: Queryable,
    input: PersistInput,
    documentId: string,
  ): Promise<string | null> {
    if (input.simhash === null) return null;
    const rows = await tx
      .select({ id: document.id, simhash: document.textSimhash })
      .from(document)
      .where(
        and(
          eq(document.workspaceId, input.workspaceId),
          isNotNull(document.textSimhash),
          ne(document.id, documentId),
        ),
      )
      .orderBy(desc(document.createdAt))
      .limit(NEAR_DUPLICATE_SCAN);
    let best: { id: string; distance: number } | null = null;
    for (const row of rows) {
      if (row.simhash === null) continue;
      const distance = hammingDistance(input.simhash, row.simhash);
      if (distance <= input.nearDuplicateDistance && (best === null || distance < best.distance)) {
        best = { id: row.id, distance };
      }
    }
    return best?.id ?? null;
  }

  return {
    findExisting,
    async persist(input, hook) {
      const existing = await findExisting(input.workspaceId, input.captureId, input.pipelineVersion);
      // A `pending` document is the text layer kept while AI was paused: this run completes it.
      if (existing !== null && existing.textStatus !== 'pending') {
        return { documentId: existing.documentId, created: false, nearDuplicateOf: null };
      }
      const pendingId = existing?.documentId ?? null;
      const images = await storeImages(input.workspaceId, input.pages);
      const documentId = pendingId ?? crypto.randomUUID();
      return withWorkspace(db, { workspaceId: input.workspaceId }, async (tx) => {
        const values = {
          kind: input.kind,
          language: input.language,
          textStatus: input.textStatus,
          classificationConfidence: input.classificationConfidence.toFixed(3),
          lowConfidencePages: input.lowConfidencePages,
          textSkippedReason: input.skippedReason,
          textSimhash: input.simhash,
        };
        let inserted: { id: string } | undefined;
        if (pendingId === null) {
          [inserted] = await tx
            .insert(document)
            .values({
              ...values,
              id: documentId,
              workspaceId: input.workspaceId,
              storageKey: input.rawStorageKey,
              sha256: input.sha256,
              sourceCaptureId: input.captureId,
              pipelineVersion: input.pipelineVersion,
            })
            .onConflictDoNothing({
              target: [document.workspaceId, document.sourceCaptureId, document.pipelineVersion],
            })
            .returning({ id: document.id });
        } else {
          await tx
            .update(document)
            .set(values)
            .where(and(eq(document.workspaceId, input.workspaceId), eq(document.id, pendingId)));
          await tx
            .delete(documentPage)
            .where(
              and(eq(documentPage.workspaceId, input.workspaceId), eq(documentPage.documentId, pendingId)),
            );
          inserted = { id: pendingId };
        }
        if (inserted === undefined) {
          const raced = await selectExisting(
            tx,
            input.workspaceId,
            input.captureId,
            input.pipelineVersion,
          );
          const result: PersistResult = {
            documentId: raced?.documentId ?? documentId,
            created: false,
            nearDuplicateOf: null,
          };
          if (hook !== undefined) await hook(tx, result);
          return result;
        }
        if (input.pages.length > 0) {
          await tx.insert(documentPage).values(
            input.pages.map((page) => ({
              workspaceId: input.workspaceId,
              documentId,
              pageNo: page.pageNo,
              text: page.text,
              textSource: page.textSource,
              ocrConfidence: page.ocrConfidence === null ? null : page.ocrConfidence.toFixed(3),
              lang: page.lang,
              imageKey: images.get(page.pageNo)?.imageKey ?? null,
              previewKey: images.get(page.pageNo)?.previewKey ?? null,
              width: page.images?.width ?? null,
              height: page.images?.height ?? null,
            })),
          );
        }
        const result: PersistResult = {
          documentId,
          created: true,
          nearDuplicateOf:
            input.textStatus === 'pending' ? null : await nearDuplicate(tx, input, documentId),
        };
        if (hook !== undefined) await hook(tx, result);
        return result;
      });
    },
  };
}
