// Client status links (#88, ADR 0049): an advocate turns a short note they wrote for an existing
// client contact into an expiring, revocable link and shares it themselves. The link stores only
// the authored fields and the sha-256 of the token. The full URL is returned once, at creation.
// This module never sends anything: it imports no transport, and there is no job or system caller.
// Every service refuses with `FeatureDisabledError` while the legal-gated `status_links.enabled`
// flag is off for the workspace, before it reads or writes anything else.
import { createHash, randomBytes } from 'node:crypto';

import { atLeast, isRole } from '@causedeck/auth';
import { can, type Actor, type PolicySettings, type Resource } from '@causedeck/auth/policy';
import { isUuid, schema, withWorkspace, type Database, type Transaction } from '@causedeck/db';
import { isEnabled } from '@causedeck/flags';
import {
  STATUS_LINK_MAX_EXPIRY_DAYS,
  StatusLinkExtend,
  StatusLinkInput,
  type StatusLinkLanguage,
} from '@causedeck/validators/status-link';
import { and, count, desc, eq, inArray, isNull } from 'drizzle-orm';
import type { z } from 'zod';

import { record } from '../audit/index.ts';
import { getDraft, type OutwardDeps } from '../outward/index.ts';
import { WorkspaceError, conflict, forbidden, invalid, notFound } from '../shared/errors.ts';
import { activeMember } from '../shared/membership.ts';
import { getRoleSettings, memberRole, toPolicySettings } from '../workspaces/index.ts';

export const STATUS_LINKS_FLAG = 'status_links.enabled';
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_LISTED = 50;

const { statusLink, statusLinkAccess, clientContact, matter, matterRestriction, member } = schema;

/** The legal-gated flag is off for the workspace: nothing was read or written. */
export class FeatureDisabledError extends WorkspaceError {
  readonly flag: string;

  constructor(flag: string = STATUS_LINKS_FLAG) {
    super('FORBIDDEN', 'Client status links are not enabled for this workspace');
    this.name = 'FeatureDisabledError';
    this.flag = flag;
  }
}

export interface StatusLinkActor {
  workspaceId: string;
  userId: string;
}

export interface StatusLinkDeps {
  db: Database | Transaction;
  /** The flag read; `isEnabled('status_links.enabled')` when omitted. */
  flagEnabled?: (workspaceId: string) => Promise<boolean>;
  /** Policy settings; the workspace's stored role settings apply when omitted. */
  settings?: PolicySettings;
  /** The clock; the system clock when omitted. */
  now?: () => Date;
  /** The origin links are built on (`STATUS_LINKS_BASE_URL`, else the app origin). */
  baseUrl?: string;
  /** Token source for tests; 32 random bytes when omitted. */
  randomToken?: () => string;
}

interface Scope {
  tx: Transaction;
  actor: Actor;
  settings: PolicySettings;
  now: Date;
}

export function generateStatusLinkToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashStatusLinkToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
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

/** The flag gate, then the member's role (advocate or above), all before any link row is touched. */
async function inScope<T>(
  deps: StatusLinkDeps,
  actor: StatusLinkActor,
  fn: (scope: Scope) => Promise<T>,
): Promise<T> {
  const flag =
    deps.flagEnabled ??
    ((workspaceId) => isEnabled(STATUS_LINKS_FLAG, { workspaceId }, { db: deps.db as Database }));
  if (!(await flag(actor.workspaceId))) throw new FeatureDisabledError();
  if (!isUuid(actor.workspaceId) || !isUuid(actor.userId)) throw notFound('Link not found');
  return withWorkspace(deps.db, actor, async (tx) => {
    const role = await memberRole(tx, actor.userId, actor.workspaceId);
    if (role === null || !isRole(role)) throw notFound('Link not found');
    if (!atLeast(role, 'advocate')) throw forbidden('Only an advocate or an owner can use status links');
    const settings =
      deps.settings ?? toPolicySettings(await getRoleSettings(tx, actor.workspaceId));
    return fn({ tx, actor: { ...actor, role }, settings, now: deps.now?.() ?? new Date() });
  });
}

