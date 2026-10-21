// Merges and splits of the matter graph (#365, part 4 of #33; spike #1 §5, architecture §2.3).
// `mergeMatters` folds one matter into another, `splitMatter` moves proceedings out into a new
// matter, `mergeProceedings` collapses two records of one proceeding. Each returns an `UndoPayload`
// (stored by #47) that its undo takes back and restores exactly, `updated_at` included, after
// checking that nothing it moved has moved again since (CONFLICT otherwise).
//
// Every row a call names must be in the actor's workspace: a matter or proceeding the workspace
// cannot see fails with `CrossWorkspaceError` and nothing is written. Merges never mix a sensitive
// and a non-sensitive matter (CA-10), nor matters restricted differently (#233), so a merge cannot
// widen who sees a row; a split copies both onto the new matter. Rows moved into a matter are named
// on the event with that matter's `sensitive` flag; nothing here enqueues AI or any other work.
// Where two proceedings disagree (an identifier, the next date), the merge refuses: services never
// choose between two sources. The canonical flag changes only through next-date.ts (ADR 0016).
// Identifier attribution travels in the result, the event and the payload; it has no table of its
// own.
import { schema, type Transaction } from '@causedeck/db';
import {
  MergeMattersInput,
  MergeProceedingsInput,
  SplitMatterInput,
  UndoMergeInput,
  UndoMergeProceedingsInput,
  UndoSplitInput,
  type IdentifierSource,
  type MatterMergeUndoPayload,
  type MatterSplitUndoPayload,
  type ProceedingMergeUndoPayload,
} from '@causedeck/validators/matter-graph-inputs';
import { and, eq, inArray, or, sql, type SQL } from 'drizzle-orm';

import { conflict, invalid } from '../shared/errors.ts';

import {
  inGraphScope,
  loadProceeding,
  parseInput,
  pgError,
  requireMatter,
  type GraphActor,
  type GraphScope,
  type MatterGraphDeps,
  type MatterRow,
  type ProceedingRow,
} from './context.ts';
import { identityKey, normaliseCaseNumber, normaliseCaseType, rowIdentity } from './duplicates.ts';
import { crossWorkspace } from './errors.ts';
import { demoteDuplicateCanonical, restoreCanonical } from './next-date.ts';

const { listing, matter, matterRestriction, proceeding, proceedingLink } = schema;

/** What every undo payload is: opaque to callers, stored by #47 and handed back to the undo. */
export interface UndoPayload {
  op: string;
  version: 1;
  before: unknown;
  after?: unknown;
}

export type { MatterMergeUndoPayload, MatterSplitUndoPayload, ProceedingMergeUndoPayload };

export interface MergeMattersResult {
  /** The matter merged into. */
  matter: MatterRow;
  /** The source matter, now `merged_into_matter_id` = `matter.id`. */
  from: MatterRow;
  undo: MatterMergeUndoPayload;
  moved: {
    proceedingIds: string[];
    documentIds: string[];
    roleEdgeIds: string[];
    obligationIds: string[];
    taskIds: string[];
    /** Matters merged into the source earlier, now merged into `matter`. */
    mergedMatterIds: string[];
    /** Links of the moved proceedings; they follow their proceedings unchanged. */
    linkIds: string[];
  };
}

/** A link (or a `parent_proceeding_id` pair) with one end on each side of a split. */
export interface CrossingLink {
  /** Null for a `parent_proceeding_id` pair. */
  linkId: string | null;
  kind: string;
  fromProceedingId: string;
  toProceedingId: string;
}

export interface SplitMatterResult {
  /** The new matter. */
  matter: MatterRow;
  undo: MatterSplitUndoPayload;
  moved: { proceedingIds: string[]; obligationIds: string[]; taskIds: string[] };
  /** Left in place and reported, never broken. */
  crossing: CrossingLink[];
}

export interface MergeProceedingsResult {
  /** The surviving proceeding, with the union of both identifiers. */
  proceeding: ProceedingRow;
  undo: ProceedingMergeUndoPayload;
  /** Which proceeding (and source) each identifier came from. */
  identifierSources: Record<string, IdentifierSource>;
  moved: {
    listingIds: string[];
    orderIds: string[];
    obligationIds: string[];
    taskIds: string[];
    roleEdgeIds: string[];
    stateChangeIds: string[];
    childIds: string[];
    linkIds: string[];
    deletedLinkIds: string[];
    demotedListingId: string | null;
  };
}

// ---------------------------------------------------------------------------------------------
// Row moves with their prior `updated_at`, and exact restores.

type GraphTable =
  | 'matter'
  | 'proceeding'
  | 'proceeding_link'
  | 'document'
  | 'role_edge'
  | 'proceeding_state_change'
  | 'listing'
  | 'order'
  | 'obligation'
  | 'task';

interface Stamp {
  id: string;
  /** `updated_at::text` before the change. */
  updatedAt: string;
}

interface MatterStamp extends Stamp {
  matterId: string | null;
}

const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

function uuidArray(ids: readonly string[]): SQL {
  if (ids.length === 0) return sql`'{}'::uuid[]`;
  return sql`array[${sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  )}]::uuid[]`;
}

