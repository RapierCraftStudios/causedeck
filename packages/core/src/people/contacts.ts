// Client contacts (#82, part 1 of 3): `createContact`, `updateContact`, `linkToMatter`,
// `archiveContact`, `listContacts` and `undoContactChange`. A contact is the phone, email and
// language of an existing client (a `person` of kind client); every id is resolved inside the
// actor's workspace, so another workspace's contact, person or matter is NOT_FOUND. Roles: owners
// and advocates manage (`contact.write`); a junior only on matters they are assigned to (owner or
// allow-listed, `matter.write` on that matter), where they create and link contacts and change those
// already linked to such a matter; a clerk sees logistics only (name, language, links, never the phone
// or email) and cannot write; a viewer reads. A phone or email change is an L3 `activity` the actor
// can undo for seven days; a language change emits `contact.language_changed`. Links are role edges
// (`represents` / `instructed_by`) written by the matter graph's `setRoleEdge`, so its matter gate and
// `role_edge.set` event apply. Events are emitted once the transaction has committed.
import { isRole } from '@causedeck/auth';
import { can, type Action, type Actor, type PolicySettings } from '@causedeck/auth/policy';
import {
  currentScope,
  isUuid,
  schema,
  withWorkspace,
  type Database,
  type Transaction,
} from '@causedeck/db';
import {
  ArchiveClientContactInput,
  ClientContactInput,
  ContactIdInput,
  LinkContactToMatterInput,
  ListContactsInput,
  UpdateClientContactInput,
  type ContactMatterRelation,
} from '@causedeck/validators/client-contact';
import { and, asc, eq, inArray, isNotNull, isNull, type SQL } from 'drizzle-orm';
import type { z } from 'zod';

import {
  crossWorkspace,
  setRoleEdge,
  type GraphActor,
  type GraphEvent,
  type GraphEvents,
} from '../matter-graph/index.ts';
import { conflict, forbidden, invalid, notFound } from '../shared/errors.ts';
import { getRoleSettings, memberRole, toPolicySettings } from '../workspaces/index.ts';

import type { PeopleEvent, PeopleEvents } from './events.ts';

const { activity, clientContact, matter, matterRestriction, member, person, roleEdge } = schema;

/** A contact with no matter link this long after it was created is flagged `unlinked`. */
export const UNLINKED_AFTER_MS = 24 * 60 * 60 * 1000;
/** How long a phone or email change can be undone, as for every L3 activity. */
const UNDO_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/** The activity kind of a phone or email change. */
const CONTACT_ACTIVITY_KIND = 'contact_detail';
const LINK_KINDS: readonly ContactMatterRelation[] = ['represents', 'instructed_by'];

export type PeopleActor = GraphActor;

export interface PeopleDeps {
  db: Database | Transaction;
  events: PeopleEvents;
  /** Receives the matter graph's own events (`role_edge.set`) for the links made here. */
  graphEvents: GraphEvents;
  /** Policy settings; the workspace's stored role settings apply when omitted. */
  settings?: PolicySettings;
  /** The clock; the system clock when omitted. */
  now?: () => Date;
}

type ContactRow = typeof clientContact.$inferSelect;

/** One contact as a caller sees it; a clerk gets `phone` and `email` as null and `redacted` true. */
export interface ContactView {
  id: string;
  personId: string;
  personName: string;
  kind: ContactRow['kind'];
  phone: string | null;
  email: string | null;
  languagePref: ContactRow['languagePref'];
  archivedAt: Date | null;
  purgeRequested: boolean;
  createdAt: Date;
  /** Matters the client is linked to (`represents` or `instructed_by`). */
  linkedCount: number;
  /** No matter link more than 24 hours after the contact was created. */
  unlinked: boolean;
  redacted: boolean;
}

interface Scope {
  tx: Transaction;
  actor: Actor;
  settings: PolicySettings;
  now: Date;
  events: PeopleEvent[];
  graphEvents: GraphEvent[];
}

function parse<S extends z.ZodType>(schemaOf: S, input: unknown): z.output<S> {
  const parsed = schemaOf.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue && issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
    throw invalid(`${where}${issue?.message ?? 'Invalid input'}`);
  }
  return parsed.data;
}

