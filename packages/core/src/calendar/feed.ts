// The private ICS feed's lifecycle (#53; PRD CA-5; docs/product/09 §3, §8). One active feed per
// (workspace, user). The token is 32 random bytes (base64url); only its sha256 hex is stored and the
// plaintext exists once, in the result of `createFeed` / `rotateFeed`. Rotating replaces the hash and
// revoking sets `revoked_at`, both effective at once. Creating a feed needs the member to have seen
// the "outside India" note (`disclosureVersion`). The `mine` scope is for any member who may read
// matters; the `workspace` scope is for owners only. Audited fail-closed in the caller's
// transaction as `workspace.integration_token_rotated` (kind `ics_feed`); the token is never logged.
// Nothing here sends a message: the feed is read-only (see capture/ics/serialize.ts).
import { can, isRole } from '@causedeck/auth/policy';
import { schema, type Database, type Transaction } from '@causedeck/db';
import { and, eq, isNull } from 'drizzle-orm';

import { record } from '../audit/index.ts';
import { conflict, forbidden, invalid, notFound } from '../shared/errors.ts';
import {
  generateIntegrationToken,
  hashIntegrationToken,
  memberRole,
  requireCan,
} from '../workspaces/index.ts';

type Queryable = Database | Transaction;
type FeedScope = (typeof schema.icsFeed.$inferSelect)['scope'];

const { icsFeed } = schema;

/** The version of the note "Your calendar app may fetch this feed from servers outside India." */
export const CALENDAR_DISCLOSURE_VERSION = '2026-10-v1';

export interface FeedStatus {
  id: string;
  scope: FeedScope;
  includeParties: boolean;
  createdAt: Date;
  rotatedAt: Date | null;
  lastFetchedAt: Date | null;
  disclosureVersion: string;
}

export interface FeedRequestBase {
  workspaceId: string;
  actorUserId: string;
  requestId?: string;
  userAgent?: string;
  ip?: string;
}

export interface CreateFeedRequest extends FeedRequestBase {
  scope?: FeedScope;
  includeParties?: boolean;
  /** The version of the disclosure the member acknowledged. */
  disclosureVersion: string;
}

export interface FeedWithToken extends FeedStatus {
  /** The feed URL's token. Shown once: it is not stored anywhere. */
  token: string;
}

const COLUMNS = {
  id: icsFeed.id,
  scope: icsFeed.scope,
  includeParties: icsFeed.includeParties,
  createdAt: icsFeed.createdAt,
  rotatedAt: icsFeed.rotatedAt,
  lastFetchedAt: icsFeed.lastFetchedAt,
  disclosureVersion: icsFeed.disclosureVersion,
} as const;

const activeFor = (workspaceId: string, userId: string) =>
  and(eq(icsFeed.workspaceId, workspaceId), eq(icsFeed.userId, userId), isNull(icsFeed.revokedAt));

/** The member's active feed, never its token or hash; null when there is none. */
export async function getFeedStatus(
  db: Queryable,
  scope: { workspaceId: string; userId: string },
): Promise<FeedStatus | null> {
  const [row] = await db
    .select(COLUMNS)
    .from(icsFeed)
    .where(activeFor(scope.workspaceId, scope.userId));
  return row ?? null;
}

async function checkScope(tx: Queryable, request: FeedRequestBase, scope: FeedScope) {
  await requireCan(tx, request.workspaceId, request.actorUserId, 'matter.read');
  const role = await memberRole(tx, request.actorUserId, request.workspaceId);
  if (role === null || !isRole(role)) throw forbidden();
  const actor = { userId: request.actorUserId, workspaceId: request.workspaceId, role };
  if (!can(actor, 'matter.read').allow) throw forbidden();
  if (scope === 'workspace' && role !== 'owner') {
    throw forbidden('Only an owner can share the whole workspace');
  }
}

