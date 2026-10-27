// `/w/[slug]/drafts/[id]` (#827): the drafting studio. The server loads the draft as the signed-in
// member (`getDraft`, then `renderDraft` for the slot values and facts); a draft that does not
// exist, belongs to another workspace or is not theirs to read is `notFound()`. The editor itself
// is a lazy client chunk in studio.tsx.
import type { inWorkspace } from '@causedeck/core/runtime';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import type { PinnedAuthority } from '../../../../../../components/drafting/authorities-panel.tsx';
import type { DraftFact } from '../../../../../../components/drafting/facts-panel.tsx';
import { domainErrorCode } from '../../../../../../lib/matters/graph-deps.ts';
import { getWorkspaceContext } from '../../../../../../lib/workspace-loader.ts';
import { logger } from '../../../../../../src/health.ts';

import { restoreDraftVersionAction, saveDraftAction } from './actions.ts';
import {
  acknowledgeUnverifiedAction,
  applyFixAction,
  downloadDraftExportAction,
  exportDraftAction,
  runChecksAction,
} from './checks-actions.ts';
import {
  checkFactsLiveAction,
  ignoreFactAction,
  markAssertionAction,
} from './factcheck-actions.ts';
import { DraftStudio } from './studio.tsx';

interface DraftPageProps {
  params: Promise<{ slug: string; id: string }>;
}

/** Older versions whose blocks are loaded for the restore preview (newest first). */
const PREVIEWED_VERSIONS = 5;

type WorkspaceTx = Parameters<Parameters<typeof inWorkspace>[1]>[0];

/**
 * The authorities pinned on the draft's matter notes. Reading notes needs more than reading the
 * draft (`memory.read`, matter visibility), so a refusal means no panel entries, never a failed page.
 */
async function pinnedAuthorities(
  tx: WorkspaceTx,
  actor: { workspaceId: string; userId: string },
  matterId: string | null,
): Promise<PinnedAuthority[]> {
  if (matterId === null) return [];
  try {
    const { listNotes } = await import('@causedeck/core/research');
    const notes = await listNotes(tx, actor, matterId);
    return notes.flatMap((note) =>
      note.authorities.flatMap((authority, index) =>
        authority.pinned
          ? [
              {
                id: `${note.id}.${String(index)}`,
                label: authority.label,
                citation: authority.citation,
              },
            ]
          : [],
      ),
    );
  } catch (error) {
    const code = domainErrorCode(error);
    if (code === 'NOT_FOUND' || code === 'FORBIDDEN' || code === 'VALIDATION') return [];
    throw error;
  }
}

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
    const { exportBlockedByCitations, getCitationReport, getDraft, listFindings, renderDraft } =
      await import('@causedeck/core/drafting');
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
      const versionId = detail.version.id;
      const report = await getCitationReport({ db: tx }, actor, { draftVersionId: versionId });
      const gate = await exportBlockedByCitations(
        tx,
        actor.workspaceId,
        versionId,
        detail.version.blocks,
      );
      const found = await listFindings({ db: tx }, actor, { draftVersionId: versionId });
      const authorities = await pinnedAuthorities(tx, actor, detail.draft.matterId);
      return { detail, rendered, older, authorities, report, gate, found };
    });
  } catch (error) {
    const code = domainErrorCode(error);
    if (code === 'NOT_FOUND' || code === 'FORBIDDEN' || code === 'VALIDATION') notFound();
    logger.error({ err: error }, 'drafting studio: could not load the draft');
    throw error;
  }

  const { detail, rendered, older, authorities, report, gate, found } = loaded;
  const slotValues = Object.fromEntries(
    Object.entries(rendered.slots).map(([key, resolution]) => [key, resolution.value]),
  );
  // Model-written narrative text, when the render produced any (no model call is made on page load).
  const aiTexts = Object.fromEntries(
    Object.entries(rendered.narratives).flatMap(([key, n]) =>
      n.modelDrafted ? [[key, n.text]] : [],
    ),
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
      actions={{ save: saveDraftAction, restore: restoreDraftVersionAction }}
      workspaceId={context.workspace.id}
      draftId={detail.draft.id}
      title={detail.draft.title}
      versionNo={detail.version.versionNo}
      blocks={detail.version.blocks}
      slotValues={slotValues}
      aiTexts={aiTexts}
      facts={facts}
      factCheck={{
        matterId: detail.draft.matterId,
        actions: {
          check: checkFactsLiveAction,
          ignore: ignoreFactAction,
          assert: markAssertionAction,
        },
      }}
      checks={{
        actions: {
          run: runChecksAction,
          acknowledge: acknowledgeUnverifiedAction,
          fix: applyFixAction,
          exportDraft: exportDraftAction,
          download: downloadDraftExportAction,
        },
        versionId: detail.version.id,
        citations: report.items.map((c) => ({
          id: c.id,
          blockId: c.blockId,
          raw: c.raw,
          status: c.status,
          title: c.title,
          acknowledged: c.status === 'not_found' && !gate.unacknowledged.includes(c.id),
        })),
        findings: found,
        checked: report.items.length > 0 || found.length > 0,
        courtPreset: null,
        aiAssisted: Object.keys(aiTexts).length > 0,
      }}
      authorities={authorities}
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
