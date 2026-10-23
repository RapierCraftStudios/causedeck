// `/w/[slug]/matters/[id]/documents` (#393, #40 part 5): the Documents tab, 50 documents a page
// (`?cursor=`), and `DocumentPreviewSheet` open on a document at a page (`?doc=<id>&page=<n>`).
// `listMatterDocuments` and `getDocumentPreview` run in the member's workspace scope and need
// `document.read` on a matter the member may read: another workspace's matter or an unknown id is
// this segment's not-found screen, a role without `document.read` gets permission-denied, and a
// preview that cannot be shown says so inside the sheet without saying whether it exists. The tab
// has no mutation controls (uploads go to the Inbox, #48). States: loading (skeleton), error
// (error.tsx: `Retry` and a reference), empty (`Open Inbox`), offline (the layout's banner) and
// permission-denied. In development `?__state=loading|error|denied|empty` previews them.
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';

import {
  DocumentPreviewSheet,
  type DocumentPreviewState,
} from '../../../../../../../components/matters/document-preview-sheet.tsx';
import { DocumentsPanel } from '../../../../../../../components/matters/documents-panel.tsx';
import { MattersPermissionDenied } from '../../../../../../../components/matters/matters-list.tsx';
import { isDev } from '../../../../../../../lib/env.ts';
import {
  documentPreviewHrefPrefix,
  documentsTabHref,
} from '../../../../../../../lib/matters/documents-tab.ts';
import {
  loadDocumentPreview,
  loadMatterDocuments,
  parsePageParam,
  toDocumentListView,
  toDocumentPreviewView,
} from '../../../../../../../lib/matters/documents.ts';
import type { SearchParams } from '../../../../../../../lib/matters/list-params.ts';
import { can } from '../../../../../../../lib/workspace-context.ts';
import { getWorkspaceContext } from '../../../../../../../lib/workspace-loader.ts';

import DocumentsLoading from './loading.tsx';

interface DocumentsPageProps {
  params: Promise<{ slug: string; id: string }>;
  searchParams: Promise<SearchParams>;
}

function single(value: string | string[] | undefined): string | undefined {
  const first = Array.isArray(value) ? value[0] : value;
  return first === undefined || first === '' ? undefined : first;
}

/** `?__state=…` previews a state in development. Ignored in production. */
function devState(searchParams: SearchParams): string | undefined {
  if (!isDev()) return undefined;
  return single(searchParams.__state);
}

async function pageLocale() {
  const { isLocale, DEFAULT_LOCALE } = await import('@causedeck/i18n');
  const requested = await getLocale();
  return isLocale(requested) ? requested : DEFAULT_LOCALE;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('matters.workspace');
  return { title: t('tabs.documents') };
}

export default async function MatterDocumentsPage({ params, searchParams }: DocumentsPageProps) {
  const [{ slug, id }, query] = await Promise.all([params, searchParams]);
  const context = await getWorkspaceContext(slug);
  if (!context) notFound();

  const dev = devState(query);
  if (dev === 'loading') return <DocumentsLoading />;
  if (dev === 'error') throw new Error('Documents error state (dev toggle)');
  if (dev === 'denied' || !can(context.role, 'document.read')) return <MattersPermissionDenied />;

  const cursor = single(query.cursor);
  const loaded = await loadMatterDocuments(context, id, cursor);
  if (loaded.kind === 'not-found') notFound();
  if (loaded.kind === 'denied') return <MattersPermissionDenied />;
  if (loaded.kind === 'error') throw new Error('Matter documents could not be loaded');

  const locale = await pageLocale();
  const list = toDocumentListView(loaded.page, locale);
  const tabHref = documentsTabHref(slug, id, cursor);

  const documentId = single(query.doc);
  let preview: DocumentPreviewState | null = null;
  if (documentId !== undefined) {
    const found = await loadDocumentPreview(context, documentId, parsePageParam(query.page));
    if (found.kind === 'preview' && found.preview.document.matterId === id) {
      preview = { kind: 'preview', preview: toDocumentPreviewView(found.preview, locale) };
    } else {
      // Another matter's document opens from its own matter; here it is simply not available.
      preview = { kind: found.kind === 'error' ? 'error' : 'unavailable' };
    }
  }

  return (
    <>
      <DocumentsPanel
        slug={slug}
        matterId={id}
        list={dev === 'empty' ? { documents: [], nextCursor: null } : list}
        inboxHref={`/w/${encodeURIComponent(slug)}/inbox`}
        moreHref={list.nextCursor === null ? null : documentsTabHref(slug, id, list.nextCursor)}
        firstHref={cursor === undefined ? null : documentsTabHref(slug, id)}
      />
      {preview === null || documentId === undefined ? null : (
        <DocumentPreviewSheet
          state={preview}
          pageHrefPrefix={documentPreviewHrefPrefix(slug, id, documentId)}
          closeHref={tabHref}
        />
      )}
    </>
  );
}
