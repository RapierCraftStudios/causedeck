// `/w/[slug]/matters/[id]/timeline` (#41, PRD PR-2, MG-1): the Timeline tab, the matter's graph of
// proceedings beside everything that happened and is coming across them, each event with its
// provenance. Both views are derived queries (`getMatterGraph`, `getMatterTimeline`): no data is
// stored for them. They run in the member's workspace scope and need `matter.read`: another
// workspace's matter or an unknown id is this segment's not-found screen, and each kind of event
// needs its own permission (a clerk or viewer sees only the kinds their policy allows). The page
// has no mutation controls and no server actions. States: loading (skeleton), error (error.tsx:
// `Retry` and a reference), empty, offline (client banner) and permission-denied. In development
// `?__state=loading|error|denied|empty|offline` previews them. The view's own query (`p`, `k`,
// `from`, `to`, `proposed`, `mode`, `q`) is read on the client from the URL it is given here.
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { DEFAULT_LOCALE, formatDate, isLocale } from '@causedeck/i18n';

import { MattersPermissionDenied } from '../../../../../../../components/matters/matters-list.tsx';
import { TimelineWorkspace } from '../../../../../../../components/matters/timeline/timeline.tsx';
import { isDev } from '../../../../../../../lib/env.ts';
import type { SearchParams } from '../../../../../../../lib/matters/list-params.ts';
import {
  istDay,
  loadTimelineTab,
  toTimelineView,
  type SourceLabels,
  type TimelineTabLoad,
} from '../../../../../../../lib/matters/timeline.ts';
import { QUALIFIER_KEYS, isQualifier } from '../../../../../../../lib/matters/timeline-tab.ts';
import { can } from '../../../../../../../lib/workspace-context.ts';
import { getWorkspaceContext } from '../../../../../../../lib/workspace-loader.ts';

import TimelineLoading from './loading.tsx';

interface TimelinePageProps {
  params: Promise<{ slug: string; id: string }>;
  searchParams: Promise<SearchParams>;
}

/** The view's own query parameters; everything else in the URL is not the view's business. */
const VIEW_PARAMS = ['p', 'k', 'from', 'to', 'proposed', 'mode', 'q'] as const;

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
  const requested = await getLocale();
  return isLocale(requested) ? requested : DEFAULT_LOCALE;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('matterTimeline');
  return { title: t('title') };
}

export default async function MatterTimelinePage({ params, searchParams }: TimelinePageProps) {
  const [{ slug, id }, query] = await Promise.all([params, searchParams]);
  const context = await getWorkspaceContext(slug);
  if (!context) notFound();

  const dev = devState(query);
  if (dev === 'loading') return <TimelineLoading />;
  if (dev === 'error') throw new Error('Timeline error state (dev toggle)');
  if (dev === 'denied' || !can(context.role, 'matter.read')) return <MattersPermissionDenied />;

  const loaded: TimelineTabLoad = await loadTimelineTab(context, id);
  if (loaded.kind === 'not-found') notFound();
  if (loaded.kind === 'denied') return <MattersPermissionDenied />;
  if (loaded.kind === 'error') throw new Error('Matter timeline could not be loaded');

  const [t, locale] = await Promise.all([getTranslations('matterTimeline'), pageLocale()]);
  const now = new Date();
  const sourceLabels: SourceLabels = {
    manual: t('sources.manual'),
    document: t('sources.document'),
    capture: t('sources.capture'),
    adapter: t('sources.adapter'),
    ai: t('sources.ai'),
    import: t('sources.import'),
    system: t('sources.system'),
  };
  const view = toTimelineView(loaded, {
    locale,
    now,
    slug,
    matterId: id,
    sourceLabels,
    documentTitle: (kind) => (isQualifier(kind) ? t(QUALIFIER_KEYS[kind]) : kind),
  });

  const search = new URLSearchParams();
  for (const key of VIEW_PARAMS) {
    const value = single(query[key]);
    if (value !== undefined) search.set(key, value);
  }

  return (
    <TimelineWorkspace
      view={dev === 'empty' ? { ...view, events: [] } : view}
      search={search.toString()}
      todayText={formatDate(`${istDay(now)}T00:00:00+05:30`, { locale })}
      forcedOffline={dev === 'offline'}
    />
  );
}
