// `/w/[slug]/matters` (#388, #40 part 2): the matters list. Rows come from `searchMatters`
// (`@causedeck/core/matter-graph`) in the member's workspace scope, filtered by
// `matterVisibilityPredicate`, so restricted matters and other workspaces' matters never reach the
// page. Everything the list shows is in the URL (lib/matters/list-params.ts): status, forum, owner,
// `No next date`, `Sensitive`, the search (title, party or case number in any punctuation), the
// sort and the keyset cursor (50 per page). Rows render as a table from 768 px and as cards below.
// `New matter` exists only for members with `matter.write` (absent, not disabled, for clerks and
// viewers); `?new=1` opens it (the palette's `New matter`).
//
// States: loading (skeleton rows), error (`Couldn't load matters.` with `Retry` and a reference),
// empty (`No matters yet`) and filtered-empty, offline (banner, New matter off) and
// permission-denied. In development `?__state=loading|error|denied|offline` previews them.
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';

import { MatterFilters } from '../../../../../components/matters/matter-filters.tsx';
import {
  MattersList,
  MattersPermissionDenied,
} from '../../../../../components/matters/matters-list.tsx';
import { MattersOfflineBanner } from '../../../../../components/matters/matters-offline-banner.tsx';
import { isDev } from '../../../../../lib/env.ts';
import {
  loadMatterFilterOptions,
  loadMatterList,
  toMatterRowView,
} from '../../../../../lib/matters/graph-deps.ts';
import {
  hasMatterFilters,
  matterListHref,
  parseMatterListState,
  toSearchMattersInput,
  type SearchParams,
} from '../../../../../lib/matters/list-params.ts';
import { can } from '../../../../../lib/workspace-context.ts';
import { getWorkspaceContext } from '../../../../../lib/workspace-loader.ts';

import { checkConflictsAction, createMatterAction } from './actions.ts';
import { AttentionBadge } from './_components/attention-badge.tsx';
import MattersLoading from './loading.tsx';

interface MattersPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<SearchParams>;
}

/** `?__state=loading|error|denied|offline` previews a state in development. Ignored in production. */
function devState(searchParams: SearchParams): string | undefined {
  if (!isDev()) return undefined;
  const value = searchParams.__state;
  return Array.isArray(value) ? value[0] : value;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('matters');
  return { title: t('metaTitle') };
}

async function pageLocale() {
  const { isLocale, DEFAULT_LOCALE } = await import('@causedeck/i18n');
  const requested = await getLocale();
  return isLocale(requested) ? requested : DEFAULT_LOCALE;
}

/** The legal-gated conflict check (#500): off unless counsel has signed off; a failed read is off. */
async function conflictCheckEnabled(
  context: NonNullable<Awaited<ReturnType<typeof getWorkspaceContext>>>,
) {
  try {
    const { isEnabled } = await import('@causedeck/flags/server');
    return await isEnabled('conflicts.check', {
      workspaceId: context.workspace.id,
      userId: context.user.id,
    });
  } catch {
    return false;
  }
}

export default async function MattersPage({ params, searchParams }: MattersPageProps) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  // The layout already checks membership; checking again keeps the page safe on its own.
  const context = await getWorkspaceContext(slug);
  if (!context) notFound();

  const dev = devState(query);
  if (dev === 'loading') return <MattersLoading />;
  if (dev === 'error') throw new Error('Matters error state (dev toggle)');
  if (dev === 'denied' || !can(context.role, 'matter.read')) return <MattersPermissionDenied />;

  const state = parseMatterListState(query);
  // The filter options do not depend on the list: load both at once.
  const [loaded, options, t, locale] = await Promise.all([
    loadMatterList(context, toSearchMattersInput(state)),
    loadMatterFilterOptions(context),
    getTranslations('matters'),
    pageLocale(),
  ]);
  if (loaded.kind === 'denied') return <MattersPermissionDenied />;
  if (loaded.kind === 'invalid' && state.cursor !== undefined) {
    // A cursor from another sort or filter set: back to the first page of this one.
    redirect(matterListHref(slug, state, { cursor: undefined }));
  }
  if (loaded.kind !== 'page') throw new Error('Matters could not be loaded');

  const now = new Date();
  const rows = loaded.page.items.map((row) => toMatterRowView(row, { slug, locale, now }));
  const filtered = hasMatterFilters(state);
  const { nextCursor } = loaded.page;
  const canWrite = can(context.role, 'matter.write');
  const conflictCheck = canWrite && (await conflictCheckEnabled(context));
  const newParam = query.new;
  const openNew = (Array.isArray(newParam) ? newParam[0] : newParam) === '1';

  let empty: 'empty' | 'filtered' | undefined;
  if (rows.length === 0 && state.cursor === undefined) empty = filtered ? 'filtered' : 'empty';

  const paging =
    nextCursor !== null || state.cursor !== undefined ? (
      <nav aria-label={t('pagination.label')} className="flex flex-wrap gap-3">
        {state.cursor === undefined ? null : (
          <Link
            href={matterListHref(slug, state, { cursor: undefined })}
            data-matters-page="first"
            className="text-accent text-sm underline-offset-4 hover:underline"
          >
            {t('pagination.first')}
          </Link>
        )}
        {nextCursor === null ? null : (
          <Link
            href={matterListHref(slug, state, { cursor: nextCursor })}
            data-matters-page="next"
            className="text-accent text-sm underline-offset-4 hover:underline"
          >
            {t('pagination.next')}
          </Link>
        )}
      </nav>
    ) : null;

  return (
    <div data-route="matters" className="flex flex-col gap-6">
      <MattersOfflineBanner forced={dev === 'offline'} />
      <MattersList
        rows={rows}
        state={state}
        slug={slug}
        workspaceId={context.workspace.id}
        canWrite={canWrite}
        empty={empty}
        openNew={openNew}
        createAction={createMatterAction}
        checkConflictsAction={conflictCheck ? checkConflictsAction : undefined}
        header={
          <div className="flex items-center justify-between gap-3">
            <h1 className="font-serif text-2xl font-medium">{t('title')}</h1>
            <AttentionBadge
              workspaceId={context.workspace.id}
              canWrite={can(context.role, 'matter.write')}
            />
          </div>
        }
        toolbar={
          empty === 'empty' ? null : (
            <MatterFilters
              state={state}
              slug={slug}
              owners={options.owners}
              forums={options.forums}
            />
          )
        }
        footer={paging}
      />
    </div>
  );
}
