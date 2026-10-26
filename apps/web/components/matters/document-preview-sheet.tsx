'use client';
// `DocumentPreviewSheet` (#393, #40 part 5): one page of a document in a sheet, the page image
// beside the text read from it, with Previous/Next and a page number box. It is plain data in, links
// out (`pageHrefPrefix`, `closeHref`), so any screen can open it on a document at a page: the Documents
// tab today, the timeline (#41) and later screens with `documentPreviewHref` and
// `loadDocumentPreview` (lib/matters/documents*.ts). Page images come from the document pipeline
// (#45); until a page has one, a neutral "Page image not ready yet" stands in its place. The text
// keeps its line breaks and carries the page's `lang` (Tamil and Kannada shaping, screen-reader
// voice); it is rendered as text, never as HTML. Esc or Close goes to `closeHref`; Radix returns
// focus to the invoker when the sheet was opened in place. From 768 px the sheet sits at the end
// side, below that it comes up from the bottom; with reduced motion it appears without sliding.
import { Alert } from '@causedeck/ui/alert';
import { Badge } from '@causedeck/ui/badge';
import { buttonVariants } from '@causedeck/ui/button';
import { Input } from '@causedeck/ui/input';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@causedeck/ui/sheet';
import { ChevronLeft, ChevronRight, ImageOff } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useState, type SyntheticEvent } from 'react';

import type { DocumentPreviewView } from '../../lib/matters/documents.ts';

export type DocumentPreviewState =
  { kind: 'preview'; preview: DocumentPreviewView } | { kind: 'unavailable' } | { kind: 'error' };

export interface DocumentPreviewSheetProps {
  state: DocumentPreviewState;
  /**
   * The href of a page without its number: page `n` is `pageHrefPrefix + n`
   * (`documentPreviewHrefPrefix` in lib/matters/documents-tab.ts). A string, so a server page can
   * pass it.
   */
  pageHrefPrefix: string;
  /** Where Close and Esc go (the list without the preview). */
  closeHref: string;
}

/** True from 768 px: the sheet sits at the end side instead of coming up from the bottom. */
function useWide(): boolean {
  const [wide, setWide] = useState(true);
  useEffect(() => {
    const query = window.matchMedia('(min-width: 768px)');
    const sync = () => {
      setWide(query.matches);
    };
    sync();
    query.addEventListener('change', sync);
    return () => {
      query.removeEventListener('change', sync);
    };
  }, []);
  return wide;
}

function PageNavigator({
  page,
  count,
  pageHref,
}: {
  page: number;
  count: number;
  pageHref: (page: number) => string;
}) {
  const t = useTranslations('matters.workspace.documents');
  const router = useRouter();
  const id = useId();
  const [typed, setTyped] = useState(String(page));

  function onGo(event: SyntheticEvent) {
    event.preventDefault();
    const wanted = Number(typed);
    if (!Number.isInteger(wanted)) return;
    router.push(pageHref(Math.min(Math.max(wanted, 1), count)));
  }

  const linkClass = buttonVariants({ variant: 'ghost', size: 'sm' });
  return (
    <nav aria-label={t('preview.pages')} className="flex flex-wrap items-center gap-2 text-sm">
      {page > 1 ? (
        <Link href={pageHref(page - 1)} className={linkClass} data-preview-previous="">
          <ChevronLeft aria-hidden="true" />
          {t('preview.previous')}
        </Link>
      ) : null}
      <span data-preview-page={page} className="tabular-nums" aria-live="polite">
        {t('preview.pageOf', { page, count })}
      </span>
      {page < count ? (
        <Link href={pageHref(page + 1)} className={linkClass} data-preview-next="">
          {t('preview.next')}
          <ChevronRight aria-hidden="true" />
        </Link>
      ) : null}
      {count > 2 ? (
        <form noValidate className="flex items-center gap-1" onSubmit={onGo}>
          <label htmlFor={`${id}-page`} className="sr-only">
            {t('preview.goTo')}
          </label>
          <Input
            id={`${id}-page`}
            type="number"
            inputMode="numeric"
            min={1}
            max={count}
            className="w-20 tabular-nums"
            value={typed}
            onChange={(event) => {
              setTyped(event.target.value);
            }}
          />
          <button type="submit" className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
            {t('preview.go')}
          </button>
        </form>
      ) : null}
    </nav>
  );
}

