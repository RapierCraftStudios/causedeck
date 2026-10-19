'use server';
// Activity page server actions (#232, #26 part 6). Both go through `workspaceAction` (zod input,
// session, membership); the `audit.read` gate (owners; advocates unless the workspace turned it
// off) is checked again by core: `queryAuditFeed` authorizes itself and `verifyAuditRange` calls
// `authorizeAuditRead` first. A denial comes back as `FORBIDDEN`.
import { z } from 'zod';

import type { Result } from '../../../../../lib/safe-action.ts';
import { WorkspaceScoped, workspaceAction } from '../../../../../lib/workspace-action.ts';

import type { AuditFeedPage } from './audit-feed.tsx';

const runtime = () => import('@causedeck/core/runtime');

const LoadMore = WorkspaceScoped.extend({
  cursor: z.string().min(1).max(512),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  actorUserId: z.uuid().optional(),
  actionGroup: z
    .string()
    .regex(/^[a-z][a-z0-9_.]{0,99}$/)
    .optional(),
});

const VerifyEvent = WorkspaceScoped.extend({
  eventId: z.uuid(),
  /** The event's `createdAt` (ISO 8601 UTC with microseconds, as the feed has it). */
  createdAt: z.iso.datetime({ precision: 6 }),
});

export type ChainStatus = 'verified' | 'unverified';

const loadMore = workspaceAction(LoadMore, async (input, ctx) => {
  const { queryAuditFeed } = await runtime();
  const page = await queryAuditFeed(
    { workspaceId: ctx.workspaceId, userId: ctx.userId },
    {
      cursor: input.cursor,
      ...(input.from === undefined ? {} : { from: new Date(input.from) }),
      ...(input.to === undefined ? {} : { to: new Date(input.to) }),
      ...(input.actorUserId === undefined ? {} : { actorUserId: input.actorUserId }),
      ...(input.actionGroup === undefined ? {} : { actionGroup: input.actionGroup }),
    },
  );
  return page satisfies AuditFeedPage;
});

/**
 * Re-check one event's hash against its fields. The window is the event's own millisecond, so the
 * check covers this row (and any other written in the same millisecond), not the whole chain; the
 * nightly `audit.verify` job walks the full chain.
 */
const verifyEvent = workspaceAction(VerifyEvent, async (input, ctx) => {
  const { verifyAuditRange } = await runtime();
  const from = new Date(input.createdAt);
  const to = new Date(from.getTime() + 1);
  const result = await verifyAuditRange(
    { workspaceId: ctx.workspaceId, userId: ctx.userId },
    from,
    to,
  );
  return (result.ok && result.checked > 0 ? 'verified' : 'unverified') satisfies ChainStatus;
});

export async function loadMoreAuditAction(raw: unknown): Promise<Result<AuditFeedPage>> {
  return loadMore(raw);
}

export async function verifyAuditEventAction(raw: unknown): Promise<Result<ChainStatus>> {
  return verifyEvent(raw);
}
