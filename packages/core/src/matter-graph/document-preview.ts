// The document preview read model (#393, #40 part 5): one page of a matter's document for
// `DocumentPreviewSheet` (the Documents tab, and later the timeline #41). It only reads and emits
// nothing. The document must be of the actor's workspace and attached to a matter the actor may
// read (NOT_FOUND otherwise, as `requireMatter` decides), and the actor needs `document.read` on
// that matter (FORBIDDEN), like `listMatterDocuments`. The page number is clamped to the pages the
// document has. Page images are rendered by the document pipeline (#45); until then `pageImage` is
// null for a page without a stored image and the sheet then shows that the image is not ready. The
// image bytes are never read here: `getDocumentPageImage` resolves the stored key for the same
// access rules and the web route (`/api/documents/[id]/pages/[pageNo]/image`) decrypts and streams
// it (#489).
import { can } from '@causedeck/auth/policy';
import type { DocumentKind, DocumentTextStatus } from '@causedeck/db/schema';
import { schema } from '@causedeck/db';
import { DocumentPreviewInput } from '@causedeck/validators/matter-graph-inputs';
import { and, asc, count, desc, eq, lte } from 'drizzle-orm';

import { forbidden } from '../shared/errors.ts';

import {
  inGraphScope,
  matterResource,
  parseInput,
  type GraphActor,
  type GraphScope,
  type MatterGraphDeps,
} from './context.ts';
import { graphNotFound } from './errors.ts';
import type { DocumentSource } from './read-models.ts';

const { document, documentPage, matter, matterRestriction, member } = schema;

export interface DocumentPreviewPage {
  pageNo: number;
  text: string | null;
  /** Where the text came from, e.g. the PDF text layer or OCR. */
  textSource: string | null;
  lang: string | null;
  ocrConfidence: number | null;
}

export interface DocumentPreview {
  document: {
    id: string;
    matterId: string;
    kind: DocumentKind;
    language: string | null;
    textStatus: DocumentTextStatus;
    source: DocumentSource;
    supersedesDocumentId: string | null;
    supersededByDocumentId: string | null;
    createdAt: Date;
  };
  pageCount: number;
  /** The requested page, clamped to `1..pageCount`; null while the document has no pages. */
  page: DocumentPreviewPage | null;
  /** The page's rendered image (a route of this app); null when the page has no stored image. */
  pageImage: { url: string } | null;
}

/** The route that decrypts and streams a page's stored image (apps/web, #489). */
function pageImageUrl(workspaceId: string, documentId: string, pageNo: number): string {
  return `/api/documents/${documentId}/pages/${String(pageNo)}/image?workspaceId=${workspaceId}`;
}

/**
 * The document when it is of the actor's workspace, attached to a matter the actor may read and the
 * actor holds `document.read` on it. NOT_FOUND hides a matter the actor may not read; FORBIDDEN
 * says the documents of a readable matter are off limits.
 */
async function readableDocument(
  scope: GraphScope,
  documentId: string,
): Promise<typeof document.$inferSelect & { matterId: string }> {
  const { tx, settings } = scope;
  const { workspaceId } = scope.actor;
  const [found] = await tx
    .select({
      document,
      ownerUserId: member.userId,
      allowUserIds: matterRestriction.allowedUserIds,
    })
    .from(document)
    .innerJoin(
      matter,
      and(eq(matter.workspaceId, document.workspaceId), eq(matter.id, document.matterId)),
    )
    .leftJoin(
      member,
      and(eq(member.organizationId, matter.workspaceId), eq(member.id, matter.ownerMemberId)),
    )
    .leftJoin(
      matterRestriction,
      and(
        eq(matterRestriction.workspaceId, matter.workspaceId),
        eq(matterRestriction.matterId, matter.id),
      ),
    )
    .where(and(eq(document.workspaceId, workspaceId), eq(document.id, documentId)))
    .limit(1);
  const doc = found?.document;
  if (found === undefined || doc === undefined || doc.matterId === null) {
    throw graphNotFound('document');
  }
  const resource = matterResource(workspaceId, doc.matterId, found.allowUserIds, found.ownerUserId);
  // A matter the actor may not read hides its documents as if they did not exist.
  if (!can(scope.actor, 'matter.read', resource, settings).allow) throw graphNotFound('document');
  if (!can(scope.actor, 'document.read', resource, settings).allow) {
    throw forbidden('You cannot see the documents of this matter');
  }

  return { ...doc, matterId: doc.matterId };
}

