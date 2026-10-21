// Matter services (#362, part 1 of #33): create, update, archive and the keyset list. Writes need
// `matter.write` (junior and above; a junior only on matters they may read); reads follow
// `matter.read`, restricted matters included (#233). A merged matter (#365) is read-only and is
// left out of the list.
import { can } from '@causedeck/auth/policy';
import { matterVisibilityPredicate } from '@causedeck/auth/policy/visibility';
import { schema } from '@causedeck/db';
import {
  ArchiveMatterInput,
  CreateMatterInput,
  ListMattersInput,
  UpdateMatterInput,
} from '@causedeck/validators/matter-graph-inputs';
import { and, desc, eq, isNull, sql, type SQL } from 'drizzle-orm';

import { activeMember } from '../shared/membership.ts';
import { conflict, forbidden, invalid } from '../shared/errors.ts';

import {
  inGraphScope,
  parseInput,
  requireMatter,
  type GraphActor,
  type GraphScope,
  type MatterGraphDeps,
  type MatterRow,
} from './context.ts';

const { matter, member } = schema;

export type { MatterRow };

/** One page of `listMatters`, newest first; `nextCursor` is null on the last page. */
export interface MatterPage {
  items: MatterRow[];
  nextCursor: string | null;
}

/** VALIDATION unless `ownerMemberId` is an active member of the workspace. */
async function checkOwner(scope: GraphScope, ownerMemberId: string | null | undefined) {
  if (ownerMemberId == null) return;
  const [row] = await scope.tx
    .select({ id: member.id })
    .from(member)
    .where(
      and(
        eq(member.organizationId, scope.actor.workspaceId),
        eq(member.id, ownerMemberId),
        activeMember,
      ),
    )
    .limit(1);
  if (row === undefined) throw invalid('ownerMemberId must be an active member of the workspace');
}

/** A matter of the actor's workspace; emits `matter.created`. */
export async function createMatter(
  deps: MatterGraphDeps,
  actor: GraphActor,
  input: CreateMatterInput,
): Promise<MatterRow> {
  const data = parseInput(CreateMatterInput, input);
  return inGraphScope(deps, actor, async (scope) => {
    if (!can(scope.actor, 'matter.write', undefined, scope.settings).allow) {
      throw forbidden('You cannot create matters');
    }
    await checkOwner(scope, data.ownerMemberId);
    const [row] = await scope.tx
      .insert(matter)
      .values({
        workspaceId: scope.actor.workspaceId,
        title: data.title,
        practiceArea: data.practiceArea ?? null,
        sensitive: data.sensitive ?? false,
        ownerMemberId: data.ownerMemberId ?? null,
        synopsis: data.synopsis ?? null,
      })
      .returning();
    if (!row) throw new Error('createMatter: insert returned no row');
    scope.emit({
      type: 'matter.created',
      workspaceId: row.workspaceId,
      actorUserId: scope.actor.userId,
      matterId: row.id,
      sensitive: row.sensitive,
    });
    return row;
  });
}

/** Change a matter's fields; CONFLICT for an archived or merged matter. Emits `matter.updated`. */
export async function updateMatter(
  deps: MatterGraphDeps,
  actor: GraphActor,
  input: UpdateMatterInput,
): Promise<MatterRow> {
  const { matterId, patch } = parseInput(UpdateMatterInput, input);
  return inGraphScope(deps, actor, async (scope) => {
    const current = await requireMatter(scope, matterId, 'matter.write');
    if (current.mergedIntoMatterId !== null) throw conflict('This matter was merged');
    if (current.status === 'archived') throw conflict('This matter is archived');
    await checkOwner(scope, patch.ownerMemberId);
    const changes = Object.fromEntries(
      Object.entries(patch).filter(([, value]) => value !== undefined),
    ) as Partial<
      Pick<MatterRow, 'title' | 'practiceArea' | 'sensitive' | 'ownerMemberId' | 'synopsis'>
    >;
    const [row] = await scope.tx
      .update(matter)
      .set({ ...changes, updatedAt: new Date() })
      .where(and(eq(matter.workspaceId, scope.actor.workspaceId), eq(matter.id, matterId)))
      .returning();
    if (!row) throw new Error('updateMatter: update returned no row');
    scope.emit({
      type: 'matter.updated',
      workspaceId: row.workspaceId,
      actorUserId: scope.actor.userId,
      matterId: row.id,
      sensitive: row.sensitive,
      changed: Object.keys(changes).sort(),
    });
    return row;
  });
}

