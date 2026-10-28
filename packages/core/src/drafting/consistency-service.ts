// Draft consistency (#78, DR-3). `loadConsistencyFacts` reads the matter's names, case numbers,
// listing and order dates and annexure documents through the matter-graph index as the actor (so its
// visibility rules apply) and hands them to the pure `checkDraft` in `@causedeck/drafting`.
// `runConsistencyCheck` stores one report per (draft version, graph revision): the same inputs return
// the stored row, and a new listing or order changes the revision and so gets a new one. Nothing is
// ever applied by the checker: `applyFix` needs the literal `confirm: true` and saves a new draft
// version (L2). Report content is privileged: nothing here logs a span, a name or any draft text.
import { createHash } from 'node:crypto';

import {
  checkDraft,
  EMPTY_FACTS,
  walkBlocks,
  type AnnexureFact,
  type ConsistencyFacts,
  type DateFact,
  type PartyFact,
  type ProceedingFact,
} from '@causedeck/drafting';
import { schema, type Database, type Transaction } from '@causedeck/db';
import {
  ApplyFixRequestSchema,
  ConsistencyReportSchema,
  type ConsistencyReport,
  type Finding,
  type FindingProvenance,
} from '@causedeck/validators/consistency';
import { and, desc, eq } from 'drizzle-orm';

import { record } from '../audit/index.ts';
import {
  getMatterTimeline,
  listMatterDocuments,
  listMatterPeople,
  listMatterProceedingsTree,
  type GraphEvents,
  type MatterDocumentRow,
  type ProceedingNode,
} from '../matter-graph/index.ts';
import { conflict, invalid, notFound, WorkspaceError } from '../shared/errors.ts';

import { asDraftMember, requireDraft, type DraftActor } from './policy.ts';
import {
  canonicalDraftJson,
  checkBlocksFor,
  insertVersion,
  type DraftingDeps,
  type DraftVersionSummary,
} from './service.ts';

const { draftConsistencyReport, draftVersion } = schema;

const NO_EVENTS: GraphEvents = {
  emit() {
    // Reading facts emits nothing.
  },
};

type Deps = DraftingDeps & { db: Database | Transaction };

const provenance = (fact: string, sourceType: string, sourceRef: string | null = null) =>
  ({ fact, sourceType, sourceRef, anchorId: null }) satisfies FindingProvenance;

const flatten = (nodes: readonly ProceedingNode[]): ProceedingNode[] =>
  nodes.flatMap((n) => [n, ...flatten(n.children)]);

/** The Nth `annexure` document of the matter, oldest first, is Annexure P-N. */
function annexuresOf(rows: readonly MatterDocumentRow[]): AnnexureFact[] {
  return rows
    .filter((d) => d.kind === 'annexure')
    .sort(
      (a, b) =>
        a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    )
    .map((d, i) => ({ n: i + 1, provenance: provenance('document.annexure', 'document', d.id) }));
}