/** One page of a document of a matter the actor may read, with its text and the version chain. */
export async function getDocumentPreview(
  deps: MatterGraphDeps,
  actor: GraphActor,
  input: DocumentPreviewInput,
): Promise<DocumentPreview> {
  const data = parseInput(DocumentPreviewInput, input);
  return inGraphScope(deps, actor, async (scope) => {
    const { tx } = scope;
    const { workspaceId } = scope.actor;
    const doc = await readableDocument(scope, data.documentId);

    const [later] = await tx
      .select({ id: document.id })
      .from(document)
      .where(and(eq(document.workspaceId, workspaceId), eq(document.supersedesDocumentId, doc.id)))
      .orderBy(asc(document.createdAt), asc(document.id))
      .limit(1);
    const [counted] = await tx
      .select({ pages: count() })
      .from(documentPage)
      .where(and(eq(documentPage.workspaceId, workspaceId), eq(documentPage.documentId, doc.id)));
    const pageCount = counted?.pages ?? 0;

    let page: DocumentPreviewPage | null = null;
    let pageImage: DocumentPreview['pageImage'] = null;
    if (pageCount > 0) {
      const wanted = Math.min(data.pageNo, pageCount);
      const pagesOf = and(
        eq(documentPage.workspaceId, workspaceId),
        eq(documentPage.documentId, doc.id),
      );
      // Page numbers are unique per document but may have gaps: the nearest page at or before the
      // one asked for, else the first page.
      const [atOrBefore] = await tx
        .select()
        .from(documentPage)
        .where(and(pagesOf, lte(documentPage.pageNo, wanted)))
        .orderBy(desc(documentPage.pageNo))
        .limit(1);
      const chosen =
        atOrBefore ??
        (
          await tx
            .select()
            .from(documentPage)
            .where(pagesOf)
            .orderBy(asc(documentPage.pageNo))
            .limit(1)
        )[0];
      if (chosen !== undefined) {
        if ((chosen.previewKey ?? chosen.imageKey) !== null) {
          pageImage = { url: pageImageUrl(workspaceId, doc.id, chosen.pageNo) };
        }
        const confidence = chosen.ocrConfidence === null ? null : Number(chosen.ocrConfidence);
        page = {
          pageNo: chosen.pageNo,
          text: chosen.text,
          textSource: chosen.textSource,
          lang: chosen.lang,
          ocrConfidence: confidence === null || Number.isNaN(confidence) ? null : confidence,
        };
      }
    }

    return {
      document: {
        id: doc.id,
        matterId: doc.matterId,
        kind: doc.kind,
        language: doc.language,
        textStatus: doc.textStatus,
        source:
          doc.sourceCaptureId === null
            ? { type: 'manual' }
            : { type: 'capture', captureId: doc.sourceCaptureId },
        supersedesDocumentId: doc.supersedesDocumentId,
        supersededByDocumentId: later?.id ?? null,
        createdAt: doc.createdAt,
      },
      pageCount,
      page,
      pageImage,
    };
  });
}

/** A stored page image: its object key (workspace-encrypted) and media type. */
export interface DocumentPageImage {
  key: string;
  mime: string;
}

/**
 * The stored image of one page (the preview rendition, else the thumbnail) of a document the actor
 * may read, under the same access rules as `getDocumentPreview`. NOT_FOUND when the page has no
 * image. It returns the key only: the caller decrypts and streams the bytes outside the
 * transaction.
 */
export async function getDocumentPageImage(
  deps: MatterGraphDeps,
  actor: GraphActor,
  input: DocumentPreviewInput,
): Promise<DocumentPageImage> {
  const data = parseInput(DocumentPreviewInput, input);
  return inGraphScope(deps, actor, async (scope) => {
    const { workspaceId } = scope.actor;
    const doc = await readableDocument(scope, data.documentId);
    const [found] = await scope.tx
      .select({ previewKey: documentPage.previewKey, imageKey: documentPage.imageKey })
      .from(documentPage)
      .where(
        and(
          eq(documentPage.workspaceId, workspaceId),
          eq(documentPage.documentId, doc.id),
          eq(documentPage.pageNo, data.pageNo),
        ),
      )
      .limit(1);
    const key = found?.previewKey ?? found?.imageKey ?? null;
    if (key === null) throw graphNotFound('document');
    return { key, mime: 'image/webp' };
  });
}
