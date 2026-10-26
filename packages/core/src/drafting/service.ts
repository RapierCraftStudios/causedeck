// Drafting service (#768, part 3 of #75). A draft is a template's block tree for a matter; every save
// is an immutable `draft_version` whose `content_sha256` is the sha256 of the canonical JSON of the
// blocks, so an exported version can always be reproduced. `restoreVersion` never rewinds: it saves
// the old content as the next version. Facts for the slot resolvers come from the matter-graph
// index only and are handed to the pure resolvers in `@causedeck/drafting`. `exportDraft` checks
// access and enqueues `drafting.export` (the job body is in `export.ts`); it returns the stored
// export when there is one. Draft text never reaches a log: nothing here logs.
import { createHash } from 'node:crypto';

import {
  draftNarrative,
  getPreset,
  resolveBlocks,
  validateBlockTree,
  collectNarratives,
  exportBlockers,
  type Block,
  type Facts,
  type NarrativePort,
  type NarrativeText,
  type Resolution,
} from '@causedeck/drafting';
import { isUuid, schema, type Database, type Queryable, type Transaction } from '@causedeck/db';
import type { ExportFormat, SlotResolver } from '@causedeck/validators/drafting';
import { EXPORT_FORMATS } from '@causedeck/validators/drafting';
import { and, asc, desc, eq, sql } from 'drizzle-orm';

import { getMatterOverview, listMatterProceedingsTree } from '../matter-graph/index.ts';
import type { GraphEvents, ProceedingNode } from '../matter-graph/index.ts';
import { invalid, notFound } from '../shared/errors.ts';

import {
  asDraftMember,
  draftNotFound,
  requireDraft,
  requireMatterAccess,
  type DraftActor,
} from './policy.ts';

const { draft, draftExport, draftVersion, organization, template, user } = schema;

const NO_EVENTS: GraphEvents = {
  emit() {
    // Reading facts emits nothing.
  },
};

/** Keys sorted at every level, so equal content hashes equal whatever the key order. */
export function canonicalDraftJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalDraftJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalDraftJson(v)}`).join(',')}}`;
  }
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol')
    return 'null';
  return JSON.stringify(value);
}

export const contentHash = (blocks: readonly Block[]): string =>
  createHash('sha256').update(canonicalDraftJson(blocks)).digest('hex');

export interface DraftVersionSummary {
  id: string;
  draftId: string;
  versionNo: number;
  contentSha256: string;
  createdBy: string | null;
  createdAt: Date;
}

