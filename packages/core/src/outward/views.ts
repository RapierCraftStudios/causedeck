// Read model of the outward drafts (#736): the "Ready to send" list and one draft with its system
// and latest text. Read in the actor's workspace scope with the same matter rules as `saveEdit`
// (`draft.write` on the matter; an unreadable matter's drafts do not exist for the actor).
import { schema } from '@causedeck/db';
import type { Audience, DraftStatus, Language, Tone } from '@causedeck/validators/outward-draft';
import { and, asc, desc, eq, ne } from 'drizzle-orm';

import {
  inOutwardScope,
  notFoundDraft,
  requireOutwardMatter,
  type OutwardActor,
  type OutwardDeps,
  type OutwardScope,
} from './context.ts';

const { outwardDraft, outwardDraftVersion, matter } = schema;

const MAX_LISTED = 50;
const PREVIEW_CHARS = 240;

export interface DraftSummary {
  id: string;
  matterId: string;
  matterTitle: string;
  audience: Audience;
  language: Language;
  tone: Tone;
  status: DraftStatus;
  templateOnly: boolean;
  createdAt: string;
  /** The first characters of the latest text. */
  preview: string;
}

export interface DraftDetail extends DraftSummary {
  /** The lawyer's latest text (the system text until they edit). */
  body: string;
  /** The text the system prepared, to compare the lawyer's text with. */
  systemBody: string;
  /** The facts the system text was built from, each with its provenance. */
  facts: schema.OutwardFact[];
  versions: { id: string; author: 'system' | 'member'; createdAt: string }[];
}

type DraftRow = typeof outwardDraft.$inferSelect;

/** True when the actor may draft for the matter; false when it is not visible to them. */
async function mayDraft(scope: OutwardScope, matterId: string): Promise<boolean> {
  try {
    await requireOutwardMatter(scope, matterId, 'draft.write');
    return true;
  } catch (error) {
    if ((error as { code?: string }).code === 'NOT_FOUND') return false;
    throw error;
  }
}

async function versionsOf(scope: OutwardScope, draftId: string) {
  return scope.tx
    .select()
    .from(outwardDraftVersion)
    .where(
      and(
        eq(outwardDraftVersion.workspaceId, scope.actor.workspaceId),
        eq(outwardDraftVersion.draftId, draftId),
      ),
    )
    .orderBy(asc(outwardDraftVersion.createdAt), asc(outwardDraftVersion.id));
}

function summarize(row: DraftRow, matterTitle: string, latestBody: string): DraftSummary {
  return {
    id: row.id,
    matterId: row.matterId,
    matterTitle,
    audience: row.audience,
    language: row.language,
    tone: row.tone,
    status: row.status,
    templateOnly: row.templateOnly,
    createdAt: row.createdAt.toISOString(),
    preview: latestBody.slice(0, PREVIEW_CHARS),
  };
}

/** Drafts waiting for the lawyer (not yet shared), newest first. */
export async function listDrafts(deps: OutwardDeps, actor: OutwardActor): Promise<DraftSummary[]> {
  return inOutwardScope(deps, actor, async (scope) => {
    const rows = await scope.tx
      .select({ draft: outwardDraft, matterTitle: matter.title })
      .from(outwardDraft)
      .innerJoin(
        matter,
        and(eq(matter.workspaceId, outwardDraft.workspaceId), eq(matter.id, outwardDraft.matterId)),
      )
      .where(
        and(
          eq(outwardDraft.workspaceId, scope.actor.workspaceId),
          ne(outwardDraft.status, 'shared'),
        ),
      )
      .orderBy(desc(outwardDraft.createdAt), desc(outwardDraft.id))
      .limit(MAX_LISTED);
    const listed: DraftSummary[] = [];
    for (const { draft, matterTitle } of rows) {
      if (!(await mayDraft(scope, draft.matterId))) continue;
      const versions = await versionsOf(scope, draft.id);
      listed.push(summarize(draft, matterTitle, versions.at(-1)?.body ?? ''));
    }
    return listed;
  });
}

/** One draft with its latest and system text; NOT_FOUND for another workspace's or hidden draft. */
export async function getDraft(
  deps: OutwardDeps,
  actor: OutwardActor,
  draftId: string,
): Promise<DraftDetail> {
  return inOutwardScope(deps, actor, async (scope) => {
    const [found] = await scope.tx
      .select({ draft: outwardDraft, matterTitle: matter.title })
      .from(outwardDraft)
      .innerJoin(
        matter,
        and(eq(matter.workspaceId, outwardDraft.workspaceId), eq(matter.id, outwardDraft.matterId)),
      )
      .where(
        and(eq(outwardDraft.workspaceId, scope.actor.workspaceId), eq(outwardDraft.id, draftId)),
      )
      .limit(1);
    if (found === undefined || !(await mayDraft(scope, found.draft.matterId))) {
      throw notFoundDraft();
    }
    const versions = await versionsOf(scope, draftId);
    const system = versions.find((v) => v.author === 'system') ?? versions[0];
    const latest = versions.at(-1);
    return {
      ...summarize(found.draft, found.matterTitle, latest?.body ?? ''),
      body: latest?.body ?? '',
      systemBody: system?.body ?? '',
      facts: system?.facts ?? [],
      versions: versions.map((v) => ({
        id: v.id,
        author: v.author === 'system' ? ('system' as const) : ('member' as const),
        createdAt: v.createdAt.toISOString(),
      })),
    };
  });
}
