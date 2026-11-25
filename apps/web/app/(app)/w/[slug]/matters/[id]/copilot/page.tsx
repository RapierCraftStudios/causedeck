// `/w/[slug]/matters/[id]/copilot` (#1115, ADR 0051): ask a question about this matter and get claims
// each with a verified quote from a fact, a document page or the judgment corpus. The
// `copilot.enabled` flag is checked first: off, the route is a plain 404. Needs `matter.read`; another
// workspace's matter is this segment's not-found screen. A sensitive matter shows that AI is off.
// #1144: a member who may write drafts gets the matter's drafts (latest version, block keys) as
// "Insert into draft" targets for verified judgment claims; loading them never fails the page.
// #1168: the matter's title, the stage and the next date (from the overview the matter layout loads)
// feed the composer's context chips and the suggested questions; without them the panel still works.
import type { Block } from '@causedeck/validators/drafting';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import {
  CopilotPanel,
  type CopilotDraftTarget,
  type CopilotMatterContext,
} from '../../../../../../../components/copilot/copilot-panel.tsx';
import { MattersPermissionDenied } from '../../../../../../../components/matters/matters-list.tsx';
import { requireWorkspaceFlag } from '../../../../../../../lib/flags.ts';
import { can } from '../../../../../../../lib/workspace-context.ts';
import { keyedBlocks } from '../../../../../../../lib/drafting/blocks-edit.ts';
import { loadMatterOverview } from '../../../../../../../lib/matters/workspace.ts';
import { getWorkspaceContext } from '../../../../../../../lib/workspace-loader.ts';
import { logger } from '../../../../../../../src/health.ts';
import { insertAuthorityAction } from '../../../drafts/[id]/authority-actions.ts';

import { askCopilotAction } from './actions.ts';

/** Drafts offered as insert targets (newest first). */
const MAX_TARGETS = 10;
const LABEL_CHARS = 80;

/** The blocks an authority can go after: headings, paragraphs and sections, labelled by their text. */
function blockOptions(blocks: readonly Block[]): CopilotDraftTarget['blocks'] {
  return keyedBlocks(blocks).flatMap(({ block, key }) => {
    const text =
      block.type === 'heading' || block.type === 'paragraph'
        ? block.text
        : block.type === 'section'
          ? (block.title ?? '')
          : '';
    const label = text.replace(/\s+/g, ' ').trim();
    if (label === '') return [];
    return [
      { key, label: label.length > LABEL_CHARS ? `${label.slice(0, LABEL_CHARS - 1)}…` : label },
    ];
  });
}

async function draftTargets(
  slug: string,
  actor: { workspaceId: string; userId: string },
  matterId: string,
): Promise<CopilotDraftTarget[]> {
  try {
    const { inWorkspace } = await import('@causedeck/core/runtime');
    const { getDraft, listDrafts } = await import('@causedeck/core/drafting');
    return await inWorkspace(actor, async (tx) => {
      const drafts = await listDrafts({ db: tx }, actor, { matterId });
      const targets: CopilotDraftTarget[] = [];
      for (const item of drafts.slice(0, MAX_TARGETS)) {
        const detail = await getDraft({ db: tx }, actor, { draftId: item.id });
        const blocks = blockOptions(detail.version.blocks);
        if (blocks.length === 0) continue;
        targets.push({
          id: item.id,
          title: item.title,
          versionId: detail.version.id,
          href: `/w/${slug}/drafts/${item.id}`,
          blocks,
        });
      }
      return targets;
    });
  } catch (error) {
    // No targets means no insert control; the copilot itself still works.
    logger.warn({ err: error }, 'matter copilot: could not load draft targets');
    return [];
  }
}

/** Title, stage and next date for the panel; undefined when the overview cannot be read. */
async function matterContextOf(
  context: NonNullable<Awaited<ReturnType<typeof getWorkspaceContext>>>,
  matterId: string,
): Promise<CopilotMatterContext | undefined> {
  try {
    const loaded = await loadMatterOverview(context, matterId);
    if (loaded.kind !== 'overview') return undefined;
    const { header, nextDate } = loaded.overview;
    return {
      title: header.title,
      stage: nextDate?.stage ?? null,
      nextDate: nextDate?.date ?? null,
    };
  } catch (error) {
    logger.warn({ err: error }, 'matter copilot: could not load the matter context');
    return undefined;
  }
}

interface CopilotPageProps {
  params: Promise<{ slug: string; id: string }>;
}

export async function generateMetadata({ params }: CopilotPageProps): Promise<Metadata> {
  const { slug, id } = await params;
  const t = await getTranslations('research.copilot');
  // Authenticated page: canonical points at itself and the page is kept out of search indexes.
  return {
    title: t('metaTitle'),
    alternates: { canonical: `/w/${slug}/matters/${id}/copilot` },
    robots: { index: false, follow: false },
  };
}

export default async function MatterCopilotPage({ params }: CopilotPageProps) {
  const { slug, id } = await params;
  const context = await getWorkspaceContext(slug);
  if (!context) notFound();
  await requireWorkspaceFlag('copilot.enabled', context);
  if (!can(context.role, 'matter.read')) return <MattersPermissionDenied />;
  const t = await getTranslations('research.copilot');
  const [drafts, matterContext] = await Promise.all([
    can(context.role, 'draft.write')
      ? draftTargets(slug, { workspaceId: context.workspace.id, userId: context.user.id }, id)
      : Promise.resolve([]),
    matterContextOf(context, id),
  ]);
  return (
    <section
      data-route="matter-copilot"
      className="flex min-w-0 flex-col gap-6"
      aria-labelledby="copilot-title"
    >
      <header className="flex flex-col gap-1">
        <h2 id="copilot-title" className="font-serif text-2xl font-medium">
          {t('title')}
        </h2>
        <p className="text-muted-foreground text-sm">{t('matterIntro')}</p>
      </header>
      <CopilotPanel
        workspaceId={context.workspace.id}
        workspaceSlug={slug}
        matterId={id}
        ask={askCopilotAction}
        {...(matterContext === undefined ? {} : { matterContext })}
        {...(drafts.length === 0 ? {} : { drafts, insert: insertAuthorityAction })}
      />
    </section>
  );
}
