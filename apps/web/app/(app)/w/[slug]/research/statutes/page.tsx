// `/w/[slug]/research/statutes` (#1126, part 4 of #1116): search statute sections by number or
// heading (design: .forge/design/research-statutes/DESIGN_SPEC.md). A plain GET form (`?q=`), read on
// the server through `searchSections`; nothing is metered, audited or logged. Needs `matter.read`.
import { Button } from '@causedeck/ui/button';
import { ErrorState, PermissionDenied } from '@causedeck/ui/patterns';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { statutePath } from '../../../../../../components/research/section-view.tsx';
import { can } from '../../../../../../lib/workspace-context.ts';
import { getWorkspaceContext } from '../../../../../../lib/workspace-loader.ts';

import type { SectionHit } from '@causedeck/core/statutes';

interface StatutesPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: StatutesPageProps): Promise<Metadata> {
  const { slug } = await params;
  const t = await getTranslations('research.statutes');
  // Authenticated page: canonical points at itself and the page is kept out of search indexes.
  return {
    title: t('metaTitle'),
    alternates: { canonical: `/w/${slug}/research/statutes` },
    robots: { index: false, follow: false },
  };
}

export default async function StatutesPage({ params, searchParams }: StatutesPageProps) {
  const { slug } = await params;
  const query = await searchParams;
  const context = await getWorkspaceContext(slug);
  if (!context) notFound();
  const t = await getTranslations('research.statutes');
  if (!can(context.role, 'matter.read')) return <PermissionDenied message={t('denied')} />;

  const { STATUTE_QUERY_MAX_CHARS, searchSections } = await import('@causedeck/core/statutes');
  const q = ([query.q].flat()[0] ?? '').trim().slice(0, STATUTE_QUERY_MAX_CHARS);
  let hits: SectionHit[] | null = null;
  let failed = false;
  if (q !== '') {
    const { inWorkspace } = await import('@causedeck/core/runtime');
    const scope = { workspaceId: context.workspace.id, userId: context.user.id };
    try {
      hits = await inWorkspace(scope, (tx) => searchSections(tx, scope, { query: q }));
    } catch {
      failed = true;
    }
  }

  return (
    <section
      data-route="research-statutes"
      className="flex flex-col gap-6"
      aria-labelledby="statutes-title"
    >
      <header className="flex flex-col gap-1">
        <Link className="text-muted-foreground text-sm underline" href={`/w/${slug}/research`}>
          {t('back')}
        </Link>
        <h1 id="statutes-title" className="font-serif text-2xl font-medium">
          {t('title')}
        </h1>
        <p className="text-muted-foreground text-sm">{t('intro')}</p>
      </header>
      <form method="get" role="search" className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <label className="flex flex-1 flex-col gap-1 text-sm font-medium">
          {t('queryLabel')}
          <input
            className="rounded border px-2 py-1 font-normal"
            name="q"
            type="search"
            defaultValue={q}
            maxLength={STATUTE_QUERY_MAX_CHARS}
            placeholder={t('queryPlaceholder')}
            required
          />
        </label>
        <Button type="submit">{t('submit')}</Button>
      </form>
      {failed ? (
        <ErrorState title={t('error')} />
      ) : hits === null ? (
        <p className="text-muted-foreground text-sm" data-slot="statutes-prompt">
          {t('prompt')}
        </p>
      ) : hits.length === 0 ? (
        <p className="text-muted-foreground text-sm" data-slot="statutes-empty">
          {t('empty')}
        </p>
      ) : (
        <section className="flex flex-col gap-2" aria-labelledby="statutes-results-heading">
          <h2 id="statutes-results-heading" className="text-lg font-medium">
            {t('resultsHeading')}{' '}
            <span className="text-muted-foreground text-sm font-normal">
              {t('resultsCount', { count: hits.length })}
            </span>
          </h2>
          <ol className="flex flex-col gap-2" data-slot="statutes-results">
            {hits.map((hit) => (
              <li key={`${hit.statute}:${hit.section}`} className="rounded-md border p-3 text-sm">
                <Link
                  className="font-medium underline"
                  href={statutePath(slug, hit.shortName?.toLowerCase() ?? hit.statute, hit.section)}
                >
                  {t('hit', {
                    act: hit.shortName ?? hit.actTitle,
                    section: hit.section.toUpperCase(),
                  })}
                </Link>
                <p className="text-muted-foreground">{hit.heading}</p>
              </li>
            ))}
          </ol>
        </section>
      )}
    </section>
  );
}
