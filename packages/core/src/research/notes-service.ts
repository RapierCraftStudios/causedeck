// Research notes, research facts and workspace provider templates (#80, D-048). A note is the
// lawyer's own text on a matter with the authorities they chose; it is memory-adjacent matter data,
// so reading needs `memory.read` and writing `memory.write` (a clerk has neither) on top of being
// able to read the matter (NOT_FOUND otherwise, like every matter service). A pinned authority is
// data only: nothing here adds a citation to a draft. `getResearchFacts` gives the statute, section
// and court of the matter's confirmed tags, plus the lawyer's issue words only to an actor with
// `strategy.read`; the matter id, CNR and party names are never part of the facts. Provider
// templates are per workspace and need `workspace.manage`. Same access pattern as `alerts.ts`.
import { isRole } from '@causedeck/auth';
import { can, type Action, type Actor, type PolicySettings } from '@causedeck/auth/policy';
import { matterVisibilityPredicate } from '@causedeck/auth/policy/visibility';
import {
  currentScope,
  isUuid,
  schema,
  withWorkspace,
  type Queryable,
  type Transaction,
} from '@causedeck/db';
import {
  providerTemplateInput,
  researchAuthority,
  researchNoteInput,
  type ProviderTemplateInput,
  type ResearchAuthorityInput,
  type ResearchNoteInput,
} from '@causedeck/validators';
import { and, asc, desc, eq, sql } from 'drizzle-orm';

import { forbidden, invalid, notFound } from '../shared/errors.ts';
import { getRoleSettings, memberRole, toPolicySettings } from '../workspaces/index.ts';

import type { ResearchActor } from './alerts.ts';
import type { ResearchFacts } from './links.ts';
import {
  BUILT_IN_PROVIDERS,
  providerFromTemplate,
  validateProviderTemplate,
  type ResearchProvider,
} from './providers.ts';

const { matter, matterIssueTag, member, proceeding, forum, researchNote, researchProvider } = schema;