/** Updates the rows `where` selects with `set`; each row's id, prior `updated_at` and matter. */
async function moveRows(
  tx: Transaction,
  table: GraphTable,
  workspaceId: string,
  set: SQL,
  where: SQL,
): Promise<MatterStamp[]> {
  const t = sql.identifier(table);
  const matterColumn =
    table === 'obligation' || table === 'task' ? sql`matter_id` : sql`null::uuid`;
  const rows = await tx.execute<{
    id: string;
    before_at: string;
    before_matter: string | null;
  }>(sql`
    update ${t} as t set ${set}, updated_at = now()
    from (
      select id as old_id, updated_at::text as before_at, ${matterColumn} as before_matter
      from ${t} where workspace_id = ${workspaceId} and ${where}
    ) as old
    where t.workspace_id = ${workspaceId} and t.id = old.old_id
    returning t.id, old.before_at, old.before_matter`);
  return [...rows]
    .map((row) => ({ id: row.id, updatedAt: row.before_at, matterId: row.before_matter }))
    .sort(byId);
}

async function move(...args: Parameters<typeof moveRows>): Promise<Stamp[]> {
  return (await moveRows(...args)).map(({ id, updatedAt }) => ({ id, updatedAt }));
}

/** Sets `set` on each listed row and puts back its recorded `updated_at` (and `v.matter_id`). */
async function restoreRows(
  tx: Transaction,
  table: GraphTable,
  workspaceId: string,
  set: SQL,
  rows: readonly (Stamp & { matterId?: string | null })[],
): Promise<void> {
  if (rows.length === 0) return;
  const list = (values: (string | null)[]) =>
    sql.join(
      values.map((value) => sql`${value}`),
      sql`, `,
    );
  await tx.execute(sql`
    update ${sql.identifier(table)} as t set ${set}, updated_at = v.updated_at
    from unnest(
      array[${list(rows.map((r) => r.id))}]::uuid[],
      array[${list(rows.map((r) => r.updatedAt))}]::timestamptz[],
      array[${list(rows.map((r) => r.matterId ?? null))}]::uuid[]
    ) as v(id, updated_at, matter_id)
    where t.workspace_id = ${workspaceId} and t.id = v.id`);
}

async function countRows(
  tx: Transaction,
  table: GraphTable,
  workspaceId: string,
  where: SQL,
): Promise<number> {
  const [row] = await tx.execute<{ n: number }>(
    sql`select count(*)::int as n from ${sql.identifier(table)} where workspace_id = ${workspaceId} and ${where}`,
  );
  return row?.n ?? 0;
}

const CHANGED = 'The matter graph changed since; this cannot be undone';

/** CONFLICT unless every listed row still matches `where`. */
async function expectAll(
  tx: Transaction,
  table: GraphTable,
  workspaceId: string,
  ids: readonly string[],
  where: SQL,
): Promise<void> {
  if (ids.length === 0) return;
  const n = await countRows(tx, table, workspaceId, sql`id = any(${uuidArray(ids)}) and ${where}`);
  if (n !== ids.length) throw conflict(CHANGED);
}

async function stampOf(tx: Transaction, table: GraphTable, workspaceId: string, id: string) {
  const [row] = await tx.execute<{ at: string }>(
    sql`select updated_at::text as at from ${sql.identifier(table)} where workspace_id = ${workspaceId} and id = ${id}`,
  );
  if (row === undefined) throw new Error(`${table} ${id} vanished inside the transaction`);
  return row.at;
}

/** The database's verdict on a merge write, as a domain error. */
async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    const { code } = pgError(error);
    if (code === '23505') throw conflict('The merge would duplicate a proceeding or link');
    if (code === '23514') {
      throw conflict(
        'The merge would break a graph rule (a parent_of cycle or a closed obligation)',
      );
    }
    if (code === '23503') throw conflict(CHANGED);
    throw error;
  }
}

// ---------------------------------------------------------------------------------------------
// Matter checks.

/** Both matters if the workspace has them (else `CrossWorkspaceError`) and the actor may write. */
async function requireMatterPair(
  scope: GraphScope,
  firstId: string,
  secondId: string,
): Promise<[MatterRow, MatterRow]> {
  const found = await scope.tx
    .select({ id: matter.id })
    .from(matter)
    .where(
      and(eq(matter.workspaceId, scope.actor.workspaceId), inArray(matter.id, [firstId, secondId])),
    );
  if (found.length < 2) throw crossWorkspace('Both matters must belong to this workspace');
  return [
    await requireMatter(scope, firstId, 'matter.write'),
    await requireMatter(scope, secondId, 'matter.write'),
  ];
}

function assertOpen(row: MatterRow): void {
  if (row.mergedIntoMatterId !== null) throw conflict('This matter was merged');
  if (row.status === 'archived') throw conflict('This matter is archived');
}

async function restrictionOf(tx: Transaction, workspaceId: string, matterId: string) {
  const [row] = await tx
    .select({ allowedUserIds: matterRestriction.allowedUserIds, reason: matterRestriction.reason })
    .from(matterRestriction)
    .where(
      and(eq(matterRestriction.workspaceId, workspaceId), eq(matterRestriction.matterId, matterId)),
    )
    .limit(1);
  return row ?? null;
}

