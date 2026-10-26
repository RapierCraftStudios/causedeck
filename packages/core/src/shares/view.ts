// The recipient side of a brief share (#507): view by token (no account needed), claim after
// sign-in (the referral), import the matter into the recipient's workspace (activation, which earns
// the credit). The one cross-workspace read is `app_brief_share_view`, by token hash only.
import { schema, type Queryable, withWorkspace } from '@causedeck/db';
import { TERMINAL_SUBSCRIPTION_STATUSES } from '@causedeck/validators/plans';
import { fromSubscriptionRow } from '@causedeck/billing';
import { SUBSCRIPTION_STATUSES, type SubscriptionStatus } from '@causedeck/billing/plans';
import {
  addFreeMonths,
  grantReferralCredit,
  type ReferralDenial,
} from '@causedeck/billing/referral';
import { and, count, eq, gt, isNull, notInArray, sql } from 'drizzle-orm';

import { recordActivation } from '../activation/index.ts';
import { createMatter, type GraphActor, type MatterGraphDeps } from '../matter-graph/index.ts';
import { notFound } from '../shared/errors.ts';

import { hashShareToken, type SharedBriefSnapshot } from './share.ts';

export type ShareView =
  | { state: 'INVALID' | 'EXPIRED' | 'REVOKED' }
  | { state: 'VALID'; snapshot: SharedBriefSnapshot; expiresAt: Date };

type ShareRow = {
  id: string;
  workspace_id: string;
  created_by: string | null;
  snapshot: SharedBriefSnapshot;
  created_at: Date | string;
  expires_at: Date | string;
  revoked_at: Date | string | null;
};

async function lookup(db: Queryable, token: string): Promise<ShareRow | null> {
  if (token.length < 16 || token.length > 128) return null;
  const rows = await db.execute<ShareRow>(
    sql`select * from app_brief_share_view(${hashShareToken(token)})`,
  );
  return rows[0] ?? null;
}

function state(row: ShareRow | null, now: Date): ShareView['state'] {
  if (row === null) return 'INVALID';
  if (row.revoked_at !== null) return 'REVOKED';
  return new Date(row.expires_at).getTime() <= now.getTime() ? 'EXPIRED' : 'VALID';
}

/** What a signed-out recipient sees: the snapshot only, or why the link is dead. */
export async function viewBriefShare(
  db: Queryable,
  token: string,
  now: Date = new Date(),
): Promise<ShareView> {
  const row = await lookup(db, token);
  const s = state(row, now);
  if (s !== 'VALID' || row === null) return { state: s } as ShareView;
  return { state: 'VALID', snapshot: row.snapshot, expiresAt: new Date(row.expires_at) };
}

export interface ClaimedShare {
  referralId: string | null;
  /** True when the claim started a referral (not the sharer, not already referred). */
  referred: boolean;
}

/**
 * The signed-in recipient claims a valid link: records the referral (one per invitee, never the
 * sharer) and the invitee's `referral` channel. A dead link is `notFound`.
 */
export async function claimBriefShare(
  db: Queryable,
  input: { userId: string; token: string; now?: Date },
): Promise<ClaimedShare> {
  const now = input.now ?? new Date();
  const row = await lookup(db, input.token);
  if (state(row, now) !== 'VALID' || row === null) throw notFound('Share not found');
  if (row.created_by === null || row.created_by === input.userId) {
    return { referralId: null, referred: false };
  }
  const [created] = await db
    .insert(schema.referral)
    .values({ shareId: row.id, referrerUserId: row.created_by, inviteeUserId: input.userId })
    .onConflictDoNothing({ target: schema.referral.inviteeUserId })
    .returning({ id: schema.referral.id });
  if (created !== undefined) {
    await recordActivation(db, { userId: input.userId, step: 'signed_up', channel: 'referral' });
  }
  return { referralId: created?.id ?? null, referred: created !== undefined };
}

export interface ImportedShare {
  matterId: string;
  /** Set when the import activated a referral: whether it earned the credit, or why not. */
  credit: { granted: true; months: number } | { granted: false; reason: ReferralDenial } | null;
}

