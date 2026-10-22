'use client';
// The Documents tab (#393, #40 part 5): the matter's documents, newest first, 50 at a time. Each
// row opens `DocumentPreviewSheet` at its first page and shows the kind badge, the language chip
// (EN/TA/KN), the text status, where it came from (the Inbox or added by hand), the version chain
// (links to the version it replaces and the one that replaced it) and when it was added. Uploads
// happen in the capture inbox (#48): the tab points there with "Share or drop files into your
// Inbox", and the empty state offers Open Inbox as its one primary action. The tab has no upload,
// edit or delete controls, so viewers see exactly what writers see.
import { Badge } from '@causedeck/ui/badge';
import { buttonVariants } from '@causedeck/ui/button';
import { EmptyState } from '@causedeck/ui/empty-state';
import { FileText, Inbox } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

import { documentPreviewHref } from '../../lib/matters/documents-tab.ts';
import type { DocumentListView, DocumentRowView } from '../../lib/matters/documents.ts';

export interface DocumentsPanelProps {
  slug: string;
  matterId: string;
  list: DocumentListView;
  inboxHref: string;
  /** The next (older) page of the list, when there is one. */
  moreHref: string | null;
  /** The first page, when this is a later one. */
  firstHref: string | null;
}

function DocumentRow({
  doc,
  previewHref,
}: {
  doc: DocumentRowView;
  previewHref: (documentId: string, page: number) => string;
}) {
  const t = useTranslations('matters.workspace.documents');
  const kind = t(`kinds.${doc.kind}`);
  return (
    <li
      data-document={doc.id}
      className="border-line flex flex-col gap-1.5 border-b py-3 last:border-b-0 md:flex-row md:items-center md:justify-between md:gap-4"
    >
      <div className="flex min-w-0 flex-col gap-1.5">
        <Link
          href={previewHref(doc.id, 1)}
          data-document-open=""
          aria-label={t('open', { kind, date: doc.added })}
          className="flex items-center gap-2 font-medium underline-offset-4 hover:underline"
        >
          <FileText aria-hidden="true" className="text-ink-muted size-4 shrink-0" />
          {kind}
        </Link>
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <Badge tone="neutral" data-document-kind={doc.kind}>
            {kind}
          </Badge>
          {doc.language === null ? null : (
            <Badge
              tone="outline"
              data-document-language={doc.language}
              title={t(`languages.${doc.language}`)}
            >
              <span aria-hidden="true">{doc.language}</span>
              <span className="sr-only">{t(`languages.${doc.language}`)}</span>
            </Badge>
          )}
          <span className="text-ink-muted" data-document-text={doc.textStatus}>
            {t(`textStatus.${doc.textStatus}`)}
          </span>
          <span className="text-ink-muted" data-document-source={doc.source}>
            {t(`sources.${doc.source}`)}
          </span>
        </div>
        {doc.supersedesDocumentId === null && doc.supersededByDocumentId === null ? null : (
          <p className="flex flex-wrap gap-3 text-xs" data-document-versions="">
            {doc.supersedesDocumentId === null ? null : (
              <Link
                href={previewHref(doc.supersedesDocumentId, 1)}
                data-document-replaces={doc.supersedesDocumentId}
                className="text-accent underline-offset-4 hover:underline"
              >
                {t('replaces')}
              </Link>
            )}
            {doc.supersededByDocumentId === null ? null : (
              <Link
                href={previewHref(doc.supersededByDocumentId, 1)}
                data-document-replaced-by={doc.supersededByDocumentId}
                className="text-accent underline-offset-4 hover:underline"
              >
                {t('replacedBy')}
              </Link>
            )}
          </p>
        )}
      </div>
      <span className="text-ink-muted shrink-0 text-xs tabular-nums">
        {t('added', { date: doc.added })}
      </span>
    </li>
  );
}

export function DocumentsPanel({
  slug,
  matterId,
  list,
  inboxHref,
  moreHref,
  firstHref,
}: DocumentsPanelProps) {
  const t = useTranslations('matters.workspace.documents');
  const previewHref = (documentId: string, page: number) =>
    documentPreviewHref(slug, matterId, documentId, page);
  const empty = list.documents.length === 0 && firstHref === null;
  return (
    <section
      data-slot="documents-panel"
      aria-labelledby="matter-documents-title"
      className="flex flex-col gap-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="matter-documents-title" className="font-serif text-xl font-medium">
          {t('tabTitle')}
        </h2>
        {empty ? null : (
          <Link
            href={inboxHref}
            data-documents-inbox=""
            className={buttonVariants({ variant: 'secondary', size: 'sm' })}
          >
            <Inbox aria-hidden="true" />
            {t('inbox')}
          </Link>
        )}
      </div>

      {empty ? (
        <EmptyState
          data-pattern-state="empty"
          data-documents="empty"
          icon={<Inbox />}
          title={t('emptyTitle')}
          description={t('inbox')}
          action={
            <Link href={inboxHref} data-documents-inbox="" className={buttonVariants()}>
              {t('openInbox')}
            </Link>
          }
        />
      ) : (
        <ul aria-label={t('listLabel')} className="border-line bg-surface rounded-lg border px-4">
          {list.documents.map((doc) => (
            <DocumentRow key={doc.id} doc={doc} previewHref={previewHref} />
          ))}
        </ul>
      )}

      {moreHref === null && firstHref === null ? null : (
        <nav className="flex flex-wrap gap-2" aria-label={t('listLabel')}>
          {firstHref === null ? null : (
            <Link href={firstHref} className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
              {t('newest')}
            </Link>
          )}
          {moreHref === null ? null : (
            <Link
              href={moreHref}
              data-documents-more=""
              className={buttonVariants({ variant: 'secondary', size: 'sm' })}
            >
              {t('loadMore')}
            </Link>
          )}
        </nav>
      )}
    </section>
  );
}
