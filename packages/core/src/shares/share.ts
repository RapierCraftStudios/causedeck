// Brief sharing (#507): a workspace member turns a listing's brief into an expiring, revocable
// link. The link stores a sanitised snapshot of the brief (text only: no ids, no private note, no
// strategy, no court notes, no document passages), never a reference the recipient could follow
// into the workspace. Only the sha-256 of the token is stored.
import { createHash, randomBytes } from 'node:crypto';

import { consumeRateLimit } from '@causedeck/auth/rate-limit';
import { isUuid, schema, withWorkspace, type Database, type Queryable } from '@causedeck/db';
import type { Brief } from '@causedeck/validators';
import { and, asc, desc, eq, gt, isNull } from 'drizzle-orm';

import { recordActivation } from '../activation/index.ts';
import { assembleBrief, type BriefActor, type BriefDeps } from '../briefs/index.ts';
import { conflict, forbidden, notFound, rateLimited } from '../shared/errors.ts';
import { memberRole } from '../workspaces/index.ts';

export const SHARE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const SHARE_RATE_LIMIT = { max: 20, windowSeconds: 60 * 60 } as const;

export type SharedBriefSnapshot = schema.SharedBriefSnapshot;

export function generateShareToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashShareToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** The shareable part of a brief: line texts and dates only. */
export function toSnapshot(brief: Brief, matterTitle: string): SharedBriefSnapshot {
  return {
    matterTitle,
    synopsis: brief.synopsis?.line.text ?? null,
    stage: brief.stage?.text ?? null,
    lastOrder: brief.last_order.map((l) => l.text),
    lastHearing: brief.last_hearing?.text ?? null,
    openObligations: brief.obligations.open.map((o) => ({ text: o.text, dueDate: o.due_date })),
    assembledAt: brief.assembled_at,
  };
}

export interface CreatedShare {
  id: string;
  /** The only copy of the token; share `/share/<token>`. */
  token: string;
  expiresAt: Date;
}

/**
 * Share the brief of a listing (needs `listing.read`). A sensitive (AI-off) matter is not shareable.
 * Rate limited per user. Records the user's `invite_sent` funnel step.
 */
export async function createBriefShare(
  deps: BriefDeps,
  actor: BriefActor,
  listingId: string,
  options: { ttlMs?: number } = {},
): Promise<CreatedShare> {
  const now = (deps.now ?? (() => new Date()))();
  if (!isUuid(actor.userId)) throw notFound('Listing not found');
  if (
    !(await consumeRateLimit(
      deps.db as Database,
      `brief-share:${actor.userId}`,
      SHARE_RATE_LIMIT,
      now.getTime(),
    ))
  ) {
    throw rateLimited();
  }
  const brief = await assembleBrief(deps, actor, listingId, { compress: false });
  if (brief.sensitive) throw forbidden('A sensitive matter cannot be shared');
  const token = generateShareToken();
  const expiresAt = new Date(now.getTime() + (options.ttlMs ?? SHARE_TTL_MS));
  const id = await withWorkspace(deps.db, actor, async (tx) => {
    const [matter] = await tx
      .select({ title: schema.matter.title })
      .from(schema.matter)
      .where(
        and(
          eq(schema.matter.workspaceId, actor.workspaceId),
          eq(schema.matter.id, brief.matter_id),
        ),
      )
      .limit(1);
    if (matter === undefined) throw notFound('Listing not found');
    const [row] = await tx
      .insert(schema.briefShare)
      .values({
        workspaceId: actor.workspaceId,
        tokenHash: hashShareToken(token),
        snapshot: toSnapshot(brief, matter.title),
        createdBy: actor.userId,
        expiresAt,
      })
      .returning({ id: schema.briefShare.id });
    if (row === undefined) throw new Error('createBriefShare: insert returned no row');
    return row.id;
  });
  await recordActivation(deps.db, { userId: actor.userId, step: 'invite_sent' });
  return { id, token, expiresAt };
}