/** The matter if the actor can read it (restricted matters are NOT_FOUND to others). */
async function requireMatter(scope: Scope, matterId: string): Promise<void> {
  const { tx, actor, settings } = scope;
  const [row] = await tx
    .select({ ownerUserId: member.userId, allowUserIds: matterRestriction.allowedUserIds })
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
    .where(and(eq(matter.workspaceId, actor.workspaceId), eq(matter.id, matterId)))
    .limit(1);
  if (row === undefined) throw notFound('Matter not found');
  const resource: Resource = {
    kind: 'matter',
    workspaceId: actor.workspaceId,
    matterId,
    ...(row.allowUserIds === null ? {} : { restricted: { allowUserIds: row.allowUserIds } }),
    ...(row.ownerUserId === null ? {} : { ownerUserId: row.ownerUserId }),
  };
  if (!can(actor, 'matter.read', resource, settings).allow) throw notFound('Matter not found');
}

async function audit(
  scope: Scope,
  action: 'status_link.created' | 'status_link.revoked' | 'status_link.extended',
  linkId: string,
  metadata: Record<string, string | number | boolean | null> = {},
): Promise<void> {
  await record(
    {
      db: scope.tx,
      workspaceId: scope.actor.workspaceId,
      actor: { userId: scope.actor.userId, kind: 'user' },
    },
    { action, target: { kind: 'status_link', id: linkId }, metadata },
  );
}

export interface CreatedStatusLink {
  id: string;
  /** The only copy of the link; the advocate shares it themselves. */
  url: string;
  expiresAt: Date;
}

/**
 * Create a link for an existing client contact from a note the advocate wrote (or edited from an
 * update draft). Nothing is created unless the advocate calls this; nothing is sent.
 */
export async function createStatusLink(
  deps: StatusLinkDeps,
  actor: StatusLinkActor,
  input: unknown,
): Promise<CreatedStatusLink> {
  return inScope(deps, actor, async (scope) => {
    const { tx, now } = scope;
    const parsed = parse(StatusLinkInput, input);
    await requireMatter(scope, parsed.matterId);
    const [contact] = await tx
      .select({ id: clientContact.id })
      .from(clientContact)
      .where(
        and(
          eq(clientContact.workspaceId, actor.workspaceId),
          eq(clientContact.id, parsed.clientContactId),
          isNull(clientContact.archivedAt),
        ),
      )
      .limit(1);
    if (contact === undefined) throw notFound('Client contact not found');
    const token = (deps.randomToken ?? generateStatusLinkToken)();
    const expiresAt = new Date(now.getTime() + parsed.expiryDays * DAY_MS);
    const [row] = await tx
      .insert(statusLink)
      .values({
        workspaceId: actor.workspaceId,
        matterId: parsed.matterId,
        clientContactId: parsed.clientContactId,
        tokenHash: hashStatusLinkToken(token),
        payload: {
          headline: parsed.headline,
          note: parsed.note,
          nextDate: parsed.nextDate ?? null,
        },
        language: parsed.language,
        expiresAt,
        createdBy: actor.userId,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: statusLink.id });
    if (row === undefined) throw new Error('createStatusLink: insert returned no row');
    await audit(scope, 'status_link.created', row.id, {
      language: parsed.language,
      expiryDays: parsed.expiryDays,
    });
    const base = (deps.baseUrl ?? '').replace(/\/+$/, '');
    return { id: row.id, url: `${base}/s/${token}`, expiresAt };
  });
}

/** Revoke a link now: it stops resolving at once. Audited. */
export async function revokeStatusLink(
  deps: StatusLinkDeps,
  actor: StatusLinkActor,
  linkId: string,
): Promise<void> {
  await inScope(deps, actor, async (scope) => {
    const { tx, now } = scope;
    if (!isUuid(linkId)) throw notFound('Link not found');
    const [row] = await tx
      .select({ revokedAt: statusLink.revokedAt })
      .from(statusLink)
      .where(and(eq(statusLink.workspaceId, actor.workspaceId), eq(statusLink.id, linkId)))
      .limit(1);
    if (row === undefined) throw notFound('Link not found');
    if (row.revokedAt !== null) throw conflict('Link already revoked');
    await tx
      .update(statusLink)
      .set({ revokedAt: now, updatedAt: now })
      .where(
        and(
          eq(statusLink.workspaceId, actor.workspaceId),
          eq(statusLink.id, linkId),
          isNull(statusLink.revokedAt),
        ),
      );
    await audit(scope, 'status_link.revoked', linkId);
  });
}