export interface DraftSummary {
  id: string;
  templateId: string;
  matterId: string | null;
  title: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface DraftingDeps {
  db: Queryable;
  now?: () => Date;
}

/** The validated block tree of stored or submitted content; VALIDATION when it is not one. */
export function checkBlocksFor(input: unknown): Block[] {
  const parsed = validateBlockTree(input);
  if (!parsed.ok) {
    throw invalid(`Invalid draft content at ${parsed.issues[0]?.path || 'root'}`);
  }
  return parsed.blocks;
}

const versionColumns = {
  id: draftVersion.id,
  draftId: draftVersion.draftId,
  versionNo: draftVersion.versionNo,
  contentSha256: draftVersion.contentSha256,
  createdBy: draftVersion.createdBy,
  createdAt: draftVersion.createdAt,
};

async function insertVersion(
  tx: Transaction,
  actor: { workspaceId: string; userId: string },
  draftId: string,
  blocks: Block[],
): Promise<DraftVersionSummary> {
  // Serialises concurrent saves of one draft so `version_no` has no gaps or duplicates.
  await tx.execute(
    sql`select 1 from ${draft} where ${draft.workspaceId} = ${actor.workspaceId} and ${draft.id} = ${draftId} for update`,
  );
  const [last] = await tx
    .select({ n: sql<number>`coalesce(max(${draftVersion.versionNo}), 0)::int` })
    .from(draftVersion)
    .where(and(eq(draftVersion.workspaceId, actor.workspaceId), eq(draftVersion.draftId, draftId)));
  const [row] = await tx
    .insert(draftVersion)
    .values({
      workspaceId: actor.workspaceId,
      draftId,
      versionNo: (last?.n ?? 0) + 1,
      content: blocks,
      contentSha256: contentHash(blocks),
      createdBy: actor.userId,
    })
    .returning(versionColumns);
  if (row === undefined) throw new Error('saveVersion: insert returned no row');
  await tx
    .update(draft)
    .set({ updatedAt: new Date() })
    .where(and(eq(draft.workspaceId, actor.workspaceId), eq(draft.id, draftId)));
  return row;
}

export interface CreateDraftInput {
  templateId: string;
  matterId?: string | null;
  title: string;
}

/** A draft from a template (global or the workspace's own), saved as version 1. */
export async function createDraft(
  deps: DraftingDeps,
  actor: DraftActor,
  input: CreateDraftInput,
): Promise<{ draft: DraftSummary; version: DraftVersionSummary }> {
  const title = input.title.trim();
  if (title === '' || title.length > 200)
    throw invalid('A draft needs a title of up to 200 characters');
  if (!isUuid(input.templateId)) throw notFound('Template not found');
  const matterId = input.matterId ?? null;
  if (matterId !== null && !isUuid(matterId)) throw draftNotFound();
  return asDraftMember(deps.db, actor, async (tx, reader, settings) => {
    await requireMatterAccess(tx, reader, settings, matterId, 'draft.write');
    const [tpl] = await tx
      .select({ blocks: template.blocks, enabled: template.enabled })
      .from(template)
      .where(eq(template.id, input.templateId))
      .limit(1);
    if (tpl === undefined || !tpl.enabled) throw notFound('Template not found');
    const blocks = checkBlocksFor(tpl.blocks);
    const [row] = await tx
      .insert(draft)
      .values({
        workspaceId: reader.workspaceId,
        templateId: input.templateId,
        matterId,
        title,
        createdBy: reader.userId,
      })
      .returning();
    if (row === undefined) throw new Error('createDraft: insert returned no row');
    const version = await insertVersion(tx, reader, row.id, blocks);
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
      version,
    };
  });
}

/** Save `content` as the draft's next immutable version. */
export async function saveVersion(
  deps: DraftingDeps,
  actor: DraftActor,
  input: { draftId: string; content: unknown },
): Promise<DraftVersionSummary> {
  const blocks = checkBlocksFor(input.content);
  return asDraftMember(deps.db, actor, async (tx, reader, settings) => {
    await requireDraft(tx, reader, settings, input.draftId, 'draft.write');
    return insertVersion(tx, reader, input.draftId, blocks);
  });
}

/** The draft's versions, newest first; content is not part of the listing. */
export async function listVersions(
  deps: DraftingDeps,
  actor: DraftActor,
  input: { draftId: string },
): Promise<DraftVersionSummary[]> {
  return asDraftMember(deps.db, actor, async (tx, reader, settings) => {
    await requireDraft(tx, reader, settings, input.draftId, 'draft.read');
    return tx
      .select(versionColumns)
      .from(draftVersion)
      .where(
        and(
          eq(draftVersion.workspaceId, reader.workspaceId),
          eq(draftVersion.draftId, input.draftId),
        ),
      )
      .orderBy(desc(draftVersion.versionNo));
  });
}

/** Copy an earlier version's content into a new version; the old one stays as it was. */
export async function restoreVersion(
  deps: DraftingDeps,
  actor: DraftActor,
  input: { draftId: string; versionNo: number },
): Promise<DraftVersionSummary> {
  return asDraftMember(deps.db, actor, async (tx, reader, settings) => {
    await requireDraft(tx, reader, settings, input.draftId, 'draft.write');
    const [old] = await tx
      .select({ content: draftVersion.content })
      .from(draftVersion)
      .where(
        and(
          eq(draftVersion.workspaceId, reader.workspaceId),
          eq(draftVersion.draftId, input.draftId),
          eq(draftVersion.versionNo, input.versionNo),
        ),
      )
      .limit(1);
    if (old === undefined) throw notFound('Version not found');
    return insertVersion(tx, reader, input.draftId, checkBlocksFor(old.content));
  });
}