export async function loadConsistencyFacts(
  deps: Deps,
  actor: DraftActor,
  matterId: string | null,
): Promise<ConsistencyFacts> {
  if (matterId === null) return EMPTY_FACTS;
  const graph = { db: deps.db, events: NO_EVENTS, ...(deps.now ? { now: deps.now } : {}) };
  const input = { matterId };
  // One after the other: the reads share the caller's transaction.
  const people = await listMatterPeople(graph, actor, input);
  const tree = await listMatterProceedingsTree(graph, actor, input);
  const timeline = await getMatterTimeline(graph, actor, { matterId, kinds: ['listing', 'order'] });
  const nodes = flatten(tree);
  const parties: PartyFact[] = [];
  for (const group of people) {
    for (const edge of group.edges) {
      parties.push({
        role: 'other',
        name: edge.person.name,
        aliases: edge.person.aliases,
        provenance: provenance('party.person', edge.provenance.sourceType),
      });
    }
  }
  const proceedings: ProceedingFact[] = [];
  for (const n of nodes) {
    const source = provenance('proceeding.party', 'matter_graph', n.id);
    if (n.petitioner) {
      parties.push({ role: 'petitioner', name: n.petitioner, aliases: [], provenance: source });
    }
    if (n.respondent) {
      parties.push({ role: 'respondent', name: n.respondent, aliases: [], provenance: source });
    }
    if (n.number !== null && n.year !== null) {
      proceedings.push({
        caseTypeCode: n.caseTypeCode,
        caseTypeRaw: n.caseType,
        number: n.number,
        year: n.year,
        provenance: provenance('proceeding.case_number', 'matter_graph', n.id),
      });
    }
  }
  const listingDates: DateFact[] = [];
  const orderDates: DateFact[] = [];
  for (const e of timeline) {
    const p = provenance(`${e.kind}.date`, e.provenance.sourceType, e.provenance.sourceRef);
    const fact = { iso: e.date, provenance: { ...p, anchorId: e.anchorId } };
    if (e.kind === 'listing') listingDates.push(fact);
    else if (e.kind === 'order') orderDates.push(fact);
  }
  let annexures: AnnexureFact[] | null = [];
  try {
    const rows: MatterDocumentRow[] = [];
    let cursor: string | undefined;
    do {
      const page = await listMatterDocuments(graph, actor, {
        matterId,
        limit: 100,
        ...(cursor === undefined ? {} : { cursor }),
      });
      rows.push(...page.items);
      cursor = page.nextCursor ?? undefined;
    } while (cursor !== undefined);
    annexures = annexuresOf(rows);
  } catch (error) {
    // Not allowed to list documents: say nothing about annexures rather than call them all missing.
    if (!(error instanceof WorkspaceError) || error.code !== 'FORBIDDEN') throw error;
    annexures = null;
  }
  return { parties, proceedings, listingDates, orderDates, annexures };
}

/** The sha256 of the canonical facts: a new listing, order, name or document changes it. */
export const graphRevision = (facts: ConsistencyFacts): string =>
  createHash('sha256').update(canonicalDraftJson(facts)).digest('hex');

export type StoredReport = ConsistencyReport & { id: string; createdAt: Date };

function toReport(row: typeof draftConsistencyReport.$inferSelect): StoredReport {
  const parsed = ConsistencyReportSchema.safeParse(row.report);
  if (!parsed.success) throw new Error('consistency report row is malformed');
  return { ...parsed.data, id: row.id, createdAt: row.createdAt };
}

async function versionOf(
  tx: Transaction,
  reader: Parameters<typeof requireDraft>[1],
  settings: Parameters<typeof requireDraft>[2],
  draftVersionId: string,
  action: 'draft.read' | 'draft.write',
) {
  const [version] = await tx
    .select({ id: draftVersion.id, draftId: draftVersion.draftId, content: draftVersion.content })
    .from(draftVersion)
    .where(
      and(eq(draftVersion.workspaceId, reader.workspaceId), eq(draftVersion.id, draftVersionId)),
    )
    .limit(1);
  if (version === undefined) throw notFound('Version not found');
  const row = await requireDraft(tx, reader, settings, version.draftId, action);
  return { version, matterId: row.matterId };
}

/** Check one draft version against the matter graph; returns the stored report when one exists. */
export async function runConsistencyCheck(
  deps: Deps,
  actor: DraftActor,
  input: { draftVersionId: string },
): Promise<StoredReport> {
  const target = await asDraftMember(deps.db, actor, (tx, reader, settings) =>
    versionOf(tx, reader, settings, input.draftVersionId, 'draft.read'),
  );
  const blocks = checkBlocksFor(target.version.content);
  const facts = await loadConsistencyFacts(deps, actor, target.matterId);
  const revision = graphRevision(facts);
  return asDraftMember(deps.db, actor, async (tx, reader) => {
    const where = and(
      eq(draftConsistencyReport.workspaceId, reader.workspaceId),
      eq(draftConsistencyReport.draftVersionId, input.draftVersionId),
      eq(draftConsistencyReport.graphRevision, revision),
    );
    const [existing] = await tx.select().from(draftConsistencyReport).where(where).limit(1);
    if (existing) return toReport(existing);
    const { findings, counts } = checkDraft({ blocks, facts });
    const report: ConsistencyReport = {
      draftVersionId: input.draftVersionId,
      graphRevision: revision,
      findings,
      counts,
    };
    const [inserted] = await tx
      .insert(draftConsistencyReport)
      .values({
        workspaceId: reader.workspaceId,
        draftVersionId: input.draftVersionId,
        graphRevision: revision,
        report,
      })
      .onConflictDoNothing()
      .returning();
    if (inserted) return toReport(inserted);
    const [raced] = await tx.select().from(draftConsistencyReport).where(where).limit(1);
    if (raced === undefined) throw new Error('consistency report vanished after conflict');
    return toReport(raced);
  });
}