/** Move a live link's expiry to `expiryDays` after its creation (never beyond 30). Audited. */
export async function extendStatusLink(
  deps: StatusLinkDeps,
  actor: StatusLinkActor,
  input: unknown,
): Promise<{ expiresAt: Date }> {
  return inScope(deps, actor, async (scope) => {
    const { tx, now } = scope;
    const parsed = parse(StatusLinkExtend, input);
    const [row] = await tx
      .select({
        createdAt: statusLink.createdAt,
        expiresAt: statusLink.expiresAt,
        revokedAt: statusLink.revokedAt,
        purgedAt: statusLink.purgedAt,
      })
      .from(statusLink)
      .where(and(eq(statusLink.workspaceId, actor.workspaceId), eq(statusLink.id, parsed.linkId)))
      .limit(1);
    if (row === undefined) throw notFound('Link not found');
    if (row.revokedAt !== null || row.purgedAt !== null || row.expiresAt <= now) {
      throw conflict('Only a live link can be extended');
    }
    const expiresAt = new Date(row.createdAt.getTime() + parsed.expiryDays * DAY_MS);
    if (expiresAt.getTime() > row.createdAt.getTime() + STATUS_LINK_MAX_EXPIRY_DAYS * DAY_MS) {
      throw invalid('A link can last at most 30 days');
    }
    if (expiresAt <= row.expiresAt) throw invalid('The new expiry must be later than the current one');
    await tx
      .update(statusLink)
      .set({ expiresAt, updatedAt: now })
      .where(and(eq(statusLink.workspaceId, actor.workspaceId), eq(statusLink.id, parsed.linkId)));
    await audit(scope, 'status_link.extended', parsed.linkId, { expiryDays: parsed.expiryDays });
    return { expiresAt };
  });
}

/** A link as its advocate sees it: never the token or the hash. */
export interface StatusLinkRow {
  id: string;
  clientContactId: string;
  headline: string;
  language: StatusLinkLanguage;
  createdAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  state: 'active' | 'expired' | 'revoked';
  /** Times the public page was opened ("Viewed 3 times"). */
  views: number;
}

/** The matter's links, newest first, each with its view count. */
export async function listStatusLinks(
  deps: StatusLinkDeps,
  actor: StatusLinkActor,
  matterId: string,
): Promise<StatusLinkRow[]> {
  return inScope(deps, actor, async (scope) => {
    const { tx, now } = scope;
    if (!isUuid(matterId)) throw notFound('Matter not found');
    await requireMatter(scope, matterId);
    const rows = await tx
      .select({
        id: statusLink.id,
        clientContactId: statusLink.clientContactId,
        payload: statusLink.payload,
        language: statusLink.language,
        createdAt: statusLink.createdAt,
        expiresAt: statusLink.expiresAt,
        revokedAt: statusLink.revokedAt,
      })
      .from(statusLink)
      .where(and(eq(statusLink.workspaceId, actor.workspaceId), eq(statusLink.matterId, matterId)))
      .orderBy(desc(statusLink.createdAt))
      .limit(MAX_LISTED);
    const views = new Map<string, number>();
    if (rows.length > 0) {
      const counts = await tx
        .select({ linkId: statusLinkAccess.linkId, n: count() })
        .from(statusLinkAccess)
        .where(
          and(
            eq(statusLinkAccess.workspaceId, actor.workspaceId),
            inArray(
              statusLinkAccess.linkId,
              rows.map((r) => r.id),
            ),
          ),
        )
        .groupBy(statusLinkAccess.linkId);
      for (const c of counts) views.set(c.linkId, c.n);
    }
    return rows.map((r) => ({
      id: r.id,
      clientContactId: r.clientContactId,
      headline: r.payload.headline ?? '',
      language: r.language,
      createdAt: r.createdAt,
      expiresAt: r.expiresAt,
      revokedAt: r.revokedAt,
      state: r.revokedAt !== null ? 'revoked' : r.expiresAt <= now ? 'expired' : 'active',
      views: views.get(r.id) ?? 0,
    }));
  });
}

/**
 * Pre-fill the authoring form from an outward update draft (#69): the draft's latest text, to be
 * edited by the advocate. Reads only; nothing is created and the draft is untouched.
 */
export async function prefillFromDraft(
  deps: StatusLinkDeps & Pick<OutwardDeps, 'gateway' | 'memory'>,
  actor: StatusLinkActor,
  draftId: string,
): Promise<{ matterId: string; note: string; language: StatusLinkLanguage }> {
  return inScope(deps, actor, async () => {
    const draft = await getDraft(deps, actor, draftId);
    return { matterId: draft.matterId, note: draft.body, language: draft.language };
  });
}