export interface ResearchNoteRow {
  id: string;
  matterId: string;
  title: string;
  body: string;
  authorities: schema.ResearchAuthority[];
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProviderTemplateRow {
  key: string;
  label: string;
  urlTemplate: string;
  enabled: boolean;
}

type MatterActionName = Extract<Action, 'memory.read' | 'memory.write' | 'matter.read'>;

const matterNotFound = () => notFound('Matter not found');

/** The user id owning the matter, for a junior's "matters they own" visibility. */
const matterOwnerUserId = sql`(select ${member.userId} from ${member} where ${member.organizationId} = ${matter.workspaceId} and ${member.id} = ${matter.ownerMemberId})`;

async function mayReadMatter(
  tx: Transaction,
  reader: Actor,
  settings: PolicySettings,
  matterId: string,
): Promise<boolean> {
  if (!can(reader, 'matter.read', undefined, settings).allow) return false;
  const rows = await tx
    .select({ id: matter.id })
    .from(matter)
    .where(
      and(
        eq(matter.workspaceId, reader.workspaceId),
        eq(matter.id, matterId),
        matterVisibilityPredicate(reader, matter.id, { settings, ownerUserId: matterOwnerUserId }),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/** Run `fn` as the actor's active membership in their own workspace; NOT_FOUND for any other. */
async function asMember<T>(
  db: Queryable,
  actor: ResearchActor,
  fn: (tx: Transaction, reader: Actor, settings: PolicySettings) => Promise<T>,
): Promise<T> {
  const { workspaceId, userId } = actor;
  if (!isUuid(workspaceId) || !isUuid(userId)) throw matterNotFound();
  const outer = currentScope();
  if (
    outer?.kind === 'workspace' &&
    outer.workspaceId?.toLowerCase() !== workspaceId.toLowerCase()
  ) {
    throw matterNotFound();
  }
  return withWorkspace(db, { workspaceId, userId }, async (tx) => {
    const role = await memberRole(tx, userId, workspaceId);
    if (role === null || !isRole(role)) throw matterNotFound();
    const settings = toPolicySettings(await getRoleSettings(tx, workspaceId));
    return fn(tx, { ...actor, role }, settings);
  });
}

/** `asMember` on a matter the actor may read and may use `action` on (FORBIDDEN otherwise). */
async function asMatterMember<T>(
  db: Queryable,
  actor: ResearchActor,
  matterId: string,
  action: MatterActionName,
  fn: (tx: Transaction, reader: Actor, settings: PolicySettings) => Promise<T>,
): Promise<T> {
  if (!isUuid(matterId)) throw matterNotFound();
  return asMember(db, actor, async (tx, reader, settings) => {
    if (!(await mayReadMatter(tx, reader, settings, matterId))) throw matterNotFound();
    if (!can(reader, action, undefined, settings).allow) {
      throw forbidden('You cannot use research notes on this matter');
    }
    return fn(tx, reader, settings);
  });
}

const noteColumns = {
  id: researchNote.id,
  matterId: researchNote.matterId,
  title: researchNote.title,
  body: researchNote.body,
  authorities: researchNote.authorities,
  createdBy: researchNote.createdBy,
  createdAt: researchNote.createdAt,
  updatedAt: researchNote.updatedAt,
};

function parseOrInvalid<T>(result: { success: true; data: T } | { success: false }, what: string): T {
  if (!result.success) throw invalid(`Check the ${what}`);
  return result.data;
}

const noteScope = (actor: ResearchActor, matterId: string, noteId: string) =>
  and(
    eq(researchNote.workspaceId, actor.workspaceId),
    eq(researchNote.matterId, matterId),
    eq(researchNote.id, noteId),
  );

/** The matter's notes, newest first. Needs `memory.read`. */
export async function listNotes(
  db: Queryable,
  actor: ResearchActor,
  matterId: string,
): Promise<ResearchNoteRow[]> {
  return asMatterMember(db, actor, matterId, 'memory.read', (tx) =>
    tx
      .select(noteColumns)
      .from(researchNote)
      .where(
        and(eq(researchNote.workspaceId, actor.workspaceId), eq(researchNote.matterId, matterId)),
      )
      .orderBy(desc(researchNote.updatedAt), asc(researchNote.id)),
  );
}

export async function createNote(
  db: Queryable,
  actor: ResearchActor,
  input: { matterId: string } & Partial<ResearchNoteInput>,
): Promise<ResearchNoteRow> {
  const { matterId, ...rest } = input;
  const note = parseOrInvalid(researchNoteInput.safeParse(rest), 'note');
  return asMatterMember(db, actor, matterId, 'memory.write', async (tx) => {
    const [row] = await tx
      .insert(researchNote)
      .values({
        workspaceId: actor.workspaceId,
        matterId,
        title: note.title,
        body: note.body,
        authorities: note.authorities,
        createdBy: actor.userId,
      })
      .returning(noteColumns);
    if (!row) throw invalid('The note was not saved');
    return row;
  });
}

export async function updateNote(
  db: Queryable,
  actor: ResearchActor,
  input: { matterId: string; noteId: string; title: string; body: string },
): Promise<ResearchNoteRow> {
  const note = parseOrInvalid(
    researchNoteInput.pick({ title: true, body: true }).safeParse(input),
    'note',
  );
  return asMatterMember(db, actor, input.matterId, 'memory.write', async (tx) => {
    const [row] = await tx
      .update(researchNote)
      .set({ title: note.title, body: note.body, updatedAt: new Date() })
      .where(noteScope(actor, input.matterId, input.noteId))
      .returning(noteColumns);
    if (!row) throw notFound('Note not found');
    return row;
  });
}

export async function deleteNote(
  db: Queryable,
  actor: ResearchActor,
  input: { matterId: string; noteId: string },
): Promise<void> {
  await asMatterMember(db, actor, input.matterId, 'memory.write', async (tx) => {
    const rows = await tx
      .delete(researchNote)
      .where(noteScope(actor, input.matterId, input.noteId))
      .returning({ id: researchNote.id });
    if (rows.length === 0) throw notFound('Note not found');
  });
}

/** Read-modify-write of one note's authorities under a row lock. */
async function changeAuthorities(
  db: Queryable,
  actor: ResearchActor,
  ref: { matterId: string; noteId: string },
  change: (list: schema.ResearchAuthority[]) => schema.ResearchAuthority[],
): Promise<ResearchNoteRow> {
  return asMatterMember(db, actor, ref.matterId, 'memory.write', async (tx) => {
    const [current] = await tx
      .select({ authorities: researchNote.authorities })
      .from(researchNote)
      .where(noteScope(actor, ref.matterId, ref.noteId))
      .for('update');
    if (!current) throw notFound('Note not found');
    const authorities = change([...current.authorities]);
    const [row] = await tx
      .update(researchNote)
      .set({ authorities, updatedAt: new Date() })
      .where(noteScope(actor, ref.matterId, ref.noteId))
      .returning(noteColumns);
    if (!row) throw notFound('Note not found');
    return row;
  });
}

/** Add a chosen authority; it starts unpinned unless the lawyer pins it. Nothing is cited anywhere. */
export async function addAuthority(
  db: Queryable,
  actor: ResearchActor,
  input: { matterId: string; noteId: string; authority: Partial<ResearchAuthorityInput> },
): Promise<ResearchNoteRow> {
  const authority = parseOrInvalid(researchAuthority.safeParse(input.authority), 'authority');
  return changeAuthorities(db, actor, input, (list) => {
    if (list.length >= 50) throw invalid('A note holds at most 50 authorities');
    return [...list, authority];
  });
}

export async function removeAuthority(
  db: Queryable,
  actor: ResearchActor,
  input: { matterId: string; noteId: string; index: number },
): Promise<ResearchNoteRow> {
  return changeAuthorities(db, actor, input, (list) => {
    if (!Number.isInteger(input.index) || input.index < 0 || input.index >= list.length) {
      throw notFound('Authority not found');
    }
    return list.filter((_, i) => i !== input.index);
  });
}

/** Pin or unpin an authority: a flag on the note's data, never a draft edit. */
export async function setAuthorityPinned(
  db: Queryable,
  actor: ResearchActor,
  input: { matterId: string; noteId: string; index: number; pinned: boolean },
): Promise<ResearchNoteRow> {
  return changeAuthorities(db, actor, input, (list) => {
    const current = list[input.index];
    if (!Number.isInteger(input.index) || current === undefined) {
      throw notFound('Authority not found');
    }
    return list.map((a, i) => (i === input.index ? { ...a, pinned: input.pinned } : a));
  });
}

/** Longest issue phrase placed in a query (the lawyer sees it in the preview). */
const KEYWORD_MAX = 100;

/**
 * The facts of the matter's confirmed tags as research facts, one per tag. Issue words are
 * included only when `readStrategy` (the actor's `strategy.read`); otherwise the facts carry the
 * statute, section and court alone. Pure.
 */
export function researchFactsFromTags(
  tags: readonly { statute: string; section: string; issue: string | null; status: string }[],
  court: string,
  readStrategy: boolean,
): ResearchFacts[] {
  return tags
    .filter((tag) => tag.status === 'confirmed')
    .map((tag) => ({
      statute: tag.statute,
      section: tag.section,
      keywords: readStrategy && tag.issue ? [tag.issue.trim().slice(0, KEYWORD_MAX)] : [],
      court,
    }));
}

/** Research facts of a matter for the link-out menu; needs only the right to read the matter. */
export async function getResearchFacts(
  db: Queryable,
  actor: ResearchActor,
  matterId: string,
): Promise<ResearchFacts[]> {
  return asMatterMember(db, actor, matterId, 'matter.read', async (tx, reader, settings) => {
    const tags = await tx
      .select({
        statute: matterIssueTag.statute,
        section: matterIssueTag.section,
        issue: matterIssueTag.issue,
        status: matterIssueTag.status,
      })
      .from(matterIssueTag)
      .where(
        and(
          eq(matterIssueTag.workspaceId, actor.workspaceId),
          eq(matterIssueTag.matterId, matterId),
        ),
      )
      .orderBy(asc(matterIssueTag.statute), asc(matterIssueTag.section));
    const courts = await tx
      .select({ court: forum.court })
      .from(proceeding)
      .innerJoin(forum, eq(forum.id, proceeding.forumId))
      .where(and(eq(proceeding.workspaceId, actor.workspaceId), eq(proceeding.matterId, matterId)))
      .orderBy(asc(proceeding.createdAt))
      .limit(1);
    const court = courts[0]?.court ?? '';
    const facts = researchFactsFromTags(
      tags,
      court,
      can(reader, 'strategy.read', undefined, settings).allow,
    );
    // A matter with a court but no confirmed tag still gets a court-only query.
    return facts.length === 0 && court !== ''
      ? [{ statute: '', section: '', keywords: [], court }]
      : facts;
  });
}

/** The workspace's saved templates, for the settings page. Needs `workspace.manage`. */
export async function listProviderTemplates(
  db: Queryable,
  actor: ResearchActor,
): Promise<ProviderTemplateRow[]> {
  return asMember(db, actor, async (tx, reader, settings) => {
    if (!can(reader, 'workspace.manage', undefined, settings).allow) {
      throw forbidden('Only an advocate can manage research providers');
    }
    return tx
      .select({
        key: researchProvider.key,
        label: researchProvider.label,
        urlTemplate: researchProvider.urlTemplate,
        enabled: researchProvider.enabled,
      })
      .from(researchProvider)
      .where(eq(researchProvider.workspaceId, actor.workspaceId))
      .orderBy(asc(researchProvider.label));
  });
}

/** Save (or replace by key) a workspace template; an unsafe or malformed template is VALIDATION. */
export async function saveProviderTemplate(
  db: Queryable,
  actor: ResearchActor,
  input: Partial<ProviderTemplateInput>,
): Promise<ProviderTemplateRow> {
  const template = parseOrInvalid(providerTemplateInput.safeParse(input), 'provider');
  const check = validateProviderTemplate(template.urlTemplate);
  if (!check.ok) throw invalid(check.reason);
  if (BUILT_IN_PROVIDERS.some((p) => p.key === template.key)) {
    throw invalid('That key is used by a built-in provider');
  }
  return asMember(db, actor, async (tx, reader, settings) => {
    if (!can(reader, 'workspace.manage', undefined, settings).allow) {
      throw forbidden('Only an advocate can manage research providers');
    }
    const [row] = await tx
      .insert(researchProvider)
      .values({ workspaceId: actor.workspaceId, ...template })
      .onConflictDoUpdate({
        target: [researchProvider.workspaceId, researchProvider.key],
        set: {
          label: template.label,
          urlTemplate: template.urlTemplate,
          enabled: template.enabled,
          updatedAt: new Date(),
        },
      })
      .returning({
        key: researchProvider.key,
        label: researchProvider.label,
        urlTemplate: researchProvider.urlTemplate,
        enabled: researchProvider.enabled,
      });
    if (!row) throw invalid('The provider was not saved');
    return row;
  });
}

export async function removeProviderTemplate(
  db: Queryable,
  actor: ResearchActor,
  key: string,
): Promise<void> {
  await asMember(db, actor, async (tx, reader, settings) => {
    if (!can(reader, 'workspace.manage', undefined, settings).allow) {
      throw forbidden('Only an advocate can manage research providers');
    }
    const rows = await tx
      .delete(researchProvider)
      .where(and(eq(researchProvider.workspaceId, actor.workspaceId), eq(researchProvider.key, key)))
      .returning({ id: researchProvider.id });
    if (rows.length === 0) throw notFound('Provider not found');
  });
}

/**
 * The providers the link-out menu uses: the built-in pages plus the workspace's enabled templates
 * that still validate. Any member who may use the workspace; no manage right needed.
 */
export async function listLinkProviders(
  db: Queryable,
  actor: ResearchActor,
): Promise<ResearchProvider[]> {
  return asMember(db, actor, async (tx) => {
    const rows = await tx
      .select({
        key: researchProvider.key,
        label: researchProvider.label,
        urlTemplate: researchProvider.urlTemplate,
      })
      .from(researchProvider)
      .where(
        and(eq(researchProvider.workspaceId, actor.workspaceId), eq(researchProvider.enabled, true)),
      )
      .orderBy(asc(researchProvider.label));
    const own = rows.flatMap((row) => providerFromTemplate(row) ?? []);
    return [...BUILT_IN_PROVIDERS, ...own];
  });
}