/** Archive a matter; a no-op without an event when it is already archived. */
export async function archiveMatter(
  deps: MatterGraphDeps,
  actor: GraphActor,
  input: ArchiveMatterInput,
): Promise<MatterRow> {
  const { matterId } = parseInput(ArchiveMatterInput, input);
  return inGraphScope(deps, actor, async (scope) => {
    const current = await requireMatter(scope, matterId, 'matter.write');
    if (current.status === 'archived') return current;
    if (current.mergedIntoMatterId !== null) throw conflict('This matter was merged');
    const [row] = await scope.tx
      .update(matter)
      .set({ status: 'archived', updatedAt: new Date() })
      .where(and(eq(matter.workspaceId, scope.actor.workspaceId), eq(matter.id, matterId)))
      .returning();
    if (!row) throw new Error('archiveMatter: update returned no row');
    scope.emit({
      type: 'matter.archived',
      workspaceId: row.workspaceId,
      actorUserId: scope.actor.userId,
      matterId: row.id,
      sensitive: row.sensitive,
    });
    return row;
  });
}

/** `timestamptz::text`, e.g. `2026-10-21 10:00:00.123456+00`. */
const CURSOR_AT = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,6})?[+-]\d{2}(:\d{2})?$/;

/** The keyset cursor: `opened_at` as Postgres text (microseconds kept) and the id. */
function encodeCursor(openedAt: string, id: string): string {
  return Buffer.from(JSON.stringify([openedAt, id])).toString('base64url');
}

function decodeCursor(value: string): { openedAt: string; id: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  } catch {
    throw invalid('Invalid cursor');
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length !== 2 ||
    typeof parsed[0] !== 'string' ||
    typeof parsed[1] !== 'string' ||
    !CURSOR_AT.test(parsed[0]) ||
    !/^[0-9a-f-]{36}$/i.test(parsed[1])
  ) {
    throw invalid('Invalid cursor');
  }
  return { openedAt: parsed[0], id: parsed[1] };
}

/**
 * The workspace's matters the actor may read, newest first (`opened_at`, then id), one keyset page
 * at a time. Merged matters are left out; `status` narrows the list.
 */
export async function listMatters(
  deps: MatterGraphDeps,
  actor: GraphActor,
  input: ListMattersInput = {},
): Promise<MatterPage> {
  const { status, limit, cursor } = parseInput(ListMattersInput, input);
  const after = cursor === undefined ? undefined : decodeCursor(cursor);
  return inGraphScope(deps, actor, async ({ tx, actor: resolved, settings }) => {
    if (!can(resolved, 'matter.read', undefined, settings).allow)
      return { items: [], nextCursor: null };
    const ownerUserId = sql`(select ${member.userId} from ${member} where ${member.organizationId} = ${matter.workspaceId} and ${member.id} = ${matter.ownerMemberId})`;
    const conditions: SQL[] = [
      eq(matter.workspaceId, resolved.workspaceId),
      isNull(matter.mergedIntoMatterId),
      matterVisibilityPredicate(resolved, matter.id, { settings, ownerUserId }),
    ];
    if (status !== undefined) conditions.push(eq(matter.status, status));
    if (after !== undefined) {
      conditions.push(
        sql`(${matter.openedAt}, ${matter.id}) < (${after.openedAt}::timestamptz, ${after.id}::uuid)`,
      );
    }
    const rows = await tx
      .select({ matter, cursorAt: sql<string>`${matter.openedAt}::text` })
      .from(matter)
      .where(and(...conditions))
      .orderBy(desc(matter.openedAt), desc(matter.id))
      .limit(limit + 1);
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      items: page.map((row) => row.matter),
      nextCursor:
        rows.length > limit && last !== undefined
          ? encodeCursor(last.cursorAt, last.matter.id)
          : null,
    };
  });
}