function PreviewBody({
  preview,
  pageHref,
}: {
  preview: DocumentPreviewView;
  pageHref: (page: number) => string;
}) {
  const t = useTranslations('matters.workspace.documents');
  const { page, pageImage, document: doc } = preview;
  if (page === null) {
    return (
      <p data-preview="no-pages" className="text-ink-muted text-sm">
        {t('preview.noPages')}
      </p>
    );
  }
  return (
    <div className="flex min-h-0 flex-col gap-4">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone="neutral">{t(`kinds.${doc.kind}`)}</Badge>
        {doc.language === null ? null : (
          <Badge tone="outline" title={t(`languages.${doc.language}`)}>
            {doc.language}
          </Badge>
        )}
        <span className="text-ink-muted text-xs">{t(`textStatus.${doc.textStatus}`)}</span>
      </div>
      <PageNavigator
        key={page.pageNo}
        page={page.pageNo}
        count={preview.pageCount}
        pageHref={pageHref}
      />
      <div className="grid min-h-0 gap-4 lg:grid-cols-2">
        <figure
          className="flex flex-col gap-2"
          data-preview-image={pageImage === null ? 'pending' : 'ready'}
        >
          {pageImage === null ? (
            <div className="border-line bg-surface-sunken text-ink-muted flex aspect-[1/1.414] flex-col items-center justify-center gap-2 rounded-md border p-4 text-center text-sm">
              <ImageOff aria-hidden="true" className="size-6" />
              <p className="font-medium">{t('preview.imagePending')}</p>
              <p className="text-xs">{t('preview.imagePendingHint')}</p>
            </div>
          ) : (
            // A short-lived signed URL, not an asset `next/image` could optimise.
            <img
              src={pageImage.url}
              alt={t('preview.image', { page: page.pageNo })}
              className="border-line w-full rounded-md border"
            />
          )}
        </figure>
        <section aria-label={t('preview.text')} className="flex min-h-0 flex-col gap-2">
          <h3 className="text-ink-muted text-sm font-medium">{t('preview.text')}</h3>
          {page.text === null || page.text.trim() === '' ? (
            <p data-preview-text="pending" className="text-ink-muted text-sm">
              {t('preview.textPending')}
            </p>
          ) : (
            <div
              data-preview-text=""
              lang={page.lang}
              tabIndex={0}
              className="border-line max-h-[50dvh] overflow-auto rounded-md border p-3 text-sm leading-relaxed whitespace-pre-wrap"
            >
              {page.text}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

export function DocumentPreviewSheet({
  state,
  pageHrefPrefix,
  closeHref,
}: DocumentPreviewSheetProps) {
  const t = useTranslations('matters.workspace.documents');
  const pageHref = (page: number) => `${pageHrefPrefix}${String(page)}`;
  const router = useRouter();
  const wide = useWide();
  const title =
    state.kind === 'preview'
      ? t('preview.title', {
          kind: t(`kinds.${state.preview.document.kind}`),
          date: state.preview.document.added,
        })
      : t('preview.unavailable');
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) router.push(closeHref, { scroll: false });
      }}
    >
      <SheetContent
        side={wide ? 'end' : 'bottom'}
        data-slot="document-preview-sheet"
        labels={{ close: t('preview.close') }}
        className="w-full overflow-y-auto motion-reduce:animate-none md:max-w-3xl"
      >
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>{t('preview.description')}</SheetDescription>
        </SheetHeader>
        {state.kind === 'preview' ? (
          <PreviewBody preview={state.preview} pageHref={pageHref} />
        ) : (
          <Alert
            tone={state.kind === 'error' ? 'danger' : 'neutral'}
            role="status"
            data-preview={state.kind}
          >
            {state.kind === 'error' ? t('preview.failed') : t('preview.unavailable')}
          </Alert>
        )}
      </SheetContent>
    </Sheet>
  );
}
