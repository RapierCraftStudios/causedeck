// `/w/[slug]/research/judgments/[id]` (#1191): the in-app judgment reader. Every source link in
// Research, the copilot and the drafting studio opens a stored judgment here at its pinpoint
// (`?page=N&para=M#cited`, `lib/judgment-href.ts`) instead of the stored provenance URL, which for
// bulk-imported judgments is an archive member (`….tar#member.pdf`) no browser opens. Design:
// .forge/design/research-judgment-reader/DESIGN_SPEC.md. Shows the citable header (title as
// published or masked per D-053, citation, court, date, bench) and the anonymised text per page
// (`redacted_text` only, ADR 0051); the cited paragraph is marked and carries the `cited` anchor so
// the browser scrolls it into view (the cited page when the paragraph is unknown). "Download PDF"
// appears only when the original is stored and may be served (`/api/judgments/[id]/pdf`). An
// absent or not yet redacted judgment shows the not-available state. Needs `matter.read`.
import { getJudgmentForReader, type JudgmentForReader } from '@causedeck/core';
import { buttonVariants } from '@causedeck/ui/button';
import { EmptyState } from '@causedeck/ui/empty-state';
import { PermissionDenied } from '@causedeck/ui/patterns';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { CITED_ANCHOR } from '../../../../../../../lib/judgment-href.ts';
import { can } from '../../../../../../../lib/workspace-context.ts';
import { getWorkspaceContext } from '../../../../../../../lib/workspace-loader.ts';

type Param = string | string[] | undefined;

interface ReaderPageProps {
  params: Promise<{ slug: string; id: string }>;
  searchParams: Promise<{ page?: Param; para?: Param }>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A positive integer query value, or null. */
function positive(raw: Param): number | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined || !/^\d{1,6}$/.test(value)) return null;
  const n = Number(value);
  return n > 0 ? n : null;
}

async function load(id: string): Promise<JudgmentForReader | null> {
  return UUID.test(id) ? getJudgmentForReader(id) : null;
}

/** Where the `cited` anchor goes: the cited paragraph, else the cited page, else nowhere. */
function citedTarget(
  judgment: JudgmentForReader,
  page: number | null,
  para: number | null,
): { pageNo: number; index: number | null } | null {
  const pages =
    page === null ? judgment.pages : judgment.pages.filter((p) => p.pageNo === page);
  if (para !== null) {
    for (const p of pages) {
      const index = p.paragraphs.findIndex((x) => x.number === para);
      if (index !== -1) return { pageNo: p.pageNo, index };
    }
  }
  const first = pages[0];
  return page === null || first === undefined ? null : { pageNo: first.pageNo, index: null };
}

export async function generateMetadata({ params }: ReaderPageProps): Promise<Metadata> {
  const { slug, id } = await params;
  const t = await getTranslations('research.reader');
  const judgment = await load(id);
  const title = judgment?.title ?? judgment?.neutralCitation ?? t('untitled');
  // Authenticated page: kept out of search indexes.
  return {
    title: t('metaTitle', { title }),
    alternates: { canonical: `/w/${slug}/research/judgments/${id}` },
    robots: { index: false, follow: false },
  };
}

export default async function JudgmentReaderPage({ params, searchParams }: ReaderPageProps) {
  const { slug, id } = await params;
  const query = await searchParams;
  const context = await getWorkspaceContext(slug);
  if (!context) notFound();
  const t = await getTranslations('research.reader');
  if (!can(context.role, 'matter.read')) return <PermissionDenied message={t('denied')} />;

  const back = (
    <Link className="text-muted-foreground text-sm underline" href={`/w/${slug}/research`}>
      {t('back')}
    </Link>
  );
  const judgment = await load(id);
  if (judgment === null) {
    return (
      <section data-route="research-judgment" className="flex flex-col gap-6">
        {back}
        <EmptyState
          data-slot="reader-not-found"
          title={t('notFound')}
          description={t('notFoundHint')}
        />
      </section>
    );
  }

  const target = citedTarget(judgment, positive(query.page), positive(query.para));
  const title =
    judgment.title ?? (judgment.titleMasked ? t('maskedTitle') : (judgment.neutralCitation ?? t('untitled')));
  const facts: [string, string][] = [
    [t('citation'), judgment.neutralCitation ?? ''],
    [t('caseNumbers'), judgment.caseNumbers.join(', ')],
    [t('court'), judgment.court],
    [t('decided'), judgment.judgmentDate ?? ''],
    [t('bench'), judgment.bench.join(', ')],
  ];

  return (
    <article
      data-route="research-judgment"
      className="flex flex-col gap-6"
      aria-labelledby="judgment-title"
    >
      <header className="flex flex-col gap-2" data-slot="reader-header">
        {back}
        <h1 id="judgment-title" className="font-serif text-2xl font-medium">
          {title}
        </h1>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          {facts
            .filter(([, value]) => value !== '')
            .map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="tabular-nums">{value}</dd>
              </div>
            ))}
        </dl>
        <div className="flex flex-wrap items-center gap-3">
          {judgment.hasPdf ? (
            <a
              data-slot="reader-download"
              className={buttonVariants({ variant: 'secondary', size: 'sm' })}
              href={`/api/judgments/${encodeURIComponent(judgment.id)}/pdf`}
            >
              {t('downloadPdf')}
            </a>
          ) : (
            <p className="text-muted-foreground text-xs">{t('noPdf')}</p>
          )}
          <p className="text-muted-foreground text-xs">{t('anonymised')}</p>
        </div>
      </header>

      {judgment.pages.map((page) => {
        const pageCited = target?.pageNo === page.pageNo;
        return (
          <section
            key={page.pageNo}
            id={pageCited && target?.index === null ? CITED_ANCHOR : `page-${String(page.pageNo)}`}
            data-slot="reader-page"
            data-page={page.pageNo}
            className="flex scroll-mt-4 flex-col gap-2 rounded-md border p-3"
            aria-labelledby={`reader-page-${String(page.pageNo)}`}
          >
            <h2
              id={`reader-page-${String(page.pageNo)}`}
              className="text-muted-foreground text-xs font-medium tabular-nums"
            >
              {t('page', { page: page.pageNo })}
            </h2>
            {page.paragraphs.map((p, index) => {
              const cited = pageCited && target?.index === index;
              const key = `${String(page.pageNo)}:${String(index)}`;
              return cited ? (
                <mark
                  key={key}
                  id={CITED_ANCHOR}
                  data-slot="reader-cited"
                  data-para={p.number ?? undefined}
                  className="bg-accent-soft text-ink block scroll-mt-4 rounded-md p-2 font-serif whitespace-pre-wrap"
                >
                  <span className="text-muted-foreground block font-sans text-xs">
                    {t('cited')}
                  </span>
                  {p.text}
                </mark>
              ) : (
                <p
                  key={key}
                  data-para={p.number ?? undefined}
                  className="font-serif whitespace-pre-wrap"
                >
                  {p.text}
                </p>
              );
            })}
          </section>
        );
      })}
    </article>
  );
}