/** CONFLICT when rows of one matter would become visible to people the other hides them from. */
async function assertCompatible(scope: GraphScope, a: MatterRow, b: MatterRow): Promise<void> {
  if (a.id === b.id) return;
  if (a.sensitive !== b.sensitive) {
    throw conflict('A sensitive matter can only be merged with another sensitive matter');
  }
  const { tx, actor } = scope;
  const ra = await restrictionOf(tx, actor.workspaceId, a.id);
  const rb = await restrictionOf(tx, actor.workspaceId, b.id);
  const same =
    (ra === null && rb === null) ||
    (ra !== null &&
      rb !== null &&
      new Set(ra.allowedUserIds).size === new Set(rb.allowedUserIds).size &&
      ra.allowedUserIds.every((id) => rb.allowedUserIds.includes(id)));
  if (!same) throw conflict('Matters restricted differently cannot be merged');
}

// ---------------------------------------------------------------------------------------------
// Matter merge.

/**
 * Merge `fromMatterId` into `intoMatterId`: its proceedings (their links, listings and orders
 * follow), documents, people edges, obligations and tasks move, and it is marked merged.
 */
export async function mergeMatters(
  deps: MatterGraphDeps,
  actor: GraphActor,
  input: MergeMattersInput,
): Promise<MergeMattersResult> {
  const data = parseInput(MergeMattersInput, input);
  const intoId = data.intoMatterId.toLowerCase();
  const fromId = data.fromMatterId.toLowerCase();
  return inGraphScope(deps, actor, async (scope) => {
    const { tx } = scope;
    const ws = scope.actor.workspaceId;
    const [into, from] = await requireMatterPair(scope, intoId, fromId);
    assertOpen(into);
    assertOpen(from);
    await assertCompatible(scope, into, from);
    const fromStamp = await stampOf(tx, 'matter', ws, from.id);
    const to = sql`matter_id = ${into.id}`;
    const of = sql`matter_id = ${from.id}`;
    const rows = await guarded(async () => ({
      proceeding: await move(tx, 'proceeding', ws, to, of),
      document: await move(tx, 'document', ws, to, of),
      roleEdge: await move(tx, 'role_edge', ws, to, of),
      obligation: await move(tx, 'obligation', ws, to, of),
      task: await move(tx, 'task', ws, to, of),
      mergedMatter: await move(
        tx,
        'matter',
        ws,
        sql`merged_into_matter_id = ${into.id}`,
        sql`merged_into_matter_id = ${from.id}`,
      ),
    }));
    const [merged] = await tx
      .update(matter)
      .set({ mergedIntoMatterId: into.id, updatedAt: new Date() })
      .where(and(eq(matter.workspaceId, ws), eq(matter.id, from.id)))
      .returning();
    if (!merged) throw new Error('mergeMatters: update returned no row');
    const proceedingIds = rows.proceeding.map((r) => r.id);
    const links =
      proceedingIds.length === 0
        ? []
        : await tx
            .select({ id: proceedingLink.id })
            .from(proceedingLink)
            .where(
              and(
                eq(proceedingLink.workspaceId, ws),
                or(
                  inArray(proceedingLink.fromProceedingId, proceedingIds),
                  inArray(proceedingLink.toProceedingId, proceedingIds),
                ),
              ),
            )
            .orderBy(proceedingLink.id);
    const linkIds = links.map((l) => l.id);
    const documentIds = rows.document.map((r) => r.id);
    scope.emit({
      type: 'matter.merged',
      workspaceId: ws,
      actorUserId: scope.actor.userId,
      matterId: into.id,
      sensitive: into.sensitive,
      fromMatterId: from.id,
      proceedingIds,
      documentIds,
    });
    return {
      matter: into,
      from: merged,
      undo: {
        op: 'matter.merge',
        version: 1,
        before: {
          intoMatterId: into.id,
          fromMatterId: from.id,
          fromMatter: { mergedIntoMatterId: from.mergedIntoMatterId, updatedAt: fromStamp },
          rows,
          links: linkIds,
        },
        after: { intoMatterId: into.id },
      },
      moved: {
        proceedingIds,
        documentIds,
        roleEdgeIds: rows.roleEdge.map((r) => r.id),
        obligationIds: rows.obligation.map((r) => r.id),
        taskIds: rows.task.map((r) => r.id),
        mergedMatterIds: rows.mergedMatter.map((r) => r.id),
        linkIds,
      },
    };
  });
}

