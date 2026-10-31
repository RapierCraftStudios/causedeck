// `/w/[slug]/updates` (#736): the update drafts waiting for the lawyer, with the open draft beside
// the list. The drafting studio (#79) owns `/drafts`. Read through `@causedeck/core/outward` in the member's workspace scope, so matter
// visibility is already applied. A role without `draft.write` (a clerk) gets the permission-denied
// explanation. In development `?__state=loading|error|denied|offline|empty` previews a state.
import { PermissionDenied } from '@causedeck/ui/patterns';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { isDev } from '../../../../../lib/env.ts';
import { can } from '../../../../../lib/workspace-context.ts';
import { getWorkspaceContext } from '../../../../../lib/workspace-loader.ts';

import { DraftsScreen } from './_components/drafts-screen.tsx';
import DraftsLoading from './loading.tsx';

type SearchParams = Record<string, string | string[] | undefined>;

interface DraftsPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<SearchParams>;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('outward');
  return { title: t('metaTitle') };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function DraftsPage({ params, searchParams }: DraftsPageProps) {
  const { slug } = await params;
  const query = await searchParams;
  const context = await getWorkspaceContext(slug);
  if (!context) notFound();
  const t = await getTranslations('outward');
  const preview = isDev() ? [query.__state].flat()[0] : undefined;
  if (preview === 'loading') return <DraftsLoading />;
  if (preview === 'error') throw new Error('Drafts preview error');
  if (preview === 'denied' || !can(context.role, 'draft.write')) {
    return <PermissionDenied message={t('denied')} />;
  }

  const scope = { workspaceId: context.workspace.id, userId: context.user.id };
  const [runtime, outward] = await Promise.all([
    import('@causedeck/core/runtime'),
    import('@causedeck/core/outward'),
  ]);
  const wanted = [query.draft].flat()[0];
  const { drafts, open } = await runtime.inWorkspace(scope, async (tx) => {
    const deps = { db: tx };
    const list = preview === 'empty' ? [] : await outward.listDrafts(deps, scope);
    const detail =
      wanted !== undefined && UUID.test(wanted)
        ? await outward.getDraft(deps, scope, wanted).catch(() => null)
        : null;
    return { drafts: list, open: detail };
  });
  return (
    <DraftsScreen
      workspaceId={context.workspace.id}
      drafts={drafts}
      open={
        open === null
          ? null
          : {
              id: open.id,
              matterId: open.matterId,
              matterTitle: open.matterTitle,
              audience: open.audience,
              language: open.language,
              body: open.body,
              systemBody: open.systemBody,
              memoryCitations: open.memoryCitations,
              facts: open.facts.map((f) => ({
                kind: f.kind,
                text: f.text,
                confirmed: f.confirmed,
                source: f.provenance.table,
              })),
            }
      }
      readOnly={false}
      forceOffline={preview === 'offline'}
    />
  );
}
