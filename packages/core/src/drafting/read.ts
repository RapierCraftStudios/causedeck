// Drafting read services (#824, part 0 of #79): what the studio lists and opens. Every function runs
// as the actor's active membership (`asDraftMember`) and needs `draft.read`, which a clerk lacks
// (FORBIDDEN); a draft has no separate "strategy" tag, so that gate is what keeps clerks out of
// every draft. A draft of a matter the actor cannot read is NOT_FOUND, and a list leaves it out.
// Summaries carry counts only; block text is returned by `getDraft` alone, and nothing here logs.
import type { Block } from '@causedeck/drafting';
import { isUuid, schema, type Queryable } from '@causedeck/db';
import type { CourtPreset } from '@causedeck/validators/drafting';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';

import { getMatterOverview, listMatterProceedingsTree } from '../matter-graph/index.ts';
import type { GraphEvents, ProceedingNode } from '../matter-graph/index.ts';

import {
  asDraftMember,
  draftNotFound,
  mayReadMatter,
  requireDraft,
  requireDraftAction,
  requireMatterAccess,
} from './policy.ts';
import { checkBlocksFor, type DraftSummary, type DraftVersionSummary } from './service.ts';
import type { DraftActor } from './policy.ts';

const { authority, draft, draftConsistencyReport, draftVersion, matter, template } = schema;

const NO_EVENTS: GraphEvents = {
  emit() {
    // Reading a matter's court emits nothing.
  },
};

/** How many templates `listTemplates` returns. */
export const TEMPLATE_SUGGESTIONS = 5;

export interface DraftReadDeps {
  db: Queryable;
  now?: () => Date;
}

export interface DraftListItem {
  id: string;
  title: string;
  status: string;
  matterId: string | null;
  matterTitle: string | null;
  templateId: string;
  templateName: string;
  updatedAt: Date;
  latestVersionId: string;
  latestVersionNo: number;
  citations: { verified: number; not_found: number; unknown: number };
  /** Null until a consistency report exists for the latest version. */
  consistency: { error: number; warn: number; info: number } | null;
}

export interface DraftDetail {
  draft: DraftSummary;
  version: DraftVersionSummary & { blocks: Block[] };
  versions: DraftVersionSummary[];
}

export interface TemplateSuggestion {
  id: string;
  code: string;
  name: string;
  kind: string;
  courtPreset: string;
  locale: string;
}

const COURT_KEYWORDS: readonly (readonly [string, CourtPreset])[] = [
  ['madras', 'madras_hc'],
  ['karnataka', 'karnataka_hc'],
  ['supreme', 'supreme_court'],
  ['delhi', 'delhi_hc'],
  ['bombay', 'bombay_hc'],
  ['district', 'district_court'],
];

/** The court preset a forum's court name stands for, or null when it names none we have. */
export function courtToPreset(court: string | undefined): CourtPreset | null {
  const name = court?.toLowerCase() ?? '';
  return COURT_KEYWORDS.find(([word]) => name.includes(word))?.[1] ?? null;
}

/** The order `listTemplates` shows: the matter's court first, then generic, then the rest. */
export function rankTemplates<T extends { courtPreset: string; name: string; code: string }>(
  templates: readonly T[],
  preset: CourtPreset | null,
): T[] {
  const tier = (t: T) => (t.courtPreset === preset ? 0 : t.courtPreset === 'generic' ? 1 : 2);
  return [...templates].sort(
    (a, b) => tier(a) - tier(b) || a.name.localeCompare(b.name) || a.code.localeCompare(b.code),
  );
}

const versionColumns = {
  id: draftVersion.id,
  draftId: draftVersion.draftId,
  versionNo: draftVersion.versionNo,
  contentSha256: draftVersion.contentSha256,
  createdBy: draftVersion.createdBy,
  createdAt: draftVersion.createdAt,
};

const zeroCounts = () => ({ verified: 0, not_found: 0, unknown: 0 });

function consistencyCounts(report: Record<string, unknown>): DraftListItem['consistency'] {
  const c = (report.counts ?? {}) as Record<string, unknown>;
  const n = (v: unknown) => (typeof v === 'number' ? v : 0);
  return { error: n(c.error), warn: n(c.warn), info: n(c.info) };
}