/** Revoke a share of the actor's workspace (its creator or an owner); the link stops working at once. */
export async function revokeBriefShare(
  deps: { db: Queryable; now?: () => Date },
  actor: BriefActor,
  shareId: string,
): Promise<void> {
  if (!isUuid(shareId) || !isUuid(actor.userId)) throw notFound('Share not found');
  const now = (deps.now ?? (() => new Date()))();
  await withWorkspace(deps.db, actor, async (tx) => {
    const [row] = await tx
      .select({ createdBy: schema.briefShare.createdBy, revokedAt: schema.briefShare.revokedAt })
      .from(schema.briefShare)
      .where(
        and(
          eq(schema.briefShare.workspaceId, actor.workspaceId),
          eq(schema.briefShare.id, shareId),
        ),
      )
      .limit(1);
    if (row === undefined) throw notFound('Share not found');
    if (row.revokedAt !== null) throw conflict('Share already revoked');
    const role = await memberRole(tx, actor.userId, actor.workspaceId);
    if (row.createdBy !== actor.userId && role !== 'owner') {
      throw forbidden('Only the creator or an owner can revoke a share');
    }
    await tx
      .update(schema.briefShare)
      .set({ revokedAt: now, updatedAt: now })
      .where(
        and(
          eq(schema.briefShare.workspaceId, actor.workspaceId),
          eq(schema.briefShare.id, shareId),
          isNull(schema.briefShare.revokedAt),
        ),
      );
  });
}

/** An active share as the owner sees it: never the token (only its hash is stored) or the snapshot. */
export interface BriefShareRow {
  id: string;
  matterTitle: string;
  /** The actor created this link (so may revoke it even without being an owner). */
  mine: boolean;
  createdAt: Date;
  expiresAt: Date;
}

/** The workspace's links that are neither revoked nor expired, newest first (members only). */
export async function listBriefShares(
  deps: { db: Queryable; now?: () => Date },
  actor: BriefActor,
): Promise<BriefShareRow[]> {
  if (!isUuid(actor.userId)) throw forbidden('Not a member of this workspace');
  const now = (deps.now ?? (() => new Date()))();
  return withWorkspace(deps.db, actor, async (tx) => {
    if ((await memberRole(tx, actor.userId, actor.workspaceId)) === null) {
      throw forbidden('Not a member of this workspace');
    }
    const rows = await tx
      .select({
        id: schema.briefShare.id,
        snapshot: schema.briefShare.snapshot,
        createdBy: schema.briefShare.createdBy,
        createdAt: schema.briefShare.createdAt,
        expiresAt: schema.briefShare.expiresAt,
      })
      .from(schema.briefShare)
      .where(
        and(
          eq(schema.briefShare.workspaceId, actor.workspaceId),
          isNull(schema.briefShare.revokedAt),
          gt(schema.briefShare.expiresAt, now),
        ),
      )
      .orderBy(desc(schema.briefShare.createdAt))
      .limit(50);
    return rows.map((row) => ({
      id: row.id,
      matterTitle: row.snapshot.matterTitle,
      mine: row.createdBy === actor.userId,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
    }));
  });
}

/** The listing a matter's brief is shared from: its earliest canonical (next-date) listing. */
export async function shareableListingId(
  deps: { db: Queryable },
  actor: BriefActor,
  matterId: string,
): Promise<string | null> {
  if (!isUuid(matterId) || !isUuid(actor.userId)) return null;
  return withWorkspace(deps.db, actor, async (tx) => {
    const [row] = await tx
      .select({ id: schema.listing.id })
      .from(schema.listing)
      .innerJoin(
        schema.proceeding,
        and(
          eq(schema.proceeding.workspaceId, schema.listing.workspaceId),
          eq(schema.proceeding.id, schema.listing.proceedingId),
        ),
      )
      .where(
        and(
          eq(schema.listing.workspaceId, actor.workspaceId),
          eq(schema.proceeding.matterId, matterId),
          eq(schema.listing.canonical, true),
        ),
      )
      .orderBy(asc(schema.listing.listDate))
      .limit(1);
    return row?.id ?? null;
  });
}