/** Undo a `mergeMatters`: every moved row goes back to the source, which is unmerged. */
export async function undoMerge(
  deps: MatterGraphDeps,
  actor: GraphActor,
  input: UndoMergeInput,
): Promise<{ matter: MatterRow }> {
  const { payload } = parseInput(UndoMergeInput, input);
  const { before } = payload;
  const intoId = before.intoMatterId.toLowerCase();
  const fromId = before.fromMatterId.toLowerCase();
  if (payload.after.intoMatterId.toLowerCase() !== intoId)
    throw invalid('payload: after.intoMatterId');
  return inGraphScope(deps, actor, async (scope) => {
    const { tx } = scope;
    const ws = scope.actor.workspaceId;
    const [into, from] = await requireMatterPair(scope, intoId, fromId);
    if (from.mergedIntoMatterId !== into.id) throw conflict(CHANGED);
    const { rows } = before;
    const at = sql`matter_id = ${into.id}`;
    await expectAll(
      tx,
      'proceeding',
      ws,
      rows.proceeding.map((r) => r.id),
      at,
    );
    await expectAll(
      tx,
      'document',
      ws,
      rows.document.map((r) => r.id),
      at,
    );
    await expectAll(
      tx,
      'role_edge',
      ws,
      rows.roleEdge.map((r) => r.id),
      at,
    );
    await expectAll(
      tx,
      'obligation',
      ws,
      rows.obligation.map((r) => r.id),
      at,
    );
    await expectAll(
      tx,
      'task',
      ws,
      rows.task.map((r) => r.id),
      at,
    );
    await expectAll(
      tx,
      'matter',
      ws,
      rows.mergedMatter.map((r) => r.id),
      sql`merged_into_matter_id = ${into.id}`,
    );
    const back = sql`matter_id = ${from.id}`;
    await guarded(async () => {
      await restoreRows(tx, 'proceeding', ws, back, rows.proceeding);
      await restoreRows(tx, 'document', ws, back, rows.document);
      await restoreRows(tx, 'role_edge', ws, back, rows.roleEdge);
      await restoreRows(tx, 'obligation', ws, back, rows.obligation);
      await restoreRows(tx, 'task', ws, back, rows.task);
      await restoreRows(
        tx,
        'matter',
        ws,
        sql`merged_into_matter_id = ${from.id}`,
        rows.mergedMatter,
      );
      await tx.execute(sql`
        update matter set merged_into_matter_id = ${before.fromMatter.mergedIntoMatterId}::uuid,
          updated_at = ${before.fromMatter.updatedAt}::timestamptz
        where workspace_id = ${ws} and id = ${from.id}`);
    });
    const [restored] = await tx
      .select()
      .from(matter)
      .where(and(eq(matter.workspaceId, ws), eq(matter.id, from.id)));
    if (!restored) throw new Error('undoMerge: matter vanished');
    scope.emit({
      type: 'matter.merge_undone',
      workspaceId: ws,
      actorUserId: scope.actor.userId,
      matterId: into.id,
      sensitive: restored.sensitive,
      fromMatterId: from.id,
    });
    return { matter: restored };
  });
}

// ---------------------------------------------------------------------------------------------
// Matter split.

/**
 * Move `proceedingIds` of `matterId` (with their listings, orders, obligations and tasks) into a
 * new matter titled `newTitle`, which copies the source's sensitivity, owner and restriction.
 * Links and parent pairs that cross the split are kept and reported in `crossing`.
 */
export async function splitMatter(
  deps: MatterGraphDeps,
  actor: GraphActor,
  input: SplitMatterInput,
): Promise<SplitMatterResult> {
  const data = parseInput(SplitMatterInput, input);
  const ids = data.proceedingIds.map((id) => id.toLowerCase());
  return inGraphScope(deps, actor, async (scope) => {
    const { tx } = scope;
    const ws = scope.actor.workspaceId;
    const source = await requireMatter(scope, data.matterId.toLowerCase(), 'matter.write');
    assertOpen(source);
    const found = await tx
      .select({ id: proceeding.id, matterId: proceeding.matterId })
      .from(proceeding)
      .where(and(eq(proceeding.workspaceId, ws), inArray(proceeding.id, ids)));
    if (found.length !== ids.length) {
      throw crossWorkspace('Proceedings must belong to this workspace');
    }
    if (found.some((p) => p.matterId !== source.id)) {
      throw invalid('proceedingIds must be proceedings of the matter');
    }
    const restriction = await restrictionOf(tx, ws, source.id);
    const [created] = await tx
      .insert(matter)
      .values({
        workspaceId: ws,
        title: data.newTitle,
        practiceArea: source.practiceArea,
        sensitive: source.sensitive,
        ownerMemberId: source.ownerMemberId,
        synopsis: null,
      })
      .returning();
    if (!created) throw new Error('splitMatter: insert returned no row');
    if (restriction !== null) {
      await tx.insert(matterRestriction).values({
        workspaceId: ws,
        matterId: created.id,
        allowedUserIds: restriction.allowedUserIds,
        reason: restriction.reason,
        createdBy: scope.actor.userId,
      });
    }
    const set = uuidArray(ids);
    const to = sql`matter_id = ${created.id}`;
    const rows = await guarded(async () => ({
      proceeding: await move(
        tx,
        'proceeding',
        ws,
        to,
        sql`id = any(${set}) and matter_id = ${source.id}`,
      ),
      obligation: await move(
        tx,
        'obligation',
        ws,
        to,
        sql`proceeding_id = any(${set}) and matter_id = ${source.id}`,
      ),
      task: await move(
        tx,
        'task',
        ws,
        to,
        sql`proceeding_id = any(${set}) and matter_id = ${source.id}`,
      ),
    }));
    const inside = new Set(ids);
    const crossing: CrossingLink[] = [];
    const links = await tx
      .select({
        id: proceedingLink.id,
        kind: proceedingLink.kind,
        from: proceedingLink.fromProceedingId,
        to: proceedingLink.toProceedingId,
      })
      .from(proceedingLink)
      .where(
        and(
          eq(proceedingLink.workspaceId, ws),
          or(
            inArray(proceedingLink.fromProceedingId, ids),
            inArray(proceedingLink.toProceedingId, ids),
          ),
        ),
      )
      .orderBy(proceedingLink.id);
    for (const l of links) {
      if (inside.has(l.from) !== inside.has(l.to)) {
        crossing.push({
          linkId: l.id,
          kind: l.kind,
          fromProceedingId: l.from,
          toProceedingId: l.to,
        });
      }
    }
    const pairs = await tx
      .select({ id: proceeding.id, parentId: proceeding.parentProceedingId })
      .from(proceeding)
      .where(
        and(
          eq(proceeding.workspaceId, ws),
          or(inArray(proceeding.id, ids), inArray(proceeding.parentProceedingId, ids)),
        ),
      )
      .orderBy(proceeding.id);
    for (const p of pairs) {
      if (p.parentId !== null && inside.has(p.id) !== inside.has(p.parentId)) {
        crossing.push({
          linkId: null,
          kind: 'parent_proceeding',
          fromProceedingId: p.parentId,
          toProceedingId: p.id,
        });
      }
    }
    const proceedingIds = rows.proceeding.map((r) => r.id);
    scope.emit({
      type: 'matter.split',
      workspaceId: ws,
      actorUserId: scope.actor.userId,
      matterId: source.id,
      sensitive: created.sensitive,
      newMatterId: created.id,
      proceedingIds,
      crossingLinks: crossing.length,
    });
    return {
      matter: created,
      undo: {
        op: 'matter.split',
        version: 1,
        before: { matterId: source.id, rows },
        after: { newMatterId: created.id },
      },
      moved: {
        proceedingIds,
        obligationIds: rows.obligation.map((r) => r.id),
        taskIds: rows.task.map((r) => r.id),
      },
      crossing,
    };
  });
}

