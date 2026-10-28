// `/w/[slug]/matters/[id]/research` (#497, D-048): the "relevant judgments" panel. The lawyer's issue
// tags (statute, section) with confirm and dismiss for proposed ones, and the judgments that cite a
// confirmed tag, each linked to the corpus record at the page of the citation. Alerts are listed
// through `listRelevantJudgments`, which keeps only judgments `verifyCitation` resolves (D-004).
// Runs in the member's workspace scope and needs `matter.read`; another workspace's matter is
// this segment's not-found screen.
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { MattersPermissionDenied } from '../../../../../../../components/matters/matters-list.tsx';
import { can } from '../../../../../../../lib/workspace-context.ts';
import { getWorkspaceContext } from '../../../../../../../lib/workspace-loader.ts';

import { LinkOutMenu } from '../../../../../../../components/research/link-out-menu.tsx';
import { NotesList } from '../../../../../../../components/research/notes-list.tsx';

import {
  addAuthorityAction,
  createNoteAction,
  deleteNoteAction,
  removeAuthorityAction,
  setAuthorityPinnedAction,
  updateNoteAction,
} from './actions.ts';
import { ResearchTags } from './research-tags.tsx';

interface ResearchPageProps {
  params: Promise<{ slug: string; id: string }>;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('matters.workspace.research');
  return { title: t('metaTitle') };
}

export default async function MatterResearchPage({ params }: ResearchPageProps) {
  const { slug, id } = await params;
  const context = await getWorkspaceContext(slug);
  if (!context) notFound();
  if (!can(context.role, 'matter.read')) return <MattersPermissionDenied />;

  const { inWorkspace } = await import('@causedeck/core/runtime');
  const {
    listTags,
    listRelevantJudgments,
    getResearchFacts,
    listLinkProviders,
    listNotes,
    buildResearchLinks,
  } = await import('@causedeck/core/research');
  const scope = { workspaceId: context.workspace.id, userId: context.user.id };
  let loaded;
  try {
    loaded = await inWorkspace(scope, async (tx) => ({
      tags: await listTags(tx, scope, id),
      judgments: await listRelevantJudgments(tx, scope, id),
      facts: await getResearchFacts(tx, scope, id),
      providers: await listLinkProviders(tx, scope),
    }));
  } catch {
    notFound();
  }
  // Notes are memory-adjacent: a role without `memory.read` (a clerk) gets the denied state.
  const notesDenied = !can(context.role, 'memory.read');
  let notes: Awaited<ReturnType<typeof listNotes>> = [];
  let notesFailed = false;
  if (!notesDenied) {
    try {
      notes = await inWorkspace(scope, (tx) => listNotes(tx, scope, id));
    } catch {
      notesFailed = true;
    }
  }
  const links = loaded.facts.flatMap((facts) => buildResearchLinks(facts, loaded.providers));
  const uniqueLinks = links.filter(
    (link, index) => links.findIndex((other) => other.url === link.url) === index,
  );
  const t = await getTranslations('matters.workspace.research');
  const tn = await getTranslations('research.notes');

  return (
    <section className="flex flex-col gap-6" aria-labelledby="research-title">
      <header className="flex flex-col gap-1">
        <h2 id="research-title" className="text-lg font-semibold">
          {t('title')}
        </h2>
        <p className="text-muted-foreground text-sm">{t('intro')}</p>
      </header>
      <ResearchTags
        workspaceId={context.workspace.id}
        matterId={id}
        tags={loaded.tags.map((tag) => ({
          id: tag.id,
          statute: tag.statute,
          section: tag.section,
          status: tag.status,
        }))}
        canWrite={can(context.role, 'matter.write')}
      />
      <LinkOutMenu links={uniqueLinks} />
      <div className="flex flex-col gap-2">
        <h3 className="font-medium">{tn('heading')}</h3>
        <NotesList
          workspaceId={context.workspace.id}
          matterId={id}
          state={notesDenied ? 'denied' : notesFailed ? 'error' : 'ready'}
          notes={notes.map((note) => ({
            id: note.id,
            title: note.title,
            body: note.body,
            authorities: note.authorities,
          }))}
          actions={{
            create: createNoteAction,
            update: updateNoteAction,
            remove: deleteNoteAction,
            addAuthority: addAuthorityAction,
            removeAuthority: removeAuthorityAction,
            pinAuthority: setAuthorityPinnedAction,
          }}
        />
      </div>
      <div className="flex flex-col gap-2">
        <h3 className="font-medium">{t('judgmentsHeading')}</h3>
        {loaded.judgments.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t('judgmentsEmpty')}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {loaded.judgments.map((j) => (
              <li key={j.alertId} className="rounded-md border p-3 text-sm">
                <p className="font-medium">
                  {j.citation} ({j.court})
                </p>
                <p className="text-muted-foreground">
                  {t('cites', { section: j.section, statute: j.statute, page: j.pageNo })}
                </p>
                <a
                  className="underline"
                  href={`${j.sourceUrl}#page=${String(j.pageNo)}`}
                  rel="noreferrer noopener"
                  target="_blank"
                >
                  {t('open')}
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
