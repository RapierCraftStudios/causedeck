// `/w/[slug]/matters/[id]/people` (#393, #40 part 5): the People tab. `listMatterPeople` runs in
// the member's workspace scope and decides `matter.read` per matter, so another workspace's matter,
// a restricted matter or an unknown id is this segment's not-found screen. Members with
// `matter.write` get Add person, Edit and Remove (`upsertPersonAction`, `setRoleEdgeAction`, which
// check again); for everyone else the controls are absent. States: loading (skeleton), error
// (error.tsx: `Retry` and a reference), empty (one primary action for writers), offline (the
// layout's banner; changes off) and permission-denied. In development
// `?__state=loading|error|denied|offline|empty` previews them.
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { MattersPermissionDenied } from '../../../../../../../components/matters/matters-list.tsx';
import { PeoplePanel } from '../../../../../../../components/matters/people-panel.tsx';
import { isDev } from '../../../../../../../lib/env.ts';
import type { SearchParams } from '../../../../../../../lib/matters/list-params.ts';
import { loadMatterPeople, toPeopleView } from '../../../../../../../lib/matters/people.ts';
import { can } from '../../../../../../../lib/workspace-context.ts';
import { getWorkspaceContext } from '../../../../../../../lib/workspace-loader.ts';

import { setRoleEdgeAction, upsertPersonAction } from './actions.ts';
import PeopleLoading from './loading.tsx';

interface PeoplePageProps {
  params: Promise<{ slug: string; id: string }>;
  searchParams: Promise<SearchParams>;
}

/** `?__state=…` previews a state in development. Ignored in production. */
function devState(searchParams: SearchParams): string | undefined {
  if (!isDev()) return undefined;
  const value = searchParams.__state;
  return Array.isArray(value) ? value[0] : value;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('matters.workspace');
  return { title: t('tabs.people') };
}

export default async function MatterPeoplePage({ params, searchParams }: PeoplePageProps) {
  const [{ slug, id }, query] = await Promise.all([params, searchParams]);
  const context = await getWorkspaceContext(slug);
  if (!context) notFound();

  const dev = devState(query);
  if (dev === 'loading') return <PeopleLoading />;
  if (dev === 'error') throw new Error('People error state (dev toggle)');
  if (dev === 'denied' || !can(context.role, 'matter.read')) return <MattersPermissionDenied />;

  const loaded = await loadMatterPeople(context, id);
  if (loaded.kind === 'not-found') notFound();
  if (loaded.kind === 'denied') return <MattersPermissionDenied />;
  if (loaded.kind === 'error') throw new Error('Matter people could not be loaded');

  const groups = toPeopleView(loaded.groups);
  return (
    <PeoplePanel
      workspaceId={context.workspace.id}
      matterId={id}
      groups={dev === 'empty' ? groups.map((group) => ({ ...group, people: [] })) : groups}
      canWrite={can(context.role, 'matter.write')}
      forcedOffline={dev === 'offline'}
      actions={{ upsertPerson: upsertPersonAction, setRoleEdge: setRoleEdgeAction }}
    />
  );
}