/** Undo a `splitMatter`: the rows go back and the new matter is deleted, if nothing else joined it. */
export async function undoSplit(
  deps: MatterGraphDeps,
  actor: GraphActor,
  input: UndoSplitInput,
): Promise<{ matter: MatterRow }> {
  const { payload } = parseInput(UndoSplitInput, input);
  const { rows } = payload.before;
  const sourceId = payload.before.matterId.toLowerCase();
  const newId = payload.after.newMatterId.toLowerCase();
  return inGraphScope(deps, actor, async (scope) => {
    const { tx } = scope;
    const ws = scope.actor.workspaceId;
    const [source, created] = await requireMatterPair(scope, sourceId, newId);
    if (source.mergedIntoMatterId !== null || created.mergedIntoMatterId !== null) {
      throw conflict(CHANGED);
    }
    const at = sql`matter_id = ${created.id}`;
    const proceedingIds = rows.proceeding.map((r) => r.id);
    const obligationIds = rows.obligation.map((r) => r.id);
    const taskIds = rows.task.map((r) => r.id);
    await expectAll(tx, 'proceeding', ws, proceedingIds, at);
    await expectAll(tx, 'obligation', ws, obligationIds, at);
    await expectAll(tx, 'task', ws, taskIds, at);
    const others = [
      await countRows(tx, 'proceeding', ws, sql`${at} and id <> all(${uuidArray(proceedingIds)})`),
      await countRows(tx, 'obligation', ws, sql`${at} and id <> all(${uuidArray(obligationIds)})`),
      await countRows(tx, 'task', ws, sql`${at} and id <> all(${uuidArray(taskIds)})`),
      await countRows(tx, 'document', ws, at),
      await countRows(tx, 'role_edge', ws, at),
      await countRows(tx, 'matter', ws, sql`merged_into_matter_id = ${created.id}`),
    ];
    if (others.some((n) => n > 0)) throw conflict(CHANGED);
    const back = sql`matter_id = ${source.id}`;
    await guarded(async () => {
      await restoreRows(tx, 'proceeding', ws, back, rows.proceeding);
      await restoreRows(tx, 'obligation', ws, back, rows.obligation);
      await restoreRows(tx, 'task', ws, back, rows.task);
      await tx.delete(matter).where(and(eq(matter.workspaceId, ws), eq(matter.id, created.id)));
    });
    scope.emit({
      type: 'matter.split_undone',
      workspaceId: ws,
      actorUserId: scope.actor.userId,
      matterId: source.id,
      sensitive: source.sensitive,
      newMatterId: created.id,
    });
    return { matter: source };
  });
}

// ---------------------------------------------------------------------------------------------
// Proceeding merge.

/** Identifiers merged as a union; both sides set and different is a CONFLICT. */
const UNION_FIELDS = [
  'caseTypeCode',
  'number',
  'year',
  'cnr',
  'srNo',
  'frNo',
  'diaryNo',
  'filingNo',
  'filingDate',
  'titlePetitioner',
  'titleRespondent',
] as const;

/**
 * An identifier as the services store it: rows written before normalisation (imports, fixtures)
 * can hold `010234` or `W-P`, which is how two records of one proceeding get past the identity
 * index in the first place.
 */
function normalised<T>(field: (typeof UNION_FIELDS)[number], value: T): T {
  if (typeof value !== 'string') return value;
  if (field === 'number') return normaliseCaseNumber(value) as T;
  if (field === 'caseTypeCode') return normaliseCaseType(value) as T;
  return value;
}

/** The columns of a proceeding the merge rewrites on the survivor (and its undo restores). */
const RESTORED_COLUMNS = sql.raw(
  [
    'case_type_code',
    'case_type_raw',
    'number',
    'year',
    'cnr',
    'sr_no',
    'fr_no',
    'diary_no',
    'filing_no',
    'filing_date',
    'title_petitioner',
    'title_respondent',
    'updated_at',
  ]
    .map((c) => `${c} = r.${c}`)
    .join(', '),
);

