// The Documents tab of the matter workspace (#393, #40 part 5): registered from
// lib/matters/tabs.ts for members with `document.read`. `documentPreviewHref` opens
// `DocumentPreviewSheet` on a document at a page (`?doc=<id>&page=<n>` on the tab); the timeline
// (#41) and later screens link to it the same way. Pure: no core, db or React imports.
import { matterTabHref, registerMatterTab } from './tab-registry.ts';

export const DOCUMENTS_SEGMENT = 'documents';

/** Documents (#393): after People (20). */
export function registerDocumentsTab(): void {
  registerMatterTab({
    id: 'documents',
    order: 30,
    labelKey: 'documents',
    segment: DOCUMENTS_SEGMENT,
    visible: ({ can }) => can('document.read'),
  });
}

/** The Documents tab, or one page of a cursor. */
export function documentsTabHref(slug: string, matterId: string, cursor?: string): string {
  const base = matterTabHref(slug, matterId, { segment: DOCUMENTS_SEGMENT });
  return cursor === undefined ? base : `${base}?cursor=${encodeURIComponent(cursor)}`;
}

/** The preview href without its page number: `DocumentPreviewSheet` appends the page. */
export function documentPreviewHrefPrefix(
  slug: string,
  matterId: string,
  documentId: string,
): string {
  const base = matterTabHref(slug, matterId, { segment: DOCUMENTS_SEGMENT });
  return `${base}?doc=${encodeURIComponent(documentId)}&page=`;
}

/** The Documents tab with `DocumentPreviewSheet` open on `documentId` at `page` (from 1). */
export function documentPreviewHref(
  slug: string,
  matterId: string,
  documentId: string,
  page = 1,
): string {
  const pageNo = Number.isSafeInteger(page) && page >= 1 ? page : 1;
  return `${documentPreviewHrefPrefix(slug, matterId, documentId)}${String(pageNo)}`;
}