function sqlState(error: unknown): { code?: string; constraint?: string } {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && typeof current === 'object' && current !== null; depth++) {
    const { code, constraint_name, cause } = current as {
      code?: unknown;
      constraint_name?: unknown;
      cause?: unknown;
    };
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) {
      return {
        code,
        ...(typeof constraint_name === 'string' ? { constraint: constraint_name } : {}),
      };
    }
    current = cause;
  }
  return {};
}

/**
 * Run `fn` in the actor's workspace scope with the role from the membership (never the caller's);
 * emit the buffered events once the scope has resolved, so a rolled-back write emits nothing.
 */
async function inPeopleScope<T>(
  deps: PeopleDeps,
  actor: PeopleActor,
  fn: (scope: Scope) => Promise<T>,
): Promise<T> {
  if (!isUuid(actor.workspaceId) || !isUuid(actor.userId)) throw notFound('Contact not found');
  const outer = currentScope();
  if (
    outer?.kind === 'workspace' &&
    outer.workspaceId?.toLowerCase() !== actor.workspaceId.toLowerCase()
  ) {
    throw crossWorkspace();
  }
  const events: PeopleEvent[] = [];
  const graphEvents: GraphEvent[] = [];
  const { workspaceId, userId } = actor;
  const result = await withWorkspace(deps.db, { workspaceId, userId }, async (tx) => {
    const role = await memberRole(tx, userId, workspaceId);
    if (role === null || !isRole(role)) throw notFound('Contact not found');
    const settings = deps.settings ?? toPolicySettings(await getRoleSettings(tx, workspaceId));
    const now = deps.now?.() ?? new Date();
    return fn({ tx, actor: { ...actor, role }, settings, now, events, graphEvents });
  });
  for (const event of graphEvents) deps.graphEvents.emit(event);
  for (const event of events) deps.events.emit(event);
  return result;
}

/** The nested matter-graph deps: the open transaction, with events held back until commit. */
function graphDeps(deps: PeopleDeps, scope: Scope) {
  return {
    db: scope.tx,
    events: { emit: (event: GraphEvent) => scope.graphEvents.push(event) },
    ...(deps.settings === undefined ? {} : { settings: deps.settings }),
    now: () => scope.now,
  };
}

/** Owners and advocates (`contact.write`); everyone else needs a matter they are assigned to. */
function isManager(scope: Scope): boolean {
  return can(scope.actor, 'contact.write', undefined, scope.settings).allow;
}

/** Of `matterIds`, those on which the actor may `action` (restriction and assignment applied). */
async function allowedMatters(
  scope: Scope,
  matterIds: readonly string[],
  action: Action,
): Promise<Set<string>> {
  if (matterIds.length === 0) return new Set();
  const { tx, actor, settings } = scope;
  const rows = await tx
    .select({
      id: matter.id,
      ownerUserId: member.userId,
      allowUserIds: matterRestriction.allowedUserIds,
    })
    .from(matter)
    .leftJoin(
      member,
      and(eq(member.organizationId, matter.workspaceId), eq(member.id, matter.ownerMemberId)),
    )
    .leftJoin(
      matterRestriction,
      and(
        eq(matterRestriction.workspaceId, matter.workspaceId),
        eq(matterRestriction.matterId, matter.id),
      ),
    )
    .where(and(eq(matter.workspaceId, actor.workspaceId), inArray(matter.id, [...matterIds])));
  const allowed = new Set<string>();
  for (const row of rows) {
    const resource = {
      kind: 'matter',
      workspaceId: actor.workspaceId,
      matterId: row.id,
      ...(row.allowUserIds === null ? {} : { restricted: { allowUserIds: row.allowUserIds } }),
      ...(row.ownerUserId === null ? {} : { ownerUserId: row.ownerUserId }),
    };
    if (
      can(actor, 'matter.read', resource, settings).allow &&
      can(actor, action, resource, settings).allow
    ) {
      allowed.add(row.id);
    }
  }
  return allowed;
}