/** The workspace's drafts the actor may read, newest first; `matterId` keeps one matter's. */
export async function listDrafts(
  deps: DraftReadDeps,
  actor: DraftActor,
  input: { matterId?: string | null } = {},
): Promise<DraftListItem[]> {
  const filter = input.matterId ?? null;
  if (filter !== null && !isUuid(filter)) throw draftNotFound();
  return asDraftMember(deps.db, actor, async (tx, reader, settings) => {
    await requireMatterAccess(tx, reader, settings, filter, 'draft.read');
    const rows = await tx
      .select({
        id: draft.id,
        title: draft.title,
        status: draft.status,
        matterId: draft.matterId,
        matterTitle: matter.title,
        templateId: draft.templateId,
        templateName: template.name,
        updatedAt: draft.updatedAt,
      })
      .from(draft)
      .innerJoin(template, eq(template.id, draft.templateId))
      .leftJoin(
        matter,
        and(eq(matter.workspaceId, draft.workspaceId), eq(matter.id, draft.matterId)),
      )
      .where(
        and(
          eq(draft.workspaceId, reader.workspaceId),
          ...(filter === null ? [] : [eq(draft.matterId, filter)]),
        ),
      )
      .orderBy(desc(draft.updatedAt), asc(draft.id));

    const readable = new Map<string, boolean>();
    const visible = [];
    for (const row of rows) {
      if (row.matterId !== null && !readable.has(row.matterId)) {
        readable.set(row.matterId, await mayReadMatter(tx, reader, settings, row.matterId));
      }
      if (row.matterId === null || readable.get(row.matterId) === true) visible.push(row);
    }
    if (visible.length === 0) return [];

    const versions = await tx
      .select({
        id: draftVersion.id,
        draftId: draftVersion.draftId,
        versionNo: draftVersion.versionNo,
      })
      .from(draftVersion)
      .where(
        and(
          eq(draftVersion.workspaceId, reader.workspaceId),
          inArray(
            draftVersion.draftId,
            visible.map((r) => r.id),
          ),
        ),
      )
      .orderBy(desc(draftVersion.versionNo));
    const latest = new Map<string, { id: string; versionNo: number }>();
    for (const v of versions) if (!latest.has(v.draftId)) latest.set(v.draftId, v);
    const versionIds = [...latest.values()].map((v) => v.id);

    const citationCounts = new Map<string, ReturnType<typeof zeroCounts>>();
    const consistency = new Map<string, DraftListItem['consistency']>();
    if (versionIds.length > 0) {
      const grouped = await tx
        .select({
          versionId: authority.draftVersionId,
          status: authority.status,
          n: sql<number>`count(*)::int`,
        })
        .from(authority)
        .where(
          and(
            eq(authority.workspaceId, reader.workspaceId),
            inArray(authority.draftVersionId, versionIds),
          ),
        )
        .groupBy(authority.draftVersionId, authority.status);
      for (const g of grouped) {
        const counts = citationCounts.get(g.versionId) ?? zeroCounts();
        if (g.status === 'verified' || g.status === 'not_found' || g.status === 'unknown') {
          counts[g.status] += g.n;
        }
        citationCounts.set(g.versionId, counts);
      }
      const reports = await tx
        .select({
          versionId: draftConsistencyReport.draftVersionId,
          report: draftConsistencyReport.report,
        })
        .from(draftConsistencyReport)
        .where(
          and(
            eq(draftConsistencyReport.workspaceId, reader.workspaceId),
            inArray(draftConsistencyReport.draftVersionId, versionIds),
          ),
        )
        .orderBy(desc(draftConsistencyReport.createdAt), desc(draftConsistencyReport.id));
      for (const r of reports) {
        if (!consistency.has(r.versionId))
          consistency.set(r.versionId, consistencyCounts(r.report));
      }
    }

    return visible.flatMap((row) => {
      const v = latest.get(row.id);
      if (v === undefined) return [];
      return [
        {
          ...row,
          latestVersionId: v.id,
          latestVersionNo: v.versionNo,
          citations: citationCounts.get(v.id) ?? zeroCounts(),
          consistency: consistency.get(v.id) ?? null,
        },
      ];
    });
  });
}

/** One draft with its latest version's blocks and every version, newest first (`draft.read`). */
export async function getDraft(
  deps: DraftReadDeps,
  actor: DraftActor,
  input: { draftId: string },
): Promise<DraftDetail> {
  return asDraftMember(deps.db, actor, async (tx, reader, settings) => {
    const row = await requireDraft(tx, reader, settings, input.draftId, 'draft.read');
    const versions = await tx
      .select(versionColumns)
      .from(draftVersion)
      .where(
        and(eq(draftVersion.workspaceId, reader.workspaceId), eq(draftVersion.draftId, row.id)),
      )
      .orderBy(desc(draftVersion.versionNo));
    const [head] = versions;
    if (head === undefined) throw draftNotFound();
    const [content] = await tx
      .select({ content: draftVersion.content })
      .from(draftVersion)
      .where(and(eq(draftVersion.workspaceId, reader.workspaceId), eq(draftVersion.id, head.id)))
      .limit(1);
    return {
      draft: {
        id: row.id,
        templateId: row.templateId,
        matterId: row.matterId,
        title: row.title,
        status: row.status,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      },
      version: { ...head, blocks: checkBlocksFor(content?.content) },
      versions,
    };
  });
}

function flatten(nodes: readonly ProceedingNode[]): ProceedingNode[] {
  return nodes.flatMap((n) => [n, ...flatten(n.children)]);
}

/** The five most relevant enabled system templates, the matter's court first (`draft.read`). */
export async function listTemplates(
  deps: DraftReadDeps,
  actor: DraftActor,
  input: { matterId?: string | null } = {},
): Promise<TemplateSuggestion[]> {
  const matterId = input.matterId ?? null;
  if (matterId !== null && !isUuid(matterId)) throw draftNotFound();
  const templates = await asDraftMember(deps.db, actor, async (tx, reader, settings) => {
    await requireMatterAccess(tx, reader, settings, matterId, 'draft.read');
    requireDraftAction(reader, settings, 'draft.read');
    return tx
      .select({
        id: template.id,
        code: template.code,
        name: template.name,
        kind: template.kind,
        courtPreset: template.courtPreset,
        locale: template.locale,
      })
      .from(template)
      .where(and(eq(template.isSystem, true), eq(template.enabled, true)));
  });
  let preset: CourtPreset | null = null;
  if (matterId !== null) {
    const graph = { db: deps.db, events: NO_EVENTS, ...(deps.now ? { now: deps.now } : {}) };
    const overview = await getMatterOverview(graph, actor, { matterId });
    const nodes = flatten(await listMatterProceedingsTree(graph, actor, { matterId }));
    const lead = nodes.find((n) => n.id === overview.proceedings.lead?.id) ?? nodes[0];
    preset = courtToPreset(lead?.forum.court);
  }
  return rankTemplates(templates, preset).slice(0, TEMPLATE_SUGGESTIONS);
}
