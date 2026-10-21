// Proceeding services (#362, part 1 of #33): create, correct identifiers, link, and the duplicate
// finder. A proceeding's matter decides access: `matter.write` to change it, `matter.read` to find
// it. Case types, numbers and two-digit years are normalised before they are stored or compared
// (duplicates.ts). A link names two proceedings; when either is not in the actor's workspace the
// call fails with `CrossWorkspaceError` and nothing is written. No query here reads judges or
// benches: the graph never aggregates by judge (PX-9, ME-6).
import { can } from '@causedeck/auth/policy';
import { matterVisibilityPredicate } from '@causedeck/auth/policy/visibility';
import { schema } from '@causedeck/db';
import {
  CreateProceedingInput,
  FindDuplicateProceedingsInput,
  LinkProceedingsInput,
  UpdateIdentifiersInput,
} from '@causedeck/validators/matter-graph-inputs';
import { and, asc, eq, inArray, isNull, ne, or, sql, type SQL } from 'drizzle-orm';

import { conflict, invalid } from '../shared/errors.ts';

import {
  inGraphScope,
  loadProceeding,
  parseInput,
  pgError,
  requireMatter,
  type GraphActor,
  type MatterGraphDeps,
  type ProceedingRow,
} from './context.ts';
import {
  expandYear,
  identityKey,
  isSameProceeding,
  normaliseCaseNumber,
  normaliseCaseType,
  rowIdentity,
} from './duplicates.ts';
import { crossWorkspace, graphNotFound } from './errors.ts';

const { forum, matter, member, proceeding, proceedingLink } = schema;

export type { ProceedingRow };
export type ProceedingLinkRow = typeof proceedingLink.$inferSelect;

/** The database's verdict on a proceeding write, as a domain error. */
function proceedingWriteError(error: unknown): unknown {
  const { code, constraint } = pgError(error);
  if (code === '23505') {
    return conflict(
      constraint === 'proceeding_cnr_uq'
        ? 'A proceeding with this CNR already exists'
        : 'A proceeding with this case number already exists',
    );
  }
  if (code === '23503') {
    return constraint === 'proceeding_anchor_fk'
      ? invalid('provenance.anchorId: anchor not found')
      : graphNotFound('forum');
  }
  if (code === '23514') return invalid('The proceeding identifiers are not consistent');
  return error;
}

/** A proceeding of a matter the actor may write; emits `proceeding.created`. */
export async function createProceeding(
  deps: MatterGraphDeps,
  actor: GraphActor,
  input: CreateProceedingInput,
): Promise<ProceedingRow> {
  const data = parseInput(CreateProceedingInput, input);
  const caseTypeCode = normaliseCaseType(data.caseType);
  return inGraphScope(deps, actor, async (scope) => {
    const { tx } = scope;
    const { workspaceId } = scope.actor;
    const owning = await requireMatter(scope, data.matterId, 'matter.write');
    const [visibleForum] = await tx
      .select({ id: forum.id })
      .from(forum)
      .where(
        and(
          eq(forum.id, data.forumId),
          or(isNull(forum.workspaceId), eq(forum.workspaceId, workspaceId)),
        ),
      )
      .limit(1);
    if (visibleForum === undefined) throw graphNotFound('forum');
    if (data.parentProceedingId != null) {
      const [parent] = await tx
        .select({ matterId: proceeding.matterId })
        .from(proceeding)
        .where(
          and(eq(proceeding.workspaceId, workspaceId), eq(proceeding.id, data.parentProceedingId)),
        )
        .limit(1);
      if (parent === undefined) throw crossWorkspace('Parent proceeding not found');
      if (parent.matterId !== data.matterId) {
        throw invalid('parentProceedingId must be a proceeding of the same matter');
      }
    }
    const { provenance } = data;
    let row: ProceedingRow | undefined;
    try {
      [row] = await tx
        .insert(proceeding)
        .values({
          workspaceId,
          matterId: data.matterId,
          forumId: data.forumId,
          kind: data.kind ?? 'main',
          caseTypeCode,
          caseTypeRaw: data.caseType,
          number: data.number == null ? null : normaliseCaseNumber(data.number),
          year: data.year == null ? null : expandYear(data.year),
          srNo: data.srNo ?? null,
          frNo: data.frNo ?? null,
          diaryNo: data.diaryNo ?? null,
          filingNo: data.filingNo ?? null,
          cnr: data.cnr ?? null,
          filingDate: data.filingDate ?? null,
          parentProceedingId: data.parentProceedingId ?? null,
          titlePetitioner: data.titlePetitioner ?? null,
          titleRespondent: data.titleRespondent ?? null,
          sourceType: provenance.sourceType,
          sourceRef: provenance.sourceRef ?? null,
          anchorId: provenance.anchorId ?? null,
          confidence: provenance.confidence ?? null,
          ...(provenance.confirmationState === undefined
            ? {}
            : { confirmationState: provenance.confirmationState }),
          ...(provenance.capturedAt === undefined ? {} : { capturedAt: provenance.capturedAt }),
        })
        .returning();
    } catch (error) {
      throw proceedingWriteError(error);
    }
    if (!row) throw new Error('createProceeding: insert returned no row');
    scope.emit({
      type: 'proceeding.created',
      workspaceId,
      actorUserId: scope.actor.userId,
      matterId: owning.id,
      sensitive: owning.sensitive,
      proceedingId: row.id,
    });
    return row;
  });
}

