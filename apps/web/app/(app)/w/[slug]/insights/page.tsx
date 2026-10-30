// `/w/[slug]/insights` (#85, #966): the practice insights dashboard, built around the Prepared & Kept
// rate, with obligation health, preparedness and load. Every figure is computed from this workspace
// only; there is no benchmark, ranking or comparison across lawyers or workspaces, and no bench or
// judge analytics. Owner and advocates see workspace totals, a junior only their own appearances,
// clerk and viewer the denied state. The `insights.enabled` flag is checked first: off, the route
// is a plain 404 and the nav entry is hidden.
//
// States: loading (skeleton), error (`error.tsx`), empty, offline (banner, last computation) and
// permission-denied. In development `?__state=loading|error|denied|offline` previews them.
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { PermissionDeniedPage } from '../../../../../components/shell/permission-denied-page.tsx';
import { isDev } from '../../../../../lib/env.ts';
import { requireWorkspaceFlag } from '../../../../../lib/flags.ts';
import { loadInsights, parseInsightsQuery } from '../../../../../lib/insights/insights-deps.ts';
import { can } from '../../../../../lib/workspace-context.ts';
import { getWorkspaceContext } from '../../../../../lib/workspace-loader.ts';

import { PracticeReport } from './_components/practice-report.tsx';
import InsightsLoading from './loading.tsx';

interface InsightsPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('insights');
  return { title: t('metaTitle') };
}

export default async function InsightsPage({ params, searchParams }: InsightsPageProps) {
  const [{ slug }, search] = await Promise.all([params, searchParams]);
  const context = await getWorkspaceContext(slug);
  if (!context) notFound();
  await requireWorkspaceFlag('insights.enabled', context);
  if (!can(context.role, 'insights.read')) return <PermissionDeniedPage />;

  const state = isDev() ? search.__state : undefined;
  const preview = Array.isArray(state) ? state[0] : state;
  if (preview === 'loading') return <InsightsLoading />;
  if (preview === 'error') throw new Error('Insights error state (dev toggle)');
  if (preview === 'denied') return <PermissionDeniedPage />;

  const query = parseInsightsQuery(search);
  const load = await loadInsights(context, query);
  if (load.kind === 'denied') return <PermissionDeniedPage />;
  if (load.kind === 'error') throw new Error('Could not compute the practice insights');

  const t = await getTranslations('insights');
  return (
    <div data-route="insights" className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-serif text-2xl font-medium">{t('title')}</h1>
        <p className="text-ink-muted max-w-prose text-sm">{t('description')}</p>
      </header>
      <PracticeReport
        slug={slug}
        data={load.data}
        query={query}
        forceOffline={preview === 'offline'}
      />
    </div>
  );
}
