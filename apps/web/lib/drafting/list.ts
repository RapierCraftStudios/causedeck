// The drafts list's server loader and view mapping (#826). `listDrafts` and `listTemplates` run in
// the member's workspace scope (`inWorkspace`), so another workspace's drafts never reach the page,
// and a clerk (no `draft.read`) gets `denied`. Draft text is never read here: only titles, the
// matter and template names and the summary counts. Nothing logs more than the error object.
import type { DraftListItem, TemplateSuggestion } from '@causedeck/core/drafting';

import type { WorkspaceContext } from '../workspace-context.ts';
import { logger } from '../../src/health.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The `?matter=` filter: a UUID, or nothing (anything else is ignored). */
export function parseMatterParam(value: string | string[] | undefined): string | null {
  const first = Array.isArray(value) ? value[0] : value;
  return first !== undefined && UUID.test(first) ? first.toLowerCase() : null;
}

export interface DraftRowView {
  id: string;
  href: string;
  title: string;
  matterId: string | null;
  matterTitle: string | null;
  templateName: string;
  updatedAt: string;
  citations: { verified: number; not_found: number; unknown: number };
  consistency: { error: number; warn: number; info: number } | null;
}

export function toDraftRowView(item: DraftListItem, slug: string): DraftRowView {
  return {
    id: item.id,
    href: `/w/${slug}/drafts/${item.id}`,
    title: item.title,
    matterId: item.matterId,
    matterTitle: item.matterTitle,
    templateName: item.templateName,
    updatedAt: item.updatedAt.toISOString(),
    citations: item.citations,
    consistency: item.consistency,
  };
}

export type DraftsLoad =
  { kind: 'page'; drafts: DraftListItem[]; templates: TemplateSuggestion[] } | { kind: 'denied' };

/** The member's drafts (optionally one matter's) and the five suggested templates. */
export async function loadDrafts(
  context: WorkspaceContext,
  matterId: string | null,
): Promise<DraftsLoad> {
  try {
    const { inWorkspace } = await import('@causedeck/core/runtime');
    const { listDrafts, listTemplates } = await import('@causedeck/core/drafting');
    const actor = { workspaceId: context.workspace.id, userId: context.user.id };
    return await inWorkspace(actor, async (tx) => {
      const deps = { db: tx };
      const [drafts, templates] = await Promise.all([
        listDrafts(deps, actor, { matterId }),
        listTemplates(deps, actor, { matterId }),
      ]);
      return { kind: 'page', drafts, templates } as const;
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'WorkspaceError' && 'code' in error) {
      if (error.code === 'FORBIDDEN') return { kind: 'denied' };
    }
    logger.error({ err: error }, 'drafts page: could not load the drafts');
    // The route error boundary renders the request id with `Try again`.
    throw error;
  }
}