/** Correct a proceeding's identifiers (normalised as on create); emits the changed keys. */
export async function updateIdentifiers(
  deps: MatterGraphDeps,
  actor: GraphActor,
  input: UpdateIdentifiersInput,
): Promise<ProceedingRow> {
  const { proceedingId, caseType, ...rest } = parseInput(UpdateIdentifiersInput, input);
  const changes: Partial<ProceedingRow> = {};
  if (caseType !== undefined) {
    changes.caseTypeCode = normaliseCaseType(caseType);
    changes.caseTypeRaw = caseType;
  }
  if (rest.number !== undefined) {
    changes.number = rest.number === null ? null : normaliseCaseNumber(rest.number);
  }
  if (rest.year !== undefined) changes.year = rest.year === null ? null : expandYear(rest.year);
  for (const key of ['cnr', 'srNo', 'frNo', 'diaryNo', 'filingNo'] as const) {
    const value = rest[key];
    if (value !== undefined) changes[key] = value;
  }
  return inGraphScope(deps, actor, async (scope) => {
    const { tx } = scope;
    const { workspaceId } = scope.actor;
    const current = await loadProceeding(tx, workspaceId, proceedingId);
    const owning = await requireMatter(scope, current.matterId, 'matter.write');
    let row: ProceedingRow | undefined;
    try {
      [row] = await tx
        .update(proceeding)
        .set({ ...changes, updatedAt: new Date() })
        .where(and(eq(proceeding.workspaceId, workspaceId), eq(proceeding.id, proceedingId)))
        .returning();
    } catch (error) {
      throw proceedingWriteError(error);
    }
    if (!row) throw new Error('updateIdentifiers: update returned no row');
    scope.emit({
      type: 'proceeding.identifiers_updated',
      workspaceId,
      actorUserId: scope.actor.userId,
      matterId: owning.id,
      sensitive: owning.sensitive,
      proceedingId,
      changed: Object.keys(changes).sort(),
    });
    return row;
  });
}

/**
 * Link two proceedings of the actor's workspace. `CrossWorkspaceError` when either is not in it
 * (another workspace's proceeding is invisible under RLS); `matter.write` on both matters; CONFLICT
 * for an existing link or a `parent_of` cycle. Emits `proceeding.linked`.
 */
