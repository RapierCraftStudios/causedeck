// Server-only loaders for the Documents tab and `DocumentPreviewSheet` (#393, #40 part 5).
// `listMatterDocuments` (a keyset page of 50, newest first) and `getDocumentPreview` (one page's
// text) run in the member's workspace scope; both need `document.read` on a matter the member may
// read, so another workspace's matter or document, a restricted matter and a malformed id are
// `not-found` and a role without `document.read` is `denied`. The view mappers format dates for
// the locale and reduce a language tag to the chip the list shows (EN/TA/KN). The timeline (#41)
// reuses `loadDocumentPreview` and `toDocumentPreviewView` with the exported sheet. Only the error
// object is logged, never document text.
import type {
  DocumentPreview,
  MatterDocumentPage,
  MatterDocumentRow,
} from '@causedeck/core/matter-graph';
import { formatDate, type Locale } from '@causedeck/i18n';
import { cache } from 'react';

import { logger } from '../../src/health.ts';
import type { WorkspaceContext } from '../workspace-context.ts';

import { domainErrorCode, graphDeps } from './graph-deps.ts';

/** Documents per page of the tab. */
export const DOCUMENTS_PAGE_SIZE = 50;

export type MatterDocumentsLoad =
  | { kind: 'documents'; page: MatterDocumentPage }
  | { kind: 'not-found' }
  | { kind: 'denied' }
  | { kind: 'error' };

export type DocumentPreviewLoad =
  { kind: 'preview'; preview: DocumentPreview } | { kind: 'unavailable' } | { kind: 'error' };

function loadFailure(error: unknown, what: string): 'not-found' | 'denied' | 'error' {
  const code = domainErrorCode(error);
  if (code === 'NOT_FOUND' || code === 'VALIDATION') return 'not-found';
  if (code === 'FORBIDDEN') return 'denied';
  logger.error({ err: error }, `matter documents: could not load ${what}`);
  return 'error';
}

const loadDocuments = cache(
  async (
    workspaceId: string,
    userId: string,
    matterId: string,
    cursor: string | undefined,
  ): Promise<MatterDocumentsLoad> => {
    try {
      // One at a time, not in a Promise.all: concurrent imports race the test mocks.
      const { inWorkspace } = await import('@causedeck/core/runtime');
      const { listMatterDocuments } = await import('@causedeck/core/matter-graph');
      const scope = { workspaceId, userId };
      const page = await inWorkspace(scope, (tx) =>
        listMatterDocuments(graphDeps(tx), scope, {
          matterId,
          limit: DOCUMENTS_PAGE_SIZE,
          ...(cursor === undefined ? {} : { cursor }),
        }),
      );
      return { kind: 'documents', page };
    } catch (error) {
      // A cursor from another list or tampered with is VALIDATION: treat as not-found only when
      // there was no cursor; with one, start again from the first page.
      if (cursor !== undefined && domainErrorCode(error) === 'VALIDATION') {
        return loadDocuments(workspaceId, userId, matterId, undefined);
      }
      return { kind: loadFailure(error, 'the documents of the matter') };
    }
  },
);

/** One page of the matter's documents for the signed-in member. */
export function loadMatterDocuments(
  context: WorkspaceContext,
  matterId: string,
  cursor?: string,
): Promise<MatterDocumentsLoad> {
  return loadDocuments(context.workspace.id, context.user.id, matterId, cursor);
}

const loadPreview = cache(
  async (
    workspaceId: string,
    userId: string,
    documentId: string,
    pageNo: number,
  ): Promise<DocumentPreviewLoad> => {
    try {
      const { inWorkspace } = await import('@causedeck/core/runtime');
      const { getDocumentPreview } = await import('@causedeck/core/matter-graph');
      const scope = { workspaceId, userId };
      const preview = await inWorkspace(scope, (tx) =>
        getDocumentPreview(graphDeps(tx), scope, { documentId, pageNo }),
      );
      return { kind: 'preview', preview };
    } catch (error) {
      const failure = loadFailure(error, 'the document preview');
      return failure === 'error' ? { kind: 'error' } : { kind: 'unavailable' };
    }
  },
);

/** One page of a document for `DocumentPreviewSheet`; `unavailable` hides whether it exists. */
export function loadDocumentPreview(
  context: WorkspaceContext,
  documentId: string,
  pageNo: number,
): Promise<DocumentPreviewLoad> {
  return loadPreview(context.workspace.id, context.user.id, documentId, pageNo);
}

/** A `?page=` value as a page number from 1; anything else is page 1. */
export function parsePageParam(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === undefined || !/^\d{1,5}$/.test(raw)) return 1;
  const page = Number(raw);
  return page >= 1 ? page : 1;
}

export type DocumentLanguageChip = 'EN' | 'TA' | 'KN';

/** EN/TA/KN for English, Tamil and Kannada tags (`en`, `ta-IN`, ...); null for anything else. */
export function languageChip(language: string | null): DocumentLanguageChip | null {
  if (language === null) return null;
  const primary = language.trim().toLowerCase().split(/[-_]/)[0];
  if (primary === 'en') return 'EN';
  if (primary === 'ta') return 'TA';
  if (primary === 'kn') return 'KN';
  return null;
}

/** The BCP 47 tag a page's text is written in, for `lang` (shaping and screen-reader voice). */
export function languageTag(language: string | null): string | undefined {
  const chip = languageChip(language);
  return chip === null ? undefined : chip.toLowerCase();
}

export interface DocumentRowView {
  id: string;
  kind: MatterDocumentRow['kind'];
  language: DocumentLanguageChip | null;
  textStatus: MatterDocumentRow['textStatus'];
  source: 'capture' | 'manual';
  supersedesDocumentId: string | null;
  supersededByDocumentId: string | null;
  added: string;
}

export interface DocumentListView {
  documents: DocumentRowView[];
  nextCursor: string | null;
}

function rowView(
  row: Pick<
    MatterDocumentRow,
    | 'id'
    | 'kind'
    | 'language'
    | 'textStatus'
    | 'source'
    | 'supersedesDocumentId'
    | 'supersededByDocumentId'
    | 'createdAt'
  >,
  locale: Locale,
): DocumentRowView {
  return {
    id: row.id,
    kind: row.kind,
    language: languageChip(row.language),
    textStatus: row.textStatus,
    source: row.source.type,
    supersedesDocumentId: row.supersedesDocumentId,
    supersededByDocumentId: row.supersededByDocumentId,
    added: formatDate(row.createdAt, { locale }),
  };
}

/** A page of the read model as `DocumentsPanel` renders it. */
export function toDocumentListView(page: MatterDocumentPage, locale: Locale): DocumentListView {
  return {
    documents: page.items.map((row) => rowView(row, locale)),
    nextCursor: page.nextCursor,
  };
}

export interface DocumentPreviewView {
  document: DocumentRowView & { matterId: string };
  pageCount: number;
  page: {
    pageNo: number;
    text: string | null;
    /** `en`, `ta` or `kn` when known, for the text's `lang` attribute. */
    lang: string | undefined;
  } | null;
  pageImage: { url: string } | null;
}

/** The preview read model as `DocumentPreviewSheet` renders it. */
export function toDocumentPreviewView(
  preview: DocumentPreview,
  locale: Locale,
): DocumentPreviewView {
  const { page } = preview;
  return {
    document: { ...rowView(preview.document, locale), matterId: preview.document.matterId },
    pageCount: preview.pageCount,
    page:
      page === null
        ? null
        : {
            pageNo: page.pageNo,
            text: page.text,
            lang: languageTag(page.lang ?? preview.document.language),
          },
    pageImage: preview.pageImage,
  };
}
