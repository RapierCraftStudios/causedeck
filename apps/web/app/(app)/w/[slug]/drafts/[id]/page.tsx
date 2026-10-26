// `/w/[slug]/drafts/[id]` (#827): the drafting studio. The server loads the draft as the signed-in
// member (`getDraft`, then `renderDraft` for the slot values and facts); a draft that does not
// exist, belongs to another workspace or is not theirs to read is `notFound()`. The editor itself
// is a lazy client chunk in studio.tsx.
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import type { DraftFact } from '../../../../../../components/drafting/facts-panel.tsx';
import { domainErrorCode } from '../../../../../../lib/matters/graph-deps.ts';
import { getWorkspaceContext } from '../../../../../../lib/workspace-loader.ts';
import { logger } from '../../../../../../src/health.ts';

import { DraftStudio } from './studio.tsx';

interface DraftPageProps {
  params: Promise<{ slug: string; id: string }>;
}

/** Older versions whose blocks are loaded for the restore preview (newest first). */
const PREVIEWED_VERSIONS = 5;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('drafting.list');
  return { title: t('title') };
}

export default async function DraftPage({ params }: DraftPageProps) {
  const { slug, id } = await params;
  const context = await getWorkspaceContext(slug);
  if (!context) notFound();
  const actor = { workspaceId: context.workspace.id, userId: context.user.id };

  let loaded;
  try {
    const { inWorkspace } = await import('@causedeck/core/runtime');
    const { getDraft, renderDraft } = await import('@causedeck/core/drafting');
    loaded = await inWorkspace(actor, async (tx) => {
      const detail = await getDraft({ db: tx }, actor, { draftId: id });
      const rendered = await renderDraft({ db: tx }, actor, { draftId: id });
      const older = [];
      for (const v of detail.versions
        .filter((entry) => entry.versionNo !== detail.version.versionNo)
        .slice(0, PREVIEWED_VERSIONS)) {
        const past = await renderDraft({ db: tx }, actor, { draftId: id, versionNo: v.versionNo });
        older.push({ versionNo: v.versionNo, blocks: past.blocks });
      }
      return { detail, rendered, older };
    });
  } catch (error) {
    const code = domainErrorCode(error);
    if (code === 'NOT_FOUND' || code === 'FORBIDDEN' || code === 'VALIDATION') notFound();
    logger.error({ err: error }, 'drafting studio: could not load the draft');
    throw error;
  }

  const { detail, rendered, older } = loaded;
  const slotValues = Object.fromEntries(
    Object.entries(rendered.slots).map(([key, resolution]) => [key, resolution.value]),
  );
  const facts: DraftFact[] = Object.entries(rendered.slots).flatMap(([key, resolution]) =>
    resolution.provenance.kind === 'fact'
      ? [
          {
            id: key,
            label: resolution.provenance.source,
            value: resolution.value,
            source: {
              kind: 'system' as const,
              label: resolution.provenance.source,
              state: 'confirmed' as const,
            },
          },
        ]
      : [],
  );

  return (
    <DraftStudio
      workspaceId={context.workspace.id}
      draftId={detail.draft.id}
      title={detail.draft.title}
      versionNo={detail.version.versionNo}
      blocks={detail.version.blocks}
      slotValues={slotValues}
      facts={facts}
      versions={detail.versions.map((v) => ({
        versionNo: v.versionNo,
        createdAt: v.createdAt.toISOString(),
        blocks:
          v.versionNo === detail.version.versionNo
            ? detail.version.blocks
            : older.find((o) => o.versionNo === v.versionNo)?.blocks,
      }))}
    />
  );
}