/** The matters each person is linked to by `represents` or `instructed_by`. */
async function linksOf(
  tx: Transaction,
  workspaceId: string,
  personIds: readonly string[],
): Promise<Map<string, string[]>> {
  const links = new Map<string, string[]>();
  if (personIds.length === 0) return links;
  const rows = await tx
    .select({ personId: roleEdge.fromPersonId, matterId: roleEdge.matterId })
    .from(roleEdge)
    .where(
      and(
        eq(roleEdge.workspaceId, workspaceId),
        inArray(roleEdge.fromPersonId, [...personIds]),
        inArray(roleEdge.kind, [...LINK_KINDS]),
        isNotNull(roleEdge.matterId),
      ),
    );
  for (const { personId, matterId } of rows) {
    if (matterId === null) continue;
    links.set(personId, [...(links.get(personId) ?? []), matterId]);
  }
  return links;
}

async function loadContact(scope: Scope, contactId: string): Promise<ContactRow> {
  const [row] = await scope.tx
    .select()
    .from(clientContact)
    .where(
      and(eq(clientContact.workspaceId, scope.actor.workspaceId), eq(clientContact.id, contactId)),
    )
    .limit(1);
  if (row === undefined) throw notFound('Contact not found');
  return row;
}

/** The contact if the actor may change it: managers always, a junior through an assigned matter. */
async function requireWritable(scope: Scope, contactId: string): Promise<ContactRow> {
  const { actor } = scope;
  if (!can(actor, 'contact.read', undefined, scope.settings).allow)
    throw notFound('Contact not found');
  const row = await loadContact(scope, contactId);
  if (isManager(scope)) return row;
  if (actor.role !== 'junior') throw forbidden('You cannot change client contacts');
  if (row.createdBy === actor.userId) return row;
  const matterIds = (await linksOf(scope.tx, actor.workspaceId, [row.personId])).get(row.personId);
  const writable = await allowedMatters(scope, matterIds ?? [], 'matter.write');
  if (writable.size === 0)
    throw forbidden('You can change contacts only on matters assigned to you');
  return row;
}

async function requireClient(scope: Scope, personId: string): Promise<void> {
  const [row] = await scope.tx
    .select({ kind: person.kind })
    .from(person)
    .where(and(eq(person.workspaceId, scope.actor.workspaceId), eq(person.id, personId)))
    .limit(1);
  if (row === undefined) throw notFound('Person not found');
  if (row.kind !== 'client') throw invalid('personId: Contacts are kept only for clients');
}

async function link(
  deps: PeopleDeps,
  scope: Scope,
  row: ContactRow,
  matterId: string,
  relation: ContactMatterRelation,
): Promise<void> {
  const edge = await setRoleEdge(graphDeps(deps, scope), scope.actor, {
    kind: relation,
    fromPersonId: row.personId,
    matterId,
  });
  if (edge === null) throw notFound('Matter not found');
}

/** A new contact for an existing client; a junior must link it to a matter assigned to them. */
export async function createContact(
  deps: PeopleDeps,
  actor: PeopleActor,
  input: ClientContactInput,
): Promise<ContactRow> {
  const data = parse(ClientContactInput, input);
  return inPeopleScope(deps, actor, async (scope) => {
    const manager = isManager(scope);
    if (!manager) {
      if (scope.actor.role !== 'junior') throw forbidden('You cannot change client contacts');
      if (data.matterId === undefined)
        throw forbidden('Link the contact to a matter assigned to you');
      const writable = await allowedMatters(scope, [data.matterId], 'matter.write');
      if (!writable.has(data.matterId))
        throw forbidden('You can add contacts only on matters assigned to you');
    }
    await requireClient(scope, data.personId);
    let row: ContactRow | undefined;
    try {
      // A savepoint, so the unique violation leaves the workspace transaction usable.
      [row] = await scope.tx.transaction((sp) =>
        sp
          .insert(clientContact)
          .values({
            workspaceId: scope.actor.workspaceId,
            personId: data.personId,
            kind: data.kind,
            phone: data.phone ?? null,
            email: data.email ?? null,
            languagePref: data.languagePref,
            createdBy: scope.actor.userId,
          })
          .returning(),
      );
    } catch (error) {
      if (sqlState(error).code === '23505') {
        throw conflict('This client already has a contact of this kind');
      }
      throw error;
    }
    if (!row) throw new Error('createContact: insert returned no row');
    if (data.matterId !== undefined) await link(deps, scope, row, data.matterId, data.relation);
    return row;
  });
}