const IST_DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function flatten(nodes: readonly ProceedingNode[]): ProceedingNode[] {
  return nodes.flatMap((n) => [n, ...flatten(n.children)]);
}

/**
 * The slot facts of a matter, read through the matter-graph index as `actor` (so its visibility
 * rules apply). Anything the graph does not know is left out and resolves as missing.
 */
export async function loadDraftFacts(
  deps: DraftingDeps & { db: Database | Transaction },
  actor: DraftActor,
  matterId: string | null,
): Promise<Facts> {
  const now = deps.now?.() ?? new Date();
  const facts: Facts = { today: IST_DAY.format(now) };
  const { workspaceId, userId } = actor;
  const names = await asDraftMember(deps.db, actor, async (tx) => {
    const [org] = await tx
      .select({ name: organization.name })
      .from(organization)
      .where(eq(organization.id, workspaceId));
    const [who] = await tx.select({ name: user.name }).from(user).where(eq(user.id, userId));
    return { workspace: org?.name, advocate: who?.name };
  });
  if (names.workspace) facts.workspace = { name: names.workspace };
  if (names.advocate) facts.advocate = { name: names.advocate };
  if (matterId === null) return facts;

  const graph = { db: deps.db, events: NO_EVENTS, ...(deps.now ? { now: deps.now } : {}) };
  const overview = await getMatterOverview(graph, actor, { matterId });
  const nodes = flatten(await listMatterProceedingsTree(graph, actor, { matterId }));
  const lead = nodes.find((n) => n.id === overview.proceedings.lead?.id) ?? nodes[0];
  const petitioner = lead?.petitioner ?? overview.header.clients[0]?.name;
  facts.matter = {
    title: overview.header.title,
    ...(lead?.cnr ? { cnr: lead.cnr } : {}),
    ...(lead ? { court: lead.forum.court } : {}),
  };
  // Only a person of kind 'client' linked to this matter: never a free-text or non-client recipient.
  const client = overview.header.clients.find((c) => c.kind === 'client');
  if (client) facts.client = { name: client.name };
  facts.parties = {
    ...(petitioner ? { petitioner } : {}),
    ...(lead?.respondent ? { respondent: lead.respondent } : {}),
  };
  if (overview.nextDate) facts.hearing = { nextDate: overview.nextDate.date };
  return facts;
}

/** Narrative text per block key through the gateway port; model calls are India-only by default. */
export async function draftNarratives(
  port: NarrativePort,
  blocks: readonly Block[],
  facts: Facts,
  ctx: { workspaceId: string; userId?: string; matterId?: string; idempotencyKey?: string },
): Promise<Record<string, NarrativeText>> {
  const out: Record<string, NarrativeText> = {};
  for (const { key, block } of collectNarratives(blocks)) {
    out[key] = await draftNarrative(port, block, facts, {
      ...ctx,
      purpose: 'drafting.narrative',
      ...(ctx.idempotencyKey === undefined
        ? {}
        : { idempotencyKey: `${ctx.idempotencyKey}:${key}` }),
    });
  }
  return out;
}

export interface RenderedDraft {
  draftId: string;
  versionNo: number;
  contentSha256: string;
  blocks: Block[];
  /** Resolution of every slot block by block key, with where each value came from. */
  slots: Record<string, Resolution>;
  /** Slots that would stop an export. */
  blockers: { key: string; resolver: SlotResolver }[];
  /** Model-drafted text by block key; only when a narrative port was given. */
  narratives: Record<string, NarrativeText>;
  /** The court preset the draft's template names, if the engine has it. */
  presetKey: string | null;
}

/**
 * The draft version resolved against the matter's facts. Narrative blocks stay as prompts unless a
 * `narrativePort` is given.
 */