export async function linkProceedings(
  deps: MatterGraphDeps,
  actor: GraphActor,
  input: LinkProceedingsInput,
): Promise<ProceedingLinkRow> {
  const data = parseInput(LinkProceedingsInput, input);
  return inGraphScope(deps, actor, async (scope) => {
    const { tx } = scope;
    const { workspaceId } = scope.actor;
    const ends = await tx
      .select({ id: proceeding.id, matterId: proceeding.matterId })
      .from(proceeding)
      .where(
        and(
          eq(proceeding.workspaceId, workspaceId),
          inArray(proceeding.id, [data.fromProceedingId, data.toProceedingId]),
        ),
      );
    const from = ends.find((p) => p.id === data.fromProceedingId);
    const to = ends.find((p) => p.id === data.toProceedingId);
    if (from === undefined || to === undefined) {
      throw crossWorkspace('Both proceedings must belong to this workspace');
    }
    const fromMatter = await requireMatter(scope, from.matterId, 'matter.write');
    const toMatter =
      to.matterId === from.matterId
        ? fromMatter
        : await requireMatter(scope, to.matterId, 'matter.write');
    const { provenance } = data;
    let row: ProceedingLinkRow | undefined;
    try {
      [row] = await tx
        .insert(proceedingLink)
        .values({
          workspaceId,
          fromProceedingId: from.id,
          toProceedingId: to.id,
          kind: data.kind,
          sourceType: provenance.sourceType,
          sourceRef: provenance.sourceRef ?? null,
          anchorId: provenance.anchorId ?? null,
          confidence: provenance.confidence ?? null,
          ...(provenance.confirmationState === undefined
            ? {}
            : { confirmationState: provenance.confirmationState }),
          ...(provenance.capturedAt === undefined ? {} : { capturedAt: provenance.capturedAt }),
        })
        .returning();
    } catch (error) {
      const { code, constraint } = pgError(error);
      if (code === '23505') throw conflict('These proceedings are already linked this way');
      if (code === '23514') throw conflict('This link would close a parent_of cycle');
      if (code === '23503' && constraint === 'proceeding_link_anchor_fk') {
        throw invalid('provenance.anchorId: anchor not found');
      }
      throw error;
    }
    if (!row) throw new Error('linkProceedings: insert returned no row');
    scope.emit({
      type: 'proceeding.linked',
      workspaceId,
      actorUserId: scope.actor.userId,
      matterId: fromMatter.id,
      sensitive: fromMatter.sensitive || toMatter.sensitive,
      linkId: row.id,
      fromProceedingId: from.id,
      toProceedingId: to.id,
      kind: row.kind,
    });
    return row;
  });
}

/**
 * The actor's readable proceedings that name the same proceeding as `identity`
 * (`isSameProceeding`): CNR matches first, then the oldest. Reads only.
 */
export async function findDuplicateProceedings(
  deps: MatterGraphDeps,
  actor: GraphActor,
  input: FindDuplicateProceedingsInput,
): Promise<ProceedingRow[]> {
  const { identity, excludeProceedingId, limit } = parseInput(FindDuplicateProceedingsInput, input);
  return inGraphScope(deps, actor, async ({ tx, actor: resolved, settings }) => {
    if (!can(resolved, 'matter.read', undefined, settings).allow) return [];
    const matches: SQL[] = [];
    if (identity.cnr !== undefined) matches.push(eq(proceeding.cnr, identity.cnr));
    if (identityKey(identity) !== null && identity.caseType !== undefined) {
      const year = identity.year;
      if (year !== undefined) {
        matches.push(
          and(
            eq(proceeding.caseTypeCode, normaliseCaseType(identity.caseType)),
            eq(proceeding.year, expandYear(year)),
          ) as SQL,
        );
      }
    }
    if (matches.length === 0) return [];
    const ownerUserId = sql`(select ${member.userId} from ${matter} join ${member} on ${member.organizationId} = ${matter.workspaceId} and ${member.id} = ${matter.ownerMemberId} where ${matter.workspaceId} = ${proceeding.workspaceId} and ${matter.id} = ${proceeding.matterId})`;
    const conditions: SQL[] = [
      eq(proceeding.workspaceId, resolved.workspaceId),
      or(...matches) as SQL,
      matterVisibilityPredicate(resolved, proceeding.matterId, { settings, ownerUserId }),
    ];
    if (excludeProceedingId !== undefined) conditions.push(ne(proceeding.id, excludeProceedingId));
    const candidates = await tx
      .select()
      .from(proceeding)
      .where(and(...conditions))
      .orderBy(asc(proceeding.createdAt), asc(proceeding.id));
    const cnr = identity.cnr ?? null;
    return candidates
      .filter((row) => isSameProceeding(identity, rowIdentity(row)))
      .map((row, index) => ({ row, index, byCnr: cnr !== null && row.cnr === cnr }))
      .sort((a, b) => Number(b.byCnr) - Number(a.byCnr) || a.index - b.index)
      .slice(0, limit)
      .map(({ row }) => row);
  });
}

export { normaliseCaseType };
