// `/w/[slug]/people` (#848, #82 part 2): the workspace's client contacts. One read in this
// workspace's scope (`loadContacts`, over `listContacts`) gives what the role may see; the search
// (`?q=`) and the kind and language filters (`?kind=`, `?language=`) are applied over it. Each
// card shows the linked matter count and the `Not linked` flag. Owners and advocates (and a junior,
// for matters assigned to them) can add contacts; the actions check again.
//
// States: loading (skeleton), error (`error.tsx`), empty, filtered-empty, offline (banner, saving
// off) and permission-denied. In development `?__state=loading|error|denied|offline` previews them.
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { PermissionDeniedPage } from '../../../../../components/shell/permission-denied-page.tsx';
import { isDev } from '../../../../../lib/env.ts';
import {
  filterContacts,
  loadContacts,
  parseContactListState,
  toContactRowView,
  type SearchParams,
} from '../../../../../lib/people/people-deps.ts';
import { getWorkspaceContext } from '../../../../../lib/workspace-loader.ts';

import { ContactList } from './_components/contact-list.tsx';
import { createContactAction } from './actions.ts';
import PeopleLoading from './loading.tsx';

interface PeoplePageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<SearchParams>;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('people');
  return { title: t('metaTitle') };
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function PeoplePage({ params, searchParams }: PeoplePageProps) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const context = await getWorkspaceContext(slug);
  if (!context) notFound();

  const preview = isDev() ? first(query.__state) : undefined;
  if (preview === 'loading') return <PeopleLoading />;
  if (preview === 'error') throw new Error('People error state (dev toggle)');
  if (preview === 'denied') return <PermissionDeniedPage />;

  const load = await loadContacts(context);
  if (load.kind === 'denied') return <PermissionDeniedPage />;
  if (load.kind === 'error') throw new Error('Could not load the contacts');

  const state = parseContactListState(query);
  const rows = filterContacts(load.contacts, state).map((c) => toContactRowView(c, slug));
  const t = await getTranslations('people');
  const canWrite =
    context.role === 'owner' || context.role === 'advocate' || context.role === 'junior';

  return (
    <div data-route="people" className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-serif text-2xl font-medium">{t('title')}</h1>
        <p className="text-ink-muted max-w-prose text-sm">{t('description')}</p>
      </header>
      <ContactList
        slug={slug}
        workspaceId={context.workspace.id}
        contacts={rows}
        q={state.q}
        kind={state.kind}
        language={state.language}
        canWrite={canWrite}
        createAction={createContactAction}
        forceOffline={preview === 'offline'}
      />
    </div>
  );
}
