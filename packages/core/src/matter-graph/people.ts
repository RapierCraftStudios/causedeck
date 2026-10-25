// People of the matter graph (#386, part 1 of #40; tables from #348): `upsertPerson` and
// `setRoleEdge`. People are workspace rows: every id is resolved inside the actor's workspace, so
// another workspace's person, matter or proceeding is NOT_FOUND, and nothing here looks people up
// across workspaces (there is no contact-book import or global search, PRD §9). Contact details are
// kept only for clients and professional contacts; the input refuses them for other kinds, and so
// does an update that would leave a stored contact on another kind (`person_contact_chk` is the
// backstop). Changing people needs `matter.write`; an edge to a matter or proceeding needs it on
// that matter, and emits `role_edge.set` / `role_edge.removed` with the matter's `sensitive` flag.
import { can } from '@causedeck/auth/policy';
import { schema, type Transaction } from '@causedeck/db';
import {
  CONTACT_PERSON_KINDS,
  SetRoleEdgeInput,
  UpsertPersonInput,
} from '@causedeck/validators/matter-graph-inputs';
import type { Provenance } from '@causedeck/validators/matter-graph';
import { and, eq, isNull, type AnyColumn, type SQL } from 'drizzle-orm';

import { forbidden, invalid } from '../shared/errors.ts';

import {
  inGraphScope,
  loadProceeding,
  parseInput,
  pgError,
  requireMatter,
  type GraphScope,
  type GraphActor,
  type MatterGraphDeps,
  type MatterRow,
} from './context.ts';
import { crossWorkspace } from './errors.ts';

const { person, roleEdge } = schema;

export type PersonRow = typeof person.$inferSelect;
export type RoleEdgeRow = typeof roleEdge.$inferSelect;

const CONTACT_KINDS: ReadonlySet<string> = new Set(CONTACT_PERSON_KINDS);
const CONTACT_ONLY = 'contact: Contact details are kept only for clients and professionals';

/** The provenance columns of a person or edge; a member typing it in is `manual`. */
function provenanceValues(provenance: Provenance | undefined) {
  const value = provenance ?? { sourceType: 'manual' as const };
  return {
    sourceType: value.sourceType,
    sourceRef: value.sourceRef ?? null,
    anchorId: value.anchorId ?? null,
    confidence: value.confidence ?? null,
    ...(value.confirmationState === undefined
      ? {}
      : { confirmationState: value.confirmationState }),
    ...(value.capturedAt === undefined ? {} : { capturedAt: value.capturedAt }),
  };
}

/** Aliases trimmed, without blanks and case-insensitive repeats, first spelling kept. */
function cleanAliases(aliases: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of aliases) {
    const alias = raw.trim();
    const key = alias.toLowerCase();
    if (alias === '' || seen.has(key)) continue;
    seen.add(key);
    out.push(alias);
  }
  return out;
}

/** The database's verdict on a person or edge write, as a domain error. */
function peopleWriteError(error: unknown): unknown {
  const { code, constraint } = pgError(error);
  if (code === '23503' && constraint?.endsWith('_anchor_fk') === true) {
    return invalid('provenance.anchorId: anchor not found');
  }
  if (code === '23503') return crossWorkspace('Not found in this workspace');
  if (code === '23514') {
    return constraint === 'person_contact_chk' ? invalid(CONTACT_ONLY) : invalid('Invalid person');
  }
  return error;
}

/** FORBIDDEN unless the actor may change the workspace's matters (and so its people). */
function requirePeopleWriter(scope: GraphScope): void {
  if (!can(scope.actor, 'matter.write', undefined, scope.settings).allow) {
    throw forbidden('You cannot change people');
  }
}

/** A person of the actor's workspace, locked for the rest of the transaction, or NOT_FOUND. */
async function loadPerson(
  tx: Transaction,
  workspaceId: string,
  personId: string,
): Promise<PersonRow> {
  const [row] = await tx
    .select()
    .from(person)
    .where(and(eq(person.workspaceId, workspaceId), eq(person.id, personId)))
    .limit(1)
    .for('update');
  if (row === undefined) throw crossWorkspace('Person not found');
  return row;
}

/**
 * Create a person (no `personId`) or update one of the actor's workspace. Name and kind are set
 * as given; aliases replace the stored ones when given; `contact: undefined` keeps the stored
 * contact and `null` clears it. VALIDATION when the result would hold a contact on a kind other
 * than client or professional. Needs `matter.write`; emits no event (a person names no matter).
 */
