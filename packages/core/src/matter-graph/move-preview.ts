// Read-only previews of a matter merge and a matter split (#392, #40 part 4): what the call would
// move (proceedings, documents, obligations) and whether it would refuse, before anyone confirms.
// They reuse merge-split.ts's own checks (`requireMatterPair`, `assertOpen`, `assertCompatible`),
// so access is the same (`matter.write` on every matter named; another workspace's matter is
// `CrossWorkspaceError` or NOT_FOUND) and `blocked` names exactly what the merge or split would
// refuse with CONFLICT. They select with the same predicates as `mergeMatters` and `splitMatter`,
// write nothing and emit no events.
import { schema } from '@causedeck/db';
import {
  MergeMattersInput,
  PreviewSplitMatterInput,
} from '@causedeck/validators/matter-graph-inputs';
import { and, asc, eq, inArray, or } from 'drizzle-orm';

import { invalid, WorkspaceError } from '../shared/errors.ts';

import {
  inGraphScope,
  parseInput,
  requireMatter,
  type GraphActor,
  type GraphScope,
  type MatterGraphDeps,
  type MatterRow,
} from './context.ts';
import { crossWorkspace } from './errors.ts';
import { assertCompatible, assertOpen, requireMatterPair } from './merge-split.ts';

const { document, obligation, proceeding, proceedingLink } = schema;

/** Why a merge or split would be refused. */
export type MoveBlock = 'sensitive' | 'restricted' | 'merged' | 'archived';

/** A proceeding that would move, as its case number is printed. */
export interface PreviewProceeding {
  id: string;
  /** As printed (`W.P.`), else the stored code. */
  caseType: string;
  number: string | null;
  year: number | null;
}

/** What `mergeMatters(into, from)` would move into `into`. */
export interface MovePreview {
  proceedings: PreviewProceeding[];
  documentIds: string[];
  obligationIds: string[];
  intoSensitive: boolean;
  fromSensitive: boolean;
  /** Null when the merge would go ahead. */
  blocked: MoveBlock | null;
}

/** What `splitMatter(matter, proceedingIds)` would move into the new matter. */
export interface SplitPreview {
  proceedings: PreviewProceeding[];
  obligationIds: string[];
  /** Links and parent pairs with one end on each side: kept and reported, never broken. */
  crossingLinks: number;
  /** Null when the split would go ahead. */
  blocked: Extract<MoveBlock, 'merged' | 'archived'> | null;
}

function openBlock(row: MatterRow): 'merged' | 'archived' | null {
  try {
    assertOpen(row);
    return null;
  } catch (error) {
    if (!(error instanceof WorkspaceError)) throw error;
    return row.mergedIntoMatterId !== null ? 'merged' : 'archived';
  }
}

async function compatibility(
  scope: GraphScope,
  a: MatterRow,
  b: MatterRow,
): Promise<'sensitive' | 'restricted' | null> {
  if (a.sensitive !== b.sensitive) return 'sensitive';
  try {
    await assertCompatible(scope, a, b);
    return null;
  } catch (error) {
    if (error instanceof WorkspaceError && error.code === 'CONFLICT') return 'restricted';
    throw error;
  }
}

function previewRow(row: typeof proceeding.$inferSelect): PreviewProceeding {
  return {
    id: row.id,
    caseType: row.caseTypeRaw ?? row.caseTypeCode,
    number: row.number,
    year: row.year,
  };
}

/** The preview of merging `fromMatterId` into `intoMatterId` (see `mergeMatters`). */
export async function previewMergeMatters(
  deps: MatterGraphDeps,
  actor: GraphActor,
  input: MergeMattersInput,
): Promise<MovePreview> {
  const data = parseInput(MergeMattersInput, input);
  const intoId = data.intoMatterId.toLowerCase();
  const fromId = data.fromMatterId.toLowerCase();
  return inGraphScope(deps, actor, async (scope) => {
    const { tx } = scope;
    const ws = scope.actor.workspaceId;
    const [into, from] = await requireMatterPair(scope, intoId, fromId);
    const blocked = openBlock(into) ?? openBlock(from) ?? (await compatibility(scope, into, from));
    const proceedings = await tx
      .select()
      .from(proceeding)
      .where(and(eq(proceeding.workspaceId, ws), eq(proceeding.matterId, from.id)))
      .orderBy(asc(proceeding.createdAt), asc(proceeding.id));
    const documents = await tx
      .select({ id: document.id })
      .from(document)
      .where(and(eq(document.workspaceId, ws), eq(document.matterId, from.id)))
      .orderBy(asc(document.id));
    const obligations = await tx
      .select({ id: obligation.id })
      .from(obligation)
      .where(and(eq(obligation.workspaceId, ws), eq(obligation.matterId, from.id)))
      .orderBy(asc(obligation.id));
    return {
      proceedings: proceedings.map(previewRow),
      documentIds: documents.map((row) => row.id),
      obligationIds: obligations.map((row) => row.id),
      intoSensitive: into.sensitive,
      fromSensitive: from.sensitive,
      blocked,
    };
  });
}

/** The preview of splitting `proceedingIds` out of `matterId` (see `splitMatter`). */
export async function previewSplitMatter(
  deps: MatterGraphDeps,
  actor: GraphActor,
  input: PreviewSplitMatterInput,
): Promise<SplitPreview> {
  const data = parseInput(PreviewSplitMatterInput, input);
  const ids = data.proceedingIds.map((id) => id.toLowerCase());
  return inGraphScope(deps, actor, async (scope) => {
    const { tx } = scope;
    const ws = scope.actor.workspaceId;
    const source = await requireMatter(scope, data.matterId.toLowerCase(), 'matter.write');
    const rows = await tx
      .select()
      .from(proceeding)
      .where(and(eq(proceeding.workspaceId, ws), inArray(proceeding.id, ids)))
      .orderBy(asc(proceeding.createdAt), asc(proceeding.id));
    if (rows.length !== ids.length) {
      throw crossWorkspace('Proceedings must belong to this workspace');
    }
    if (rows.some((row) => row.matterId !== source.id)) {
      throw invalid('proceedingIds must be proceedings of the matter');
    }
    const obligations = await tx
      .select({ id: obligation.id })
      .from(obligation)
      .where(
        and(
          eq(obligation.workspaceId, ws),
          eq(obligation.matterId, source.id),
          inArray(obligation.proceedingId, ids),
        ),
      )
      .orderBy(asc(obligation.id));
    const inside = new Set(ids);
    const links = await tx
      .select({ from: proceedingLink.fromProceedingId, to: proceedingLink.toProceedingId })
      .from(proceedingLink)
      .where(
        and(
          eq(proceedingLink.workspaceId, ws),
          or(
            inArray(proceedingLink.fromProceedingId, ids),
            inArray(proceedingLink.toProceedingId, ids),
          ),
        ),
      );
    const pairs = await tx
      .select({ id: proceeding.id, parentId: proceeding.parentProceedingId })
      .from(proceeding)
      .where(
        and(
          eq(proceeding.workspaceId, ws),
          or(inArray(proceeding.id, ids), inArray(proceeding.parentProceedingId, ids)),
        ),
      );
    const crossingLinks =
      links.filter((l) => inside.has(l.from) !== inside.has(l.to)).length +
      pairs.filter((p) => p.parentId !== null && inside.has(p.id) !== inside.has(p.parentId))
        .length;
    return {
      proceedings: rows.map(previewRow),
      obligationIds: obligations.map((row) => row.id),
      crossingLinks,
      blocked: openBlock(source),
    };
  });
}