export async function renderDraft(
  deps: DraftingDeps & { db: Database | Transaction; narrativePort?: NarrativePort },
  actor: DraftActor,
  input: { draftId: string; versionNo?: number },
): Promise<RenderedDraft> {
  const loaded = await asDraftMember(deps.db, actor, async (tx, reader, settings) => {
    const row = await requireDraft(tx, reader, settings, input.draftId, 'draft.read');
    const versions = await tx
      .select({
        versionNo: draftVersion.versionNo,
        content: draftVersion.content,
        contentSha256: draftVersion.contentSha256,
      })
      .from(draftVersion)
      .where(
        and(eq(draftVersion.workspaceId, reader.workspaceId), eq(draftVersion.draftId, row.id)),
      )
      .orderBy(
        input.versionNo === undefined ? desc(draftVersion.versionNo) : asc(draftVersion.versionNo),
      );
    const version =
      input.versionNo === undefined
        ? versions[0]
        : versions.find((v) => v.versionNo === input.versionNo);
    if (version === undefined) throw notFound('Version not found');
    const [tpl] = await tx
      .select({ courtPreset: template.courtPreset })
      .from(template)
      .where(eq(template.id, row.templateId));
    return { row, version, courtPreset: tpl?.courtPreset ?? null };
  });
  const blocks = checkBlocksFor(loaded.version.content);
  const facts = await loadDraftFacts(deps, actor, loaded.row.matterId);
  const narratives = deps.narrativePort
    ? await draftNarratives(deps.narrativePort, blocks, facts, {
        workspaceId: actor.workspaceId,
        userId: actor.userId,
        ...(loaded.row.matterId ? { matterId: loaded.row.matterId } : {}),
      })
    : {};
  return {
    draftId: loaded.row.id,
    versionNo: loaded.version.versionNo,
    contentSha256: loaded.version.contentSha256,
    blocks,
    slots: Object.fromEntries(resolveBlocks(blocks, facts)),
    blockers: exportBlockers(blocks, facts),
    narratives,
    presetKey:
      loaded.courtPreset && getPreset(loaded.courtPreset as never) ? loaded.courtPreset : null,
  };
}

export type DraftExportRow = typeof draftExport.$inferSelect;

export interface ExportDraftDeps extends DraftingDeps {
  /** Send `drafting.export` (ids only). The jobs domain depends on this one, so the caller passes it. */
  enqueue(job: {
    workspaceId: string;
    draftVersionId: string;
    format: ExportFormat;
    userId: string;
  }): Promise<unknown>;
}

export type ExportDraftResult =
  { status: 'ready'; export: DraftExportRow } | { status: 'queued'; draftVersionId: string };

/** Check `draft.export` on the draft and enqueue the export of a version (the latest by default). */
export async function exportDraft(
  deps: ExportDraftDeps,
  actor: DraftActor,
  input: { draftId: string; versionNo?: number; format: ExportFormat },
): Promise<ExportDraftResult> {
  if (!EXPORT_FORMATS.includes(input.format)) throw invalid('Unknown export format');
  const found = await asDraftMember(deps.db, actor, async (tx, reader, settings) => {
    const row = await requireDraft(tx, reader, settings, input.draftId, 'draft.export');
    const [version] = await tx
      .select({ id: draftVersion.id })
      .from(draftVersion)
      .where(
        and(
          eq(draftVersion.workspaceId, reader.workspaceId),
          eq(draftVersion.draftId, row.id),
          ...(input.versionNo === undefined ? [] : [eq(draftVersion.versionNo, input.versionNo)]),
        ),
      )
      .orderBy(desc(draftVersion.versionNo))
      .limit(1);
    if (version === undefined) throw notFound('Version not found');
    const [existing] = await tx
      .select()
      .from(draftExport)
      .where(
        and(
          eq(draftExport.workspaceId, reader.workspaceId),
          eq(draftExport.draftVersionId, version.id),
          eq(draftExport.format, input.format),
        ),
      )
      .limit(1);
    return { versionId: version.id, existing, userId: reader.userId };
  });
  if (found.existing) return { status: 'ready', export: found.existing };
  await deps.enqueue({
    workspaceId: actor.workspaceId,
    draftVersionId: found.versionId,
    format: input.format,
    userId: found.userId,
  });
  return { status: 'queued', draftVersionId: found.versionId };
}