interface LoadedProceeding {
  row: ProceedingRow;
  whole: { id: string } & Record<string, unknown>;
  updatedAt: string;
}

/**
 * Collapse `fromProceedingId` into `intoProceedingId`, two records of one proceeding (same forum,
 * normalised case type, number and year, or same CNR). The survivor keeps the union of their
 * identifiers; listings, orders, obligations, tasks, people edges, links and child proceedings are
 * re-pointed to it, and the source is deleted (its row travels in the payload).
 */
export async function mergeProceedings(
  deps: MatterGraphDeps,
  actor: GraphActor,
  input: MergeProceedingsInput,
): Promise<MergeProceedingsResult> {
  const data = parseInput(MergeProceedingsInput, input);
  const intoId = data.intoProceedingId.toLowerCase();
  const fromId = data.fromProceedingId.toLowerCase();
  return inGraphScope(deps, actor, async (scope) => {
    const { tx } = scope;
    const ws = scope.actor.workspaceId;
    const loaded: LoadedProceeding[] = await tx
      .select({
        row: proceeding,
        whole: sql<LoadedProceeding['whole']>`to_jsonb(${proceeding})`,
        updatedAt: sql<string>`${proceeding.updatedAt}::text`,
      })
      .from(proceeding)
      .where(and(eq(proceeding.workspaceId, ws), inArray(proceeding.id, [intoId, fromId])));
    const into = loaded.find((p) => p.row.id === intoId);
    const from = loaded.find((p) => p.row.id === fromId);
    if (into === undefined || from === undefined) {
      throw crossWorkspace('Both proceedings must belong to this workspace');
    }
    const a = into.row;
    const b = from.row;
    const intoMatter = await requireMatter(scope, a.matterId, 'matter.write');
    const fromMatter =
      b.matterId === a.matterId
        ? intoMatter
        : await requireMatter(scope, b.matterId, 'matter.write');
    await assertCompatible(scope, intoMatter, fromMatter);

    const key = identityKey(rowIdentity(a));
    const sameCnr = a.cnr !== null && a.cnr === b.cnr;
    const sameIdentity =
      a.forumId === b.forumId && key !== null && key === identityKey(rowIdentity(b));
    if (!sameCnr && !sameIdentity) {
      throw invalid(
        'These are not the same proceeding (forum, case type, number and year, or CNR)',
      );
    }
    if (a.forumId !== b.forumId) throw conflict('The proceedings disagree on forumId');
    const union: Partial<ProceedingRow> = {};
    const identifierSources: Record<string, IdentifierSource> = {};
    for (const field of UNION_FIELDS) {
      const ours = normalised(field, a[field]);
      const theirs = normalised(field, b[field]);
      if (ours !== null && theirs !== null && ours !== theirs) {
        throw conflict(`The proceedings disagree on ${field}`);
      }
      const origin = ours !== null ? a : theirs !== null ? b : null;
      if (origin === null) continue;
      Object.assign(union, { [field]: ours ?? theirs });
      identifierSources[field] = {
        proceedingId: origin.id,
        sourceType: origin.sourceType,
        sourceRef: origin.sourceRef,
      };
    }

    const result = await guarded(async () => {
      const canonical = await tx
        .select({
          id: listing.id,
          proceedingId: listing.proceedingId,
          listDate: listing.listDate,
          updatedAt: sql<string>`${listing.updatedAt}::text`,
        })
        .from(listing)
        .where(
          and(
            eq(listing.workspaceId, ws),
            eq(listing.canonical, true),
            inArray(listing.proceedingId, [a.id, b.id]),
          ),
        );
      const ourNext = canonical.find((l) => l.proceedingId === a.id);
      const theirNext = canonical.find((l) => l.proceedingId === b.id);
      let demotedListing: Stamp | null = null;
      if (ourNext !== undefined && theirNext !== undefined) {
        if (ourNext.listDate !== theirNext.listDate) {
          throw conflict('Both proceedings have a different next date; resolve it first');
        }
        demotedListing = { id: theirNext.id, updatedAt: theirNext.updatedAt };
        // next-date.ts owns the canonical flag (ADR 0016); the dates are equal, so nothing is chosen.
        await demoteDuplicateCanonical(tx, ws, theirNext.id, ourNext.listDate);
      }
      const to = sql`proceeding_id = ${a.id}`;
      const of = sql`proceeding_id = ${b.id}`;
      const rows = {
        listing: await move(tx, 'listing', ws, to, of),
        order: await move(tx, 'order', ws, to, of),
        obligation: await moveRows(tx, 'obligation', ws, sql`${to}, matter_id = ${a.matterId}`, of),
        task: await moveRows(
          tx,
          'task',
          ws,
          sql`${to}, matter_id = case when matter_id is null then null else ${a.matterId}::uuid end`,
          of,
        ),
        roleEdge: await move(tx, 'role_edge', ws, to, of),
        // Its state history (#363) would cascade with the deleted row; it follows the survivor.
        stateChange: await move(tx, 'proceeding_state_change', ws, to, of),
        child: await move(
          tx,
          'proceeding',
          ws,
          sql`parent_proceeding_id = ${a.id}`,
          sql`parent_proceeding_id = ${b.id} and id <> ${a.id}`,
        ),
        link: [] as {
          id: string;
          updatedAt: string;
          fromProceedingId: string;
          toProceedingId: string;
        }[],
      };
      const touching = await tx
        .select({
          id: proceedingLink.id,
          from: proceedingLink.fromProceedingId,
          to: proceedingLink.toProceedingId,
          kind: proceedingLink.kind,
          whole: sql<{ id: string } & Record<string, unknown>>`to_jsonb(${proceedingLink})`,
          updatedAt: sql<string>`${proceedingLink.updatedAt}::text`,
        })
        .from(proceedingLink)
        .where(
          and(
            eq(proceedingLink.workspaceId, ws),
            or(
              inArray(proceedingLink.fromProceedingId, [a.id, b.id]),
              inArray(proceedingLink.toProceedingId, [a.id, b.id]),
            ),
          ),
        )
        .orderBy(proceedingLink.id);
      const tripleOf = (f: string, t: string, kind: string) => `${f}|${t}|${kind}`;
      const triples = new Set(
        touching
          .filter((l) => l.from !== b.id && l.to !== b.id)
          .map((l) => tripleOf(l.from, l.to, l.kind)),
      );
      const deletedLinks: ({ id: string } & Record<string, unknown>)[] = [];
      for (const l of touching.filter((x) => x.from === b.id || x.to === b.id)) {
        const nextFrom = l.from === b.id ? a.id : l.from;
        const nextTo = l.to === b.id ? a.id : l.to;
        const triple = tripleOf(nextFrom, nextTo, l.kind);
        if (nextFrom === nextTo || triples.has(triple)) {
          deletedLinks.push(l.whole);
          continue;
        }
        triples.add(triple);
        rows.link.push({
          id: l.id,
          updatedAt: l.updatedAt,
          fromProceedingId: l.from,
          toProceedingId: l.to,
        });
      }
      if (deletedLinks.length > 0) {
        await tx.delete(proceedingLink).where(
          and(
            eq(proceedingLink.workspaceId, ws),
            inArray(
              proceedingLink.id,
              deletedLinks.map((l) => l.id),
            ),
          ),
        );
      }
      for (const l of rows.link) {
        const nextFrom = l.fromProceedingId === b.id ? a.id : l.fromProceedingId;
        const nextTo = l.toProceedingId === b.id ? a.id : l.toProceedingId;
        await tx.execute(sql`
          update proceeding_link set from_proceeding_id = ${nextFrom}, to_proceeding_id = ${nextTo},
            updated_at = now()
          where workspace_id = ${ws} and id = ${l.id}`);
      }
      await tx
        .delete(proceeding)
        .where(and(eq(proceeding.workspaceId, ws), eq(proceeding.id, b.id)));
      const [survivor] = await tx
        .update(proceeding)
        .set({
          ...union,
          caseTypeRaw: a.caseTypeRaw ?? b.caseTypeRaw,
          ...(a.parentProceedingId === b.id ? { parentProceedingId: null } : {}),
          updatedAt: new Date(),
        })
        .where(and(eq(proceeding.workspaceId, ws), eq(proceeding.id, a.id)))
        .returning();
      if (!survivor) throw new Error('mergeProceedings: update returned no row');
      return { survivor, rows, demotedListing, deletedLinks };
    });
    const { survivor, rows, demotedListing, deletedLinks } = result;
    scope.emit({
      type: 'proceeding.merged',
      workspaceId: ws,
      actorUserId: scope.actor.userId,
      matterId: a.matterId,
      sensitive: intoMatter.sensitive,
      proceedingId: a.id,
      fromProceedingId: b.id,
      identifierSources,
    });
    return {
      proceeding: survivor,
      identifierSources,
      undo: {
        op: 'proceeding.merge',
        version: 1,
        before: {
          intoProceedingId: a.id,
          fromProceedingId: b.id,
          into: into.whole,
          from: from.whole,
          rows,
          demotedListing,
          deletedLinks,
        },
        after: { intoProceedingId: a.id, identifierSources },
      },
      moved: {
        listingIds: rows.listing.map((r) => r.id),
        orderIds: rows.order.map((r) => r.id),
        obligationIds: rows.obligation.map((r) => r.id),
        taskIds: rows.task.map((r) => r.id),
        roleEdgeIds: rows.roleEdge.map((r) => r.id),
        stateChangeIds: rows.stateChange.map((r) => r.id),
        childIds: rows.child.map((r) => r.id),
        linkIds: rows.link.map((r) => r.id),
        deletedLinkIds: deletedLinks.map((l) => l.id),
        demotedListingId: demotedListing?.id ?? null,
      },
    };
  });
}

