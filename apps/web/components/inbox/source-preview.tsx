'use client';
// The source of the focused card (#48): the quote read from the page, the match marked, the page
// number and a way into the full document. From 768 px it sits beside the list. The page image is
// the one the document pipeline (#45) stored, served by `/api/documents/[id]/pages/[pageNo]/image`
// (#489); a page without a stored image (or one that fails to load) shows the quote alone.
import { HighlightedQuote } from '@causedeck/ui/patterns';
import { FileText } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { documentPreviewHref } from '../../lib/matters/documents-tab.ts';
import type { InboxItemView } from '../../lib/inbox/view.ts';

export function SourcePreview({
  item,
  slug,
  workspaceId,
}: {
  item: InboxItemView | null;
  slug: string;
  workspaceId: string;
}) {
  const t = useTranslations('inbox');
  const anchor = item?.anchors[0];
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const imageUrl =
    anchor === undefined
      ? null
      : `/api/documents/${anchor.documentId}/pages/${String(anchor.page)}/image?workspaceId=${workspaceId}`;
  return (
    <aside
      aria-label={t('preview.title')}
      data-slot="source-preview"
      className="bg-surface-raised border-line hidden gap-3 self-start rounded-xl border p-4 md:sticky md:top-4 md:grid"
    >
      <h2 className="text-ink flex items-center gap-2 text-sm font-medium">
        <FileText aria-hidden="true" className="size-4" />
        {t('preview.title')}
      </h2>
      {item === null ? (
        <p className="text-ink-muted text-sm">{t('preview.empty')}</p>
      ) : anchor === undefined ? (
        <p className="text-ink-muted text-sm">{t('preview.noSource')}</p>
      ) : (
        <>
          <p className="text-ink-muted text-xs tabular-nums">
            {t('preview.page', { page: anchor.page })}
          </p>
          {imageUrl === null || failedImage === imageUrl ? null : (
            // A private, authorised route of this app, not an asset `next/image` could optimise.
            <img
              src={imageUrl}
              alt={t('preview.page', { page: anchor.page })}
              data-slot="source-image"
              loading="lazy"
              className="border-line max-h-80 w-full rounded-md border object-contain"
              onError={() => {
                setFailedImage(imageUrl);
              }}
            />
          )}
          <HighlightedQuote quote={anchor.quote} highlight={anchor.highlight ?? undefined} />
          {item.matterId === null ? null : (
            <Link
              className="text-accent text-sm underline-offset-4 hover:underline"
              href={documentPreviewHref(slug, item.matterId, anchor.documentId, anchor.page)}
            >
              {t('preview.openFull')}
            </Link>
          )}
        </>
      )}
    </aside>
  );
}
