// `/w/[slug]/research` (#896, ADR 0051): fact-pattern search over the anonymised judgment corpus.
// Needs `matter.read` (the search is metered and audited per workspace by the service). `?q=` seeds
// the query (the matter's "Find authorities" action uses it); nothing runs until the member presses
// Search, so a reload never spends a search.
import { PermissionDenied } from '@causedeck/ui/patterns';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { AuthoritySearch } from '../../../../../components/research/authority-search.tsx';
import { can } from '../../../../../lib/workspace-context.ts';
import { getWorkspaceContext } from '../../../../../lib/workspace-loader.ts';

import { rerunAuthoritySearchAction, searchAuthoritiesAction } from './actions.ts';

interface ResearchPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('research.search');
  return { title: t('metaTitle') };
}

export default async function ResearchPage({ params, searchParams }: ResearchPageProps) {
  const { slug } = await params;
  const query = await searchParams;
  const context = await getWorkspaceContext(slug);
  if (!context) notFound();
  const t = await getTranslations('research.search');
  if (!can(context.role, 'matter.read')) return <PermissionDenied message={t('denied')} />;

  const { RESEARCH_SUBJECT_AREAS, RESEARCH_QUERY_MAX_CHARS } =
    await import('@causedeck/core/research');
  const seed = [query.q].flat()[0] ?? '';

  return (
    <section data-route="research" className="flex flex-col gap-6" aria-labelledby="research-search-title">
      <header className="flex flex-col gap-1">
        <h1 id="research-search-title" className="font-serif text-2xl font-medium">
          {t('title')}
        </h1>
        <p className="text-muted-foreground text-sm">{t('intro')}</p>
      </header>
      <AuthoritySearch
        workspaceId={context.workspace.id}
        initialQuery={seed.slice(0, RESEARCH_QUERY_MAX_CHARS)}
        subjectAreas={RESEARCH_SUBJECT_AREAS}
        actions={{ search: searchAuthoritiesAction, rerun: rerunAuthoritySearchAction }}
      />
    </section>
  );
}
