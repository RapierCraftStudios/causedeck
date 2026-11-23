// `/w/[slug]/research/statutes/[act]/[section]` (#1126, part 4 of #1116): one statute section, its
// history, its counterpart and the judgments that cite it (design: .forge/design/research-statutes/
// DESIGN_SPEC.md). `[act]` is a short name (`bnss`) or a statute key; the service normalises both.
// Needs `matter.read`; an act or section that is not stored is a 404.
import { ErrorState, PermissionDenied } from '@causedeck/ui/patterns';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { SectionView } from '../../../../../../../../components/research/section-view.tsx';
import { can } from '../../../../../../../../lib/workspace-context.ts';
import { getWorkspaceContext } from '../../../../../../../../lib/workspace-loader.ts';

import { getSectionAction } from '../../actions.ts';

interface SectionPageProps {
  params: Promise<{ slug: string; act: string; section: string }>;
}

function decoded(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export async function generateMetadata({ params }: SectionPageProps): Promise<Metadata> {
  const { slug, act, section } = await params;
  const t = await getTranslations('research.statutes');
  // Authenticated page: canonical points at itself and the page is kept out of search indexes.
  return {
    title: t('section.metaTitle', {
      act: decoded(act).toUpperCase(),
      section: decoded(section).toUpperCase(),
    }),
    alternates: { canonical: `/w/${slug}/research/statutes/${act}/${section}` },
    robots: { index: false, follow: false },
  };
}

export default async function StatuteSectionPage({ params }: SectionPageProps) {
  const { slug, act, section } = await params;
  const context = await getWorkspaceContext(slug);
  if (!context) notFound();
  const t = await getTranslations('research.statutes');
  if (!can(context.role, 'matter.read')) return <PermissionDenied message={t('denied')} />;

  const result = await getSectionAction({
    workspaceId: context.workspace.id,
    act: decoded(act),
    section: decoded(section),
  });
  if (!result.ok && result.error.code === 'NOT_FOUND') notFound();

  return (
    <section
      data-route="research-statute-section"
      className="flex flex-col gap-6"
      aria-labelledby="statute-section-title"
    >
      <header className="flex flex-col gap-1">
        <Link className="text-muted-foreground text-sm underline" href={`/w/${slug}/research/statutes`}>
          {t('backToSearch')}
        </Link>
        <h1 id="statute-section-title" className="font-serif text-2xl font-medium">
          {result.ok
            ? t('section.title', {
                act: result.data.section.act.shortName ?? result.data.section.act.title,
                section: result.data.section.section.toUpperCase(),
                heading: result.data.section.heading,
              })
            : t('title')}
        </h1>
        {result.ok ? (
          <p className="text-muted-foreground text-sm">{result.data.section.act.title}</p>
        ) : null}
      </header>
      {result.ok ? (
        <SectionView
          slug={slug}
          section={result.data.section}
          history={result.data.history}
          authorities={result.data.authorities}
        />
      ) : (
        <ErrorState title={t('error')} />
      )}
    </section>
  );
}