/**
 * Change a contact's phone, email or language. A phone or email change records an L3 activity
 * (`undoContactChange`); a language change emits `contact.language_changed`.
 */
export async function updateContact(
  deps: PeopleDeps,
  actor: PeopleActor,
  input: UpdateClientContactInput,
): Promise<ContactRow> {
  const data = parse(UpdateClientContactInput, input);
  return inPeopleScope(deps, actor, async (scope) => {
    const before = await requireWritable(scope, data.contactId);
    if (before.archivedAt !== null) throw conflict('This contact is archived');
    const phone = data.phone === undefined ? before.phone : data.phone;
    const email = data.email === undefined ? before.email : data.email;
    if (phone === null && email === null)
      throw invalid('phone: A contact keeps a phone or an email');
    const languagePref = data.languagePref ?? before.languagePref;
    const detailsChanged = phone !== before.phone || email !== before.email;
    if (!detailsChanged && languagePref === before.languagePref) return before;

    const [row] = await scope.tx
      .update(clientContact)
      .set({ phone, email, languagePref, updatedAt: scope.now })
      .where(
        and(
          eq(clientContact.workspaceId, scope.actor.workspaceId),
          eq(clientContact.id, before.id),
        ),
      )
      .returning();
    if (!row) throw notFound('Contact not found');

    if (detailsChanged) {
      const fields = [
        ...(phone !== before.phone ? ['phone'] : []),
        ...(email !== before.email ? ['email'] : []),
      ];
      await scope.tx.insert(activity).values({
        workspaceId: scope.actor.workspaceId,
        kind: CONTACT_ACTIVITY_KIND,
        level: 'L3',
        actor: 'user',
        actorUserId: scope.actor.userId,
        summary: `Changed a client contact's ${fields.join(' and ')}`,
        entityRefs: { contactId: row.id, personId: row.personId },
        undoPayload: {
          contactId: row.id,
          before: { phone: before.phone, email: before.email },
          after: { phone, email },
        },
        undoExpiresAt: new Date(scope.now.getTime() + UNDO_WINDOW_MS),
        source: { type: 'manual' },
      });
    }
    if (languagePref !== before.languagePref) {
      scope.events.push({
        type: 'contact.language_changed',
        workspaceId: scope.actor.workspaceId,
        actorUserId: scope.actor.userId,
        contactId: row.id,
        personId: row.personId,
        from: before.languagePref,
        to: languagePref,
      });
    }
    return row;
  });
}

/** Take back a phone or email change within its undo window, if the contact has not changed since. */
export async function undoContactChange(
  deps: PeopleDeps,
  actor: PeopleActor,
  input: { activityId: string },
): Promise<ContactRow> {
  const { contactId: activityId } = parse(ContactIdInput, { contactId: input.activityId });
  return inPeopleScope(deps, actor, async (scope) => {
    const [act] = await scope.tx
      .select()
      .from(activity)
      .where(
        and(
          eq(activity.workspaceId, scope.actor.workspaceId),
          eq(activity.id, activityId),
          eq(activity.kind, CONTACT_ACTIVITY_KIND),
        ),
      )
      .limit(1)
      .for('update');
    if (act === undefined) throw notFound('Activity not found');
    const payload = act.undoPayload as {
      contactId: string;
      before: { phone: string | null; email: string | null };
      after: { phone: string | null; email: string | null };
    } | null;
    if (payload === null) throw conflict('This change cannot be undone');
    const current = await requireWritable(scope, payload.contactId);
    if (act.undoneAt !== null) throw conflict('This was already undone');
    if (act.confirmedAt !== null || act.undoExpiresAt.getTime() < scope.now.getTime()) {
      throw conflict('The undo window for this change has passed');
    }
    if (current.phone !== payload.after.phone || current.email !== payload.after.email) {
      throw conflict('The contact changed again since; undo that change first');
    }
    const [row] = await scope.tx
      .update(clientContact)
      .set({ phone: payload.before.phone, email: payload.before.email, updatedAt: scope.now })
      .where(
        and(
          eq(clientContact.workspaceId, scope.actor.workspaceId),
          eq(clientContact.id, current.id),
        ),
      )
      .returning();
    if (!row) throw notFound('Contact not found');
    await scope.tx
      .update(activity)
      .set({ undoneAt: scope.now, undoneBy: scope.actor.userId })
      .where(and(eq(activity.workspaceId, scope.actor.workspaceId), eq(activity.id, act.id)));
    return row;
  });
}