/** Undo a `mergeProceedings`: the source is re-inserted and everything re-pointed goes back. */
export async function undoMergeProceedings(
  deps: MatterGraphDeps,
  actor: GraphActor,
  input: UndoMergeProceedingsInput,
): Promise<{ proceeding: ProceedingRow }> {
  const { payload } = parseInput(UndoMergeProceedingsInput, input);
  const { before } = payload;
  const intoId = before.intoProceedingId.toLowerCase();
  const fromId = before.fromProceedingId.toLowerCase();
  if (
    before.into.id.toLowerCase() !== intoId ||
    before.from.id.toLowerCase() !== fromId ||
    payload.after.intoProceedingId.toLowerCase() !== intoId ||
    typeof before.from.matter_id !== 'string'
  ) {
    throw invalid('payload: the proceedings do not match');
  }
  const fromMatterId = before.from.matter_id.toLowerCase();
  return inGraphScope(deps, actor, async (scope) => {
    const { tx } = scope;
    const ws = scope.actor.workspaceId;
    const into = await loadProceeding(tx, ws, intoId);
    await requireMatter(scope, into.matterId, 'matter.write');
    const fromMatter = await requireMatter(scope, fromMatterId, 'matter.write');
    if ((await countRows(tx, 'proceeding', ws, sql`id = ${fromId}`)) > 0) throw conflict(CHANGED);
    const { rows } = before;
    // A stored payload is input: it may only put rows back where a merge of these two took them.
    const matters = new Set([fromMatter.id, into.matterId]);
    for (const r of [...rows.obligation, ...rows.task]) {
      if (r.matterId !== null && !matters.has(r.matterId.toLowerCase())) {
        throw invalid('payload: a row names another matter');
      }
    }
    for (const l of before.deletedLinks) {
      const ends = [l.from_proceeding_id, l.to_proceeding_id].map((end) =>
        typeof end === 'string' ? end.toLowerCase() : '',
      );
      const other = ends[0] === fromId ? ends[1] : ends[1] === fromId ? ends[0] : undefined;
      if (other === undefined || other === '') {
        throw invalid('payload: a deleted link does not touch the merged proceeding');
      }
      // As linkProceedings: the other end's matter must be writable.
      if (other !== into.id) {
        await requireMatter(scope, (await loadProceeding(tx, ws, other)).matterId, 'matter.write');
      }
    }
    const at = sql`proceeding_id = ${into.id}`;
    await expectAll(
      tx,
      'listing',
      ws,
      rows.listing.map((r) => r.id),
      at,
    );
    await expectAll(
      tx,
      'order',
      ws,
      rows.order.map((r) => r.id),
      at,
    );
    await expectAll(
      tx,
      'obligation',
      ws,
      rows.obligation.map((r) => r.id),
      at,
    );
    await expectAll(
      tx,
      'task',
      ws,
      rows.task.map((r) => r.id),
      at,
    );
    await expectAll(
      tx,
      'role_edge',
      ws,
      rows.roleEdge.map((r) => r.id),
      at,
    );
    await expectAll(
      tx,
      'proceeding_state_change',
      ws,
      rows.stateChange.map((r) => r.id),
      at,
    );
    await expectAll(
      tx,
      'proceeding',
      ws,
      rows.child.map((r) => r.id),
      sql`parent_proceeding_id = ${into.id}`,
    );
    await expectAll(
      tx,
      'proceeding_link',
      ws,
      rows.link.map((r) => r.id),
      sql`(from_proceeding_id = ${into.id} or to_proceeding_id = ${into.id})`,
    );
    const own = (row: Record<string, unknown>) =>
      sql`(${JSON.stringify(row)}::jsonb || jsonb_build_object('workspace_id', ${ws}::text))`;
    await guarded(async () => {
      await tx.execute(sql`
        update proceeding as t set ${RESTORED_COLUMNS}
        from jsonb_populate_record(null::proceeding, ${own(before.into)}) as r
        where t.workspace_id = ${ws} and t.id = ${into.id}`);
      await tx.execute(sql`
        insert into proceeding select * from jsonb_populate_record(null::proceeding, ${own(before.from)})`);
      await tx.execute(sql`
        update proceeding as t set parent_proceeding_id = r.parent_proceeding_id
        from jsonb_populate_record(null::proceeding, ${own(before.into)}) as r
        where t.workspace_id = ${ws} and t.id = ${into.id}`);
      const back = sql`proceeding_id = ${fromId}`;
      await restoreRows(tx, 'listing', ws, back, rows.listing);
      await restoreRows(tx, 'order', ws, back, rows.order);
      await restoreRows(
        tx,
        'obligation',
        ws,
        sql`${back}, matter_id = v.matter_id`,
        rows.obligation,
      );
      await restoreRows(tx, 'task', ws, sql`${back}, matter_id = v.matter_id`, rows.task);
      await restoreRows(tx, 'role_edge', ws, back, rows.roleEdge);
      await restoreRows(tx, 'proceeding_state_change', ws, back, rows.stateChange);
      await restoreRows(tx, 'proceeding', ws, sql`parent_proceeding_id = ${fromId}`, rows.child);
      for (const l of rows.link) {
        await tx.execute(sql`
          update proceeding_link set from_proceeding_id = ${l.fromProceedingId},
            to_proceeding_id = ${l.toProceedingId}, updated_at = ${l.updatedAt}::timestamptz
          where workspace_id = ${ws} and id = ${l.id}`);
      }
      for (const l of before.deletedLinks) {
        await tx.execute(sql`
          insert into proceeding_link
          select * from jsonb_populate_record(null::proceeding_link, ${own(l)})`);
      }
      if (before.demotedListing !== null) {
        await restoreCanonical(tx, ws, before.demotedListing.id, before.demotedListing.updatedAt);
      }
    });
    const restored = await loadProceeding(tx, ws, fromId);
    scope.emit({
      type: 'proceeding.merge_undone',
      workspaceId: ws,
      actorUserId: scope.actor.userId,
      matterId: fromMatter.id,
      sensitive: fromMatter.sensitive,
      proceedingId: into.id,
      fromProceedingId: fromId,
    });
    return { proceeding: restored };
  });
}