/** Offer-and-import: the shared matter becomes a matter of the recipient's own workspace. */
export async function importSharedMatter(
  deps: MatterGraphDeps,
  actor: GraphActor,
  token: string,
): Promise<ImportedShare> {
  const now = (deps.now ?? (() => new Date()))();
  const row = await lookup(deps.db, token);
  if (state(row, now) !== 'VALID' || row === null) throw notFound('Share not found');
  const matter = await createMatter(deps, actor, {
    title: row.snapshot.matterTitle,
    synopsis: row.snapshot.synopsis,
  });
  const credit = await activateReferral(deps.db, actor.userId, actor.workspaceId, row, now);
  return { matterId: matter.id, credit };
}

async function activateReferral(
  db: Queryable,
  inviteeUserId: string,
  inviteeWorkspaceId: string,
  share: ShareRow,
  now: Date,
): Promise<ImportedShare['credit']> {
  const result = await db.transaction(async (tx) => {
    const [ref] = await tx
      .update(schema.referral)
      .set({ activatedAt: now })
      .where(
        and(
          eq(schema.referral.inviteeUserId, inviteeUserId),
          eq(schema.referral.shareId, share.id),
          isNull(schema.referral.activatedAt),
        ),
      )
      .returning();
    if (ref === undefined) return null;
    const [invitee] = await tx
      .select({ createdAt: schema.user.createdAt })
      .from(schema.user)
      .where(eq(schema.user.id, inviteeUserId));
    const yearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
    const [credited] = await tx
      .select({ n: count() })
      .from(schema.referralCredit)
      .where(
        and(
          eq(schema.referralCredit.userId, ref.referrerUserId),
          eq(schema.referralCredit.side, 'referrer'),
          gt(schema.referralCredit.createdAt, yearAgo),
        ),
      );
    const grant = grantReferralCredit(
      {
        referrerUserId: ref.referrerUserId,
        inviteeUserId,
        inviteeCreatedAt: invitee?.createdAt ?? new Date(0),
        shareCreatedAt: new Date(share.created_at),
        alreadyCredited: false,
        referrerCreditedLastYear: credited?.n ?? 0,
      },
      { referrer: null, invitee: null },
    );
    if (!grant.grant) return { granted: false, reason: grant.reason } as const;
    await tx
      .insert(schema.referralCredit)
      .values(
        grant.applications.map(({ side, userId, months }) => ({
          referralId: ref.id,
          side,
          userId,
          months,
        })),
      )
      .onConflictDoNothing();
    return { granted: true, months: grant.applications[0].months, referralId: ref.id } as const;
  });
  if (result?.granted !== true) return result;
  // Apply each side's free month in that side's own workspace scope (subscription is RLS-isolated).
  // A side with no live subscription keeps its credit pending (`applied_at` null).
  const sides = [
    { side: 'referrer', workspaceId: share.workspace_id },
    { side: 'invitee', workspaceId: inviteeWorkspaceId },
  ] as const;
  for (const target of sides) {
    await withWorkspace(db, { workspaceId: target.workspaceId }, async (tx) => {
      const [row] = await tx
        .select()
        .from(schema.subscription)
        .where(notInArray(schema.subscription.status, [...TERMINAL_SUBSCRIPTION_STATUSES]));
      if (row === undefined || !(SUBSCRIPTION_STATUSES as readonly string[]).includes(row.status)) {
        return;
      }
      const next = addFreeMonths(
        fromSubscriptionRow({ ...row, status: row.status as SubscriptionStatus }),
        result.months,
      );
      if (next === null) return;
      await tx
        .update(schema.subscription)
        .set({ currentPeriodEnd: next.currentPeriodEnd })
        .where(eq(schema.subscription.id, row.id));
      await tx
        .update(schema.referralCredit)
        .set({ appliedAt: now })
        .where(
          and(
            eq(schema.referralCredit.referralId, result.referralId),
            eq(schema.referralCredit.side, target.side),
          ),
        );
    });
  }
  return { granted: true, months: result.months };
}