/** The newest stored report of a version, or null when none was computed yet. */
export async function getConsistencyReport(
  deps: DraftingDeps,
  actor: DraftActor,
  input: { draftVersionId: string },
): Promise<StoredReport | null> {
  return asDraftMember(deps.db, actor, async (tx, reader, settings) => {
    await versionOf(tx, reader, settings, input.draftVersionId, 'draft.read');
    const [row] = await tx
      .select()
      .from(draftConsistencyReport)
      .where(
        and(
          eq(draftConsistencyReport.workspaceId, reader.workspaceId),
          eq(draftConsistencyReport.draftVersionId, input.draftVersionId),
        ),
      )
      .orderBy(desc(draftConsistencyReport.createdAt), desc(draftConsistencyReport.id))
      .limit(1);
    return row ? toReport(row) : null;
  });
}

/** The findings of the newest report, optionally of one severity. */
export async function listFindings(
  deps: DraftingDeps,
  actor: DraftActor,
  input: { draftVersionId: string; severity?: Finding['severity'] },
): Promise<Finding[]> {
  const report = await getConsistencyReport(deps, actor, input);
  const all = report?.findings ?? [];
  return input.severity === undefined ? all : all.filter((f) => f.severity === input.severity);
}

/**
 * Replace the finding's span with the graph value as a new draft version. Only with `confirm: true`;
 * the span must still hold the text the finding saw, else the fix is stale and refused.
 */
export async function applyFix(
  deps: DraftingDeps,
  actor: DraftActor,
  input: { draftVersionId: string; findingId: string; confirm: unknown },
): Promise<DraftVersionSummary> {
  const parsed = ApplyFixRequestSchema.safeParse(input);
  if (!parsed.success) throw invalid('A fix needs explicit confirmation');
  const request = parsed.data;
  return asDraftMember(deps.db, actor, async (tx, reader, settings) => {
    const { version } = await versionOf(
      tx,
      reader,
      settings,
      request.draftVersionId,
      'draft.write',
    );
    const [row] = await tx
      .select()
      .from(draftConsistencyReport)
      .where(
        and(
          eq(draftConsistencyReport.workspaceId, reader.workspaceId),
          eq(draftConsistencyReport.draftVersionId, request.draftVersionId),
        ),
      )
      .orderBy(desc(draftConsistencyReport.createdAt), desc(draftConsistencyReport.id))
      .limit(1);
    const finding = row
      ? toReport(row).findings.find((f) => f.id === request.findingId)
      : undefined;
    if (finding === undefined) throw notFound('Finding not found');
    if (finding.fix === undefined) throw invalid('This finding has no fix to apply');
    const blocks = structuredClone(checkBlocksFor(version.content));
    const state = { applied: false };
    walkBlocks(blocks, ({ block, key }) => {
      if (state.applied || key !== finding.span.blockKey) return;
      const { start, end } = finding.span;
      const field =
        block.type === 'heading' || block.type === 'paragraph'
          ? 'text'
          : block.type === 'section'
            ? 'title'
            : undefined;
      const text = field === undefined ? undefined : (block as Record<string, unknown>)[field];
      if (
        field === undefined ||
        typeof text !== 'string' ||
        text.slice(start, end) !== finding.found
      ) {
        return;
      }
      (block as Record<string, unknown>)[field] =
        text.slice(0, start) + (finding.fix?.replacement ?? '') + text.slice(end);
      state.applied = true;
    });
    if (!state.applied) throw conflict('The draft changed since the check; run it again');
    const saved = await insertVersion(tx, reader, version.draftId, blocks);
    await record(
      { db: tx, workspaceId: reader.workspaceId, actor: { userId: reader.userId, kind: 'user' } },
      {
        action: 'draft.fix_applied',
        target: { kind: 'draft_version', id: saved.id },
        metadata: {
          rule: finding.rule,
          fromVersionId: version.id,
          versionHash: saved.contentSha256,
        },
      },
    );
    return saved;
  });
}