export async function upsertPerson(
  deps: MatterGraphDeps,
  actor: GraphActor,
  input: UpsertPersonInput,
): Promise<PersonRow> {
  const data = parseInput(UpsertPersonInput, input);
  return inGraphScope(deps, actor, async (scope) => {
    requirePeopleWriter(scope);
    const { tx } = scope;
    const { workspaceId } = scope.actor;
    const aliases = data.aliases === undefined ? undefined : cleanAliases(data.aliases);
    try {
      if (data.personId === undefined) {
        const [row] = await tx
          .insert(person)
          .values({
            workspaceId,
            name: data.name,
            kind: data.kind,
            aliases: aliases ?? [],
            contact: data.contact ?? null,
            ...provenanceValues(data.provenance),
          })
          .returning();
        if (!row) throw new Error('upsertPerson: insert returned no row');
        return row;
      }
      const current = await loadPerson(tx, workspaceId, data.personId);
      const contact = data.contact === undefined ? current.contact : data.contact;
      if (contact != null && !CONTACT_KINDS.has(data.kind)) throw invalid(CONTACT_ONLY);
      const [row] = await tx
        .update(person)
        .set({
          name: data.name,
          kind: data.kind,
          ...(aliases === undefined ? {} : { aliases }),
          contact: contact,
          ...(data.provenance === undefined ? {} : provenanceValues(data.provenance)),
          updatedAt: new Date(),
        })
        .where(and(eq(person.workspaceId, workspaceId), eq(person.id, current.id)))
        .returning();
      if (!row) throw new Error('upsertPerson: update returned no row');
      return row;
    } catch (error) {
      throw peopleWriteError(error);
    }
  });
}

/**
 * Set (or with `remove`, delete) a role edge from a person to exactly one target: another person,
 * a matter or a proceeding, each of the actor's workspace. An identical edge is returned as is.
 * Removing an edge that does not exist returns null. An edge to a matter or proceeding needs
 * `matter.write` on that matter; an edge between two persons needs it for the workspace.
 */
export async function setRoleEdge(
  deps: MatterGraphDeps,
  actor: GraphActor,
  input: SetRoleEdgeInput,
): Promise<RoleEdgeRow | null> {
  const data = parseInput(SetRoleEdgeInput, input);
  return inGraphScope(deps, actor, async (scope) => {
    const { tx } = scope;
    const { workspaceId, userId } = scope.actor;
    let owning: MatterRow | null = null;
    if (data.matterId !== undefined) {
      owning = await requireMatter(scope, data.matterId, 'matter.write');
    } else if (data.proceedingId !== undefined) {
      const target = await loadProceeding(tx, workspaceId, data.proceedingId);
      owning = await requireMatter(scope, target.matterId, 'matter.write');
    } else {
      requirePeopleWriter(scope);
    }
    const from = await loadPerson(tx, workspaceId, data.fromPersonId);
    if (data.toPersonId !== undefined) await loadPerson(tx, workspaceId, data.toPersonId);

    const target = {
      toPersonId: data.toPersonId ?? null,
      matterId: data.matterId ?? null,
      proceedingId: data.proceedingId ?? null,
    };
    const same = (column: AnyColumn, value: string | null): SQL =>
      value === null ? isNull(column) : eq(column, value);
    const [existing] = await tx
      .select()
      .from(roleEdge)
      .where(
        and(
          eq(roleEdge.workspaceId, workspaceId),
          eq(roleEdge.kind, data.kind),
          eq(roleEdge.fromPersonId, from.id),
          same(roleEdge.toPersonId, target.toPersonId),
          same(roleEdge.matterId, target.matterId),
          same(roleEdge.proceedingId, target.proceedingId),
        ),
      )
      .limit(1);

    const emit = (type: 'role_edge.set' | 'role_edge.removed', edge: RoleEdgeRow) => {
      if (owning === null) return;
      scope.emit({
        type,
        workspaceId,
        actorUserId: userId,
        matterId: owning.id,
        sensitive: owning.sensitive,
        roleEdgeId: edge.id,
        kind: edge.kind,
        personId: edge.fromPersonId,
        proceedingId: edge.proceedingId,
      });
    };

    if (data.remove) {
      if (existing === undefined) return null;
      await tx
        .delete(roleEdge)
        .where(and(eq(roleEdge.workspaceId, workspaceId), eq(roleEdge.id, existing.id)));
      emit('role_edge.removed', existing);
      return existing;
    }
    if (existing !== undefined) return existing;
    let row: RoleEdgeRow | undefined;
    try {
      [row] = await tx
        .insert(roleEdge)
        .values({
          workspaceId,
          kind: data.kind,
          fromPersonId: from.id,
          ...target,
          ...provenanceValues(data.provenance),
        })
        .returning();
    } catch (error) {
      throw peopleWriteError(error);
    }
    if (!row) throw new Error('setRoleEdge: insert returned no row');
    emit('role_edge.set', row);
    return row;
  });
}