function auditFeed(tx: Queryable, request: FeedRequestBase) {
  return record(
    {
      db: tx,
      workspaceId: request.workspaceId,
      actor: { userId: request.actorUserId, kind: 'user' as const },
      ...(request.requestId === undefined ? {} : { requestId: request.requestId }),
      ...(request.userAgent === undefined ? {} : { userAgent: request.userAgent }),
      ...(request.ip === undefined ? {} : { ip: request.ip }),
    },
    {
      action: 'workspace.integration_token_rotated',
      target: { kind: 'workspace', id: request.workspaceId },
      metadata: { kind: 'ics_feed' },
    },
  );
}

function checkDisclosure(version: string): void {
  if (version !== CALENDAR_DISCLOSURE_VERSION) {
    throw invalid('Acknowledge the current calendar feed note first');
  }
}

/** Create the member's feed. CONFLICT when one is already active (rotate or revoke it instead). */
export async function createFeed(
  db: Queryable,
  request: CreateFeedRequest,
): Promise<FeedWithToken> {
  checkDisclosure(request.disclosureVersion);
  const scope = request.scope ?? 'mine';
  return db.transaction(async (tx) => {
    await checkScope(tx, request, scope);
    if (
      (await getFeedStatus(tx, {
        workspaceId: request.workspaceId,
        userId: request.actorUserId,
      })) !== null
    ) {
      throw conflict('You already have a calendar feed');
    }
    const token = generateIntegrationToken();
    const [row] = await tx
      .insert(icsFeed)
      .values({
        workspaceId: request.workspaceId,
        userId: request.actorUserId,
        tokenHash: hashIntegrationToken(token),
        scope,
        includeParties: request.includeParties ?? false,
        disclosureVersion: request.disclosureVersion,
      })
      .returning(COLUMNS);
    if (!row) throw new Error('ics_feed insert returned no row');
    await auditFeed(tx, request);
    return { ...row, token };
  });
}

/** Replace the active feed's token; the old URL stops working at once. */
export async function rotateFeed(db: Queryable, request: FeedRequestBase): Promise<FeedWithToken> {
  return db.transaction(async (tx) => {
    const current = await getFeedStatus(tx, {
      workspaceId: request.workspaceId,
      userId: request.actorUserId,
    });
    if (current === null) throw notFound('No calendar feed to rotate');
    await checkScope(tx, request, current.scope);
    const token = generateIntegrationToken();
    const [row] = await tx
      .update(icsFeed)
      .set({ tokenHash: hashIntegrationToken(token), rotatedAt: new Date() })
      .where(and(activeFor(request.workspaceId, request.actorUserId), eq(icsFeed.id, current.id)))
      .returning(COLUMNS);
    if (!row) throw notFound('No calendar feed to rotate');
    await auditFeed(tx, request);
    return { ...row, token };
  });
}

/** Revoke the active feed: its URL returns 404 from now on. */
export async function revokeFeed(db: Queryable, request: FeedRequestBase): Promise<void> {
  await db.transaction(async (tx) => {
    await requireCan(tx, request.workspaceId, request.actorUserId, 'matter.read');
    const rows = await tx
      .update(icsFeed)
      .set({ revokedAt: new Date() })
      .where(activeFor(request.workspaceId, request.actorUserId))
      .returning({ id: icsFeed.id });
    if (rows.length === 0) throw notFound('No calendar feed to revoke');
    await auditFeed(tx, request);
  });
}

/** Turn party names in the feed on or off. */
export async function setFeedIncludeParties(
  db: Queryable,
  request: FeedRequestBase & { includeParties: boolean },
): Promise<FeedStatus> {
  return db.transaction(async (tx) => {
    await requireCan(tx, request.workspaceId, request.actorUserId, 'matter.read');
    const [row] = await tx
      .update(icsFeed)
      .set({ includeParties: request.includeParties })
      .where(activeFor(request.workspaceId, request.actorUserId))
      .returning(COLUMNS);
    if (!row) throw notFound('No calendar feed');
    return row;
  });
}
