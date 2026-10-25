// `/w/[slug]/courts/insights` (#512, D-049, D-050): court and process analytics for this
// workspace's own matters by forum and case type. Needs `insights.read`. The only filters are
// forum, case type and the date window: there is no judge or bench dimension anywhere.
import { getCourtInsights } from '@causedeck/intelligence';
import { EmptyState } from '@causedeck/ui/empty-state';
import { BarChart3 } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { CourtInsightsView } from '../../../../../../components/courts/court-insights.tsx';
import { CourtNav } from '../../../../../../components/courts/court-nav.tsx';
import { PermissionDeniedPage } from '../../../../../../components/shell/permission-denied-page.tsx';
import { can } from '../../../../../../lib/workspace-context.ts';
import { getWorkspaceContext } from '../../../../../../lib/workspace-loader.ts';

type SearchParams = Record<string, string | string[] | undefined>;

interface InsightsPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<SearchParams>;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const first = (value: string | string[] | undefined): string =>
  (Array.isArray(value) ? value[0] : value)?.trim() ?? '';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('courtInsights');
  return { title: t('metaTitle') };
}

export default async function CourtInsightsPage({ params, searchParams }: InsightsPageProps) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const context = await getWorkspaceContext(slug);
  if (!context) notFound();
  if (!can(context.role, 'insights.read')) return <PermissionDeniedPage />;

  const today = new Date().toISOString().slice(0, 10);
  const fiveYearsAgo = `${String(Number(today.slice(0, 4)) - 5)}${today.slice(4)}`;
  const from = DATE.test(first(query.from)) ? first(query.from) : fiveYearsAgo;
  const to = DATE.test(first(query.to)) ? first(query.to) : today;
  const forumId = UUID.test(first(query.forum)) ? first(query.forum) : '';
  const caseType = first(query.caseType).toUpperCase().replaceAll(/[\s.]/g, '');

  const { inWorkspace } = await import('@causedeck/core/runtime');
  const workspaceId = context.workspace.id;
  const insights = await inWorkspace({ workspaceId, userId: context.user.id }, (tx) =>
    getCourtInsights(tx, {
      from,
      to,
      forumId: forumId === '' ? undefined : forumId,
      caseTypeCode: caseType === '' ? undefined : caseType,
    }),
  );
  const t = await getTranslations('courtInsights');

  return (
    <div data-route="court-insights" className="flex flex-col gap-6">
      <CourtNav title={t('title')} />
      {insights.cells.length === 0 && forumId === '' && caseType === '' ? (
        <EmptyState icon={<BarChart3 />} title={t('empty.title')} description={t('empty.hint')} />
      ) : (
        <CourtInsightsView insights={insights} filters={{ forumId, caseType }} />
      )}
    </div>
  );
}