/** Link a contact's client to a matter as `represents` or `instructed_by` (needs `matter.write` on it). */
export async function linkToMatter(
  deps: PeopleDeps,
  actor: PeopleActor,
  input: LinkContactToMatterInput,
): Promise<ContactRow> {
  const data = parse(LinkContactToMatterInput, input);
  return inPeopleScope(deps, actor, async (scope) => {
    const row = await requireWritable(scope, data.contactId);
    if (row.archivedAt !== null) throw conflict('This contact is archived');
    await link(deps, scope, row, data.matterId, data.relation);
    return row;
  });
}

/** Archive a contact; `purge` also flags it for the DPDP erasure sweep (which clears the details). */
export async function archiveContact(
  deps: PeopleDeps,
  actor: PeopleActor,
  input: ArchiveClientContactInput,
): Promise<ContactRow> {
  const data = parse(ArchiveClientContactInput, input);
  return inPeopleScope(deps, actor, async (scope) => {
    const row = await requireWritable(scope, data.contactId);
    if (row.archivedAt !== null && (row.purgeRequested || !data.purge)) return row;
    const [updated] = await scope.tx
      .update(clientContact)
      .set({
        archivedAt: row.archivedAt ?? scope.now,
        purgeRequested: row.purgeRequested || data.purge,
        updatedAt: scope.now,
      })
      .where(
        and(eq(clientContact.workspaceId, scope.actor.workspaceId), eq(clientContact.id, row.id)),
      )
      .returning();
    if (!updated) throw notFound('Contact not found');
    return updated;
  });
}

/**
 * The workspace's contacts with their link counts, oldest first. A junior sees the contacts they
 * created or that are linked to a matter assigned to them; a clerk gets no phone or email.
 */
export async function listContacts(
  deps: PeopleDeps,
  actor: PeopleActor,
  input: ListContactsInput = {},
): Promise<ContactView[]> {
  const data = parse(ListContactsInput, input);
  return inPeopleScope(deps, actor, async (scope) => {
    const { tx, actor: who } = scope;
    if (!can(who, 'contact.read', undefined, scope.settings).allow)
      throw notFound('Contact not found');
    const filters: SQL[] = [eq(clientContact.workspaceId, who.workspaceId)];
    if (data.personId !== undefined) filters.push(eq(clientContact.personId, data.personId));
    if (!data.includeArchived) filters.push(isNull(clientContact.archivedAt));
    const rows = await tx
      .select({ contact: clientContact, personName: person.name })
      .from(clientContact)
      .innerJoin(
        person,
        and(
          eq(person.workspaceId, clientContact.workspaceId),
          eq(person.id, clientContact.personId),
        ),
      )
      .where(and(...filters))
      .orderBy(asc(clientContact.createdAt), asc(clientContact.id));

    const personIds = [...new Set(rows.map((r) => r.contact.personId))];
    const links = await linksOf(tx, who.workspaceId, personIds);

    let visible = rows;
    if (who.role === 'junior') {
      const all = [...new Set([...links.values()].flat())];
      const writable = await allowedMatters(scope, all, 'matter.write');
      visible = rows.filter(
        (r) =>
          r.contact.createdBy === who.userId ||
          (links.get(r.contact.personId) ?? []).some((id) => writable.has(id)),
      );
    }
    const redacted = who.role === 'clerk';
    return visible.map(({ contact, personName }): ContactView => {
      const linkedCount = new Set(links.get(contact.personId) ?? []).size;
      return {
        id: contact.id,
        personId: contact.personId,
        personName,
        kind: contact.kind,
        phone: redacted ? null : contact.phone,
        email: redacted ? null : contact.email,
        languagePref: contact.languagePref,
        archivedAt: contact.archivedAt,
        purgeRequested: contact.purgeRequested,
        createdAt: contact.createdAt,
        linkedCount,
        unlinked:
          linkedCount === 0 &&
          scope.now.getTime() - contact.createdAt.getTime() >= UNLINKED_AFTER_MS,
        redacted,
      };
    });
  });
}
