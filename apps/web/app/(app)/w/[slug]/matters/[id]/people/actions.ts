'use server';
// People tab server actions (#393, #40 part 5). Each goes through `workspaceAction`
// (lib/workspace-action.ts): zod input, `requireSession`, membership and `matter.write` asserted by
// `guard`, so a non-member (another workspace's owner included) gets FORBIDDEN before anything runs.
// The matter-graph services run on the workspace-scoped transaction `ctx.tx` and decide again per
// matter (a junior's unassigned matter, a restricted matter), returning NOT_FOUND, FORBIDDEN or
// VALIDATION through `toActionError`. People are workspace rows: nothing here imports or searches
// contacts across workspaces.
// - `upsertPersonAction`: add or edit a person (name, aliases, kind, contact only for clients and
//   professional contacts) and, for a new person, their role on this matter, in one transaction,
//   so a failed role never leaves a person attached to nothing. An edit from this tab only reaches
//   a person who has a role on this matter (NOT_FOUND otherwise).
// - `setRoleEdgeAction`: give a person a role on this matter, or remove it.
import { PERSON_KINDS, ROLE_EDGE_KINDS } from '@causedeck/validators/matter-graph';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { graphDeps } from '../../../../../../../lib/matters/graph-deps.ts';
import { ActionError, type Result } from '../../../../../../../lib/safe-action.ts';
import {
  WorkspaceScoped,
  workspaceAction,
  type WorkspaceActionCtx,
} from '../../../../../../../lib/workspace-action.ts';

function actorOf(ctx: WorkspaceActionCtx) {
  return { workspaceId: ctx.workspaceId, userId: ctx.userId };
}

function revalidateMatter(): void {
  revalidatePath('/w/[slug]/matters/[id]', 'layout');
}

const name = z.string().trim().min(1).max(300);

const Contact = z.strictObject({
  email: z.email().max(320).exactOptional(),
  phone: z.string().trim().min(1).max(40).exactOptional(),
  address: z.string().trim().min(1).max(500).exactOptional(),
});

const UpsertPerson = WorkspaceScoped.extend({
  matterId: z.uuid(),
  person: z.strictObject({
    personId: z.uuid().optional(),
    name,
    aliases: z.array(name).max(20).optional(),
    kind: z.enum(PERSON_KINDS),
    /** `undefined` keeps the stored contact, `null` clears it. */
    contact: Contact.nullable().optional(),
  }),
  /** The person's role on this matter (a new person always gets one from the form). */
  role: z.strictObject({ kind: z.enum(ROLE_EDGE_KINDS) }).optional(),
});

export interface SavedPerson {
  id: string;
  name: string;
  kind: (typeof PERSON_KINDS)[number];
  aliases: string[];
}

const upsert = workspaceAction(
  UpsertPerson,
  async (input, ctx) => {
    const { listMatterPeople, setRoleEdge, upsertPerson } =
      await import('@causedeck/core/matter-graph');
    const deps = graphDeps(ctx.tx);
    const actor = actorOf(ctx);
    const { personId, name: personName, aliases, kind, contact } = input.person;
    if (personId !== undefined) {
      // The matter must be readable and the person one of its people.
      const groups = await listMatterPeople(deps, actor, { matterId: input.matterId });
      const known = groups.some((group) => group.edges.some((e) => e.person.id === personId));
      if (!known) throw new ActionError('NOT_FOUND', 'Person not found');
    }
    const row = await upsertPerson(deps, actor, {
      ...(personId === undefined ? {} : { personId }),
      name: personName,
      kind,
      ...(aliases === undefined ? {} : { aliases }),
      ...(contact === undefined ? {} : { contact }),
    });
    if (input.role !== undefined) {
      await setRoleEdge(deps, actor, {
        kind: input.role.kind,
        fromPersonId: row.id,
        matterId: input.matterId,
      });
    }
    revalidateMatter();
    // Never the contact: the page reloads it for those who may see it.
    return { id: row.id, name: row.name, kind: row.kind, aliases: row.aliases };
  },
  { action: 'matter.write' },
);

export async function upsertPersonAction(raw: unknown): Promise<Result<SavedPerson>> {
  return upsert(raw);
}

const SetRoleEdge = WorkspaceScoped.extend({
  matterId: z.uuid(),
  personId: z.uuid(),
  kind: z.enum(ROLE_EDGE_KINDS),
  remove: z.boolean().optional(),
});

export type RoleEdgeChange = { edgeId: string } | { removed: true };

const roleEdge = workspaceAction(
  SetRoleEdge,
  async (input, ctx) => {
    const { setRoleEdge } = await import('@causedeck/core/matter-graph');
    const row = await setRoleEdge(graphDeps(ctx.tx), actorOf(ctx), {
      kind: input.kind,
      fromPersonId: input.personId,
      matterId: input.matterId,
      ...(input.remove === true ? { remove: true } : {}),
    });
    revalidateMatter();
    if (input.remove === true) return { removed: true as const };
    if (row === null) throw new Error('setRoleEdge returned no edge');
    return { edgeId: row.id };
  },
  { action: 'matter.write' },
);

export async function setRoleEdgeAction(raw: unknown): Promise<Result<RoleEdgeChange>> {
  return roleEdge(raw);
}
