'use server';
// People server actions (#848, #82 part 2). Each goes through `workspaceAction`
// (lib/workspace-action.ts): zod input, `requireSession`, membership asserted by `guard`, so a
// non-member (another workspace's owner included) gets FORBIDDEN before anything runs. The policy
// action is `contact.read`: whether the caller may change a given contact is the contact service's
// decision (owners and advocates always; a junior only through a matter assigned to them; clerks
// and viewers never), returned as FORBIDDEN or NOT_FOUND through `toActionError`. The services run
// on the workspace-scoped transaction `ctx.tx`. No action returns a phone or an email.
// - `createContactAction`: a contact for an existing client (`personId`) or, with `clientName`, for
//   a client of that name made in the same transaction; optionally linked to a matter at once.
// - `updateContactAction`: phone, email or language (a phone or email change is an L3 activity).
// - `undoContactChangeAction`: take back a phone or email change within its window.
// - `linkContactToMatterAction`: link the client to a matter as `represents` or `instructed_by`.
// - `archiveContactAction`: archive, optionally flagging the details for the DPDP erasure sweep.
import {
  ArchiveClientContactInput,
  ClientContactInput,
  LinkContactToMatterInput,
  UpdateClientContactInput,
} from '@causedeck/validators/client-contact';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { graphDeps } from '../../../../../lib/matters/graph-deps.ts';
import { peopleDeps } from '../../../../../lib/people/people-deps.ts';
import { type Result } from '../../../../../lib/safe-action.ts';
import {
  WorkspaceScoped,
  workspaceAction,
  type WorkspaceActionCtx,
} from '../../../../../lib/workspace-action.ts';

function actorOf(ctx: WorkspaceActionCtx) {
  return { workspaceId: ctx.workspaceId, userId: ctx.userId };
}

function revalidatePeople(): void {
  revalidatePath('/w/[slug]/people', 'layout');
}

/** What an action returns: ids only, never the phone or email. */
export interface SavedContact {
  id: string;
  personId: string;
}

const CreateContact = WorkspaceScoped.extend({
  personId: z.uuid().optional(),
  clientName: z.string().trim().min(1).max(300).optional(),
  kind: ClientContactInput.shape.kind.optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  languagePref: ClientContactInput.shape.languagePref.optional(),
  matterId: z.uuid().optional(),
  relation: ClientContactInput.shape.relation.optional(),
}).refine((value) => (value.personId === undefined) !== (value.clientName === undefined), {
  path: ['clientName'],
  message: 'Give a client',
});

const create = workspaceAction(
  CreateContact,
  async (input, ctx) => {
    const { createContact } = await import('@causedeck/core/people');
    const { upsertPerson } = await import('@causedeck/core/matter-graph');
    const { workspaceId: _workspaceId, personId, clientName, ...rest } = input;
    const deps = peopleDeps(ctx.tx);
    const actor = actorOf(ctx);
    let clientId = personId;
    if (clientId === undefined && clientName !== undefined) {
      const client = await upsertPerson(graphDeps(ctx.tx), actor, {
        name: clientName,
        kind: 'client',
      });
      clientId = client.id;
    }
    if (clientId === undefined) throw new Error('A client is required');
    const row = await createContact(deps, actor, { ...stripUndefined(rest), personId: clientId });
    revalidatePeople();
    return { id: row.id, personId: row.personId };
  },
  { action: 'contact.read' },
);

function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}

export async function createContactAction(raw: unknown): Promise<Result<SavedContact>> {
  return create(raw);
}

const update = workspaceAction(
  WorkspaceScoped.extend(UpdateClientContactInput.shape),
  async (input, ctx) => {
    const { updateContact } = await import('@causedeck/core/people');
    const { workspaceId: _workspaceId, ...rest } = input;
    const row = await updateContact(peopleDeps(ctx.tx), actorOf(ctx), stripUndefined(rest));
    revalidatePeople();
    return { id: row.id, personId: row.personId };
  },
  { action: 'contact.read' },
);

export async function updateContactAction(raw: unknown): Promise<Result<SavedContact>> {
  return update(raw);
}

const undo = workspaceAction(
  WorkspaceScoped.extend({ activityId: z.uuid() }),
  async (input, ctx) => {
    const { undoContactChange } = await import('@causedeck/core/people');
    const row = await undoContactChange(peopleDeps(ctx.tx), actorOf(ctx), {
      activityId: input.activityId,
    });
    revalidatePeople();
    return { id: row.id, personId: row.personId };
  },
  { action: 'contact.read' },
);

export async function undoContactChangeAction(raw: unknown): Promise<Result<SavedContact>> {
  return undo(raw);
}

const link = workspaceAction(
  WorkspaceScoped.extend(LinkContactToMatterInput.shape),
  async (input, ctx) => {
    const { linkToMatter } = await import('@causedeck/core/people');
    const { workspaceId: _workspaceId, ...rest } = input;
    const row = await linkToMatter(peopleDeps(ctx.tx), actorOf(ctx), rest);
    revalidatePeople();
    return { id: row.id, personId: row.personId };
  },
  { action: 'contact.read' },
);

export async function linkContactToMatterAction(raw: unknown): Promise<Result<SavedContact>> {
  return link(raw);
}

const archive = workspaceAction(
  WorkspaceScoped.extend(ArchiveClientContactInput.shape),
  async (input, ctx) => {
    const { archiveContact } = await import('@causedeck/core/people');
    const { workspaceId: _workspaceId, ...rest } = input;
    const row = await archiveContact(peopleDeps(ctx.tx), actorOf(ctx), rest);
    revalidatePeople();
    return { id: row.id, personId: row.personId };
  },
  { action: 'contact.read' },
);

export async function archiveContactAction(raw: unknown): Promise<Result<SavedContact>> {
  return archive(raw);
}

