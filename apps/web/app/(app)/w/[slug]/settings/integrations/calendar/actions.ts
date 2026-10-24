'use server';
// Calendar server actions (#53; PRD CA-5). Each goes through `workspaceAction`
// (lib/workspace-action.ts): strict zod input, `requireSession`, membership and the policy action
// (`matter.read` for the feed, `matter.write` for the import review, which the engine and the
// domain check again). A dark flag (`capture.ics-feed`) is NOT_FOUND, like a missing route. The
// domain services (`@causedeck/core/calendar`) run on the workspace-scoped transaction `ctx.tx` and
// audit in it. The full feed URL is returned once, by create and rotate, and is never stored or
// logged. Nothing here sends a message: the feed is read-only.
import { assertCan } from '@causedeck/auth/policy';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { objectStore } from '../../../../../../../lib/storage.ts';
import { ActionError, type Result } from '../../../../../../../lib/safe-action.ts';
import {
  WorkspaceScoped,
  workspaceAction,
  type WorkspaceActionCtx,
} from '../../../../../../../lib/workspace-action.ts';

const FeedScope = z.enum(['mine', 'workspace']);

const Create = WorkspaceScoped.extend({
  scope: FeedScope.default('mine'),
  includeParties: z.boolean().default(false),
  disclosureVersion: z.string().min(1).max(64),
}).strict();
const Rotate = WorkspaceScoped.strict();
const Parties = WorkspaceScoped.extend({ includeParties: z.boolean() }).strict();
const Event = WorkspaceScoped.extend({
  captureId: z.uuid(),
  uid: z.string().min(1).max(600),
}).strict();
const Note = Event.extend({ matterId: z.uuid() }).strict();

export interface CalendarFeedView {
  id: string;
  scope: 'mine' | 'workspace';
  includeParties: boolean;
  createdAt: Date;
  rotatedAt: Date | null;
  lastFetchedAt: Date | null;
}

export interface IssuedFeed extends CalendarFeedView {
  /** The full feed URL. Shown once: it is not stored anywhere. */
  url: string;
}

async function requireOn(ctx: WorkspaceActionCtx): Promise<void> {
  const { isEnabled } = await import('@causedeck/flags/server');
  const on = await isEnabled('capture.ics-feed', {
    workspaceId: ctx.workspaceId,
    userId: ctx.userId,
  });
  if (!on) throw new ActionError('NOT_FOUND', '');
}

async function feedUrl(token: string): Promise<string> {
  const { serverEnv } = await import('../../../../../../../lib/env.ts');
  return `${serverEnv().APP_URL.replace(/\/$/, '')}/api/ics/${token}`;
}

const view = (feed: CalendarFeedView): CalendarFeedView => ({
  id: feed.id,
  scope: feed.scope,
  includeParties: feed.includeParties,
  createdAt: feed.createdAt,
  rotatedAt: feed.rotatedAt,
  lastFetchedAt: feed.lastFetchedAt,
});

function refresh(): void {
  revalidatePath('/w/[slug]/settings/integrations/calendar', 'page');
}

const create = workspaceAction(
  Create,
  async (input, ctx): Promise<IssuedFeed> => {
    assertCan(ctx.actor, 'matter.read');
    await requireOn(ctx);
    const { createFeed } = await import('@causedeck/core/calendar');
    const { token, ...feed } = await createFeed(ctx.tx, {
      workspaceId: ctx.workspaceId,
      actorUserId: ctx.userId,
      scope: input.scope,
      includeParties: input.includeParties,
      disclosureVersion: input.disclosureVersion,
      requestId: ctx.requestId,
    });
    refresh();
    return { ...view(feed), url: await feedUrl(token) };
  },
  { action: 'matter.read' },
);

const rotate = workspaceAction(
  Rotate,
  async (_input, ctx): Promise<IssuedFeed> => {
    assertCan(ctx.actor, 'matter.read');
    await requireOn(ctx);
    const { rotateFeed } = await import('@causedeck/core/calendar');
    const { token, ...feed } = await rotateFeed(ctx.tx, {
      workspaceId: ctx.workspaceId,
      actorUserId: ctx.userId,
      requestId: ctx.requestId,
    });
    refresh();
    return { ...view(feed), url: await feedUrl(token) };
  },
  { action: 'matter.read' },
);

const revoke = workspaceAction(
  Rotate,
  async (_input, ctx): Promise<{ revoked: true }> => {
    assertCan(ctx.actor, 'matter.read');
    await requireOn(ctx);
    const { revokeFeed } = await import('@causedeck/core/calendar');
    await revokeFeed(ctx.tx, {
      workspaceId: ctx.workspaceId,
      actorUserId: ctx.userId,
      requestId: ctx.requestId,
    });
    refresh();
    return { revoked: true };
  },
  { action: 'matter.read' },
);

const parties = workspaceAction(
  Parties,
  async ({ includeParties }, ctx): Promise<CalendarFeedView> => {
    assertCan(ctx.actor, 'matter.read');
    await requireOn(ctx);
    const { setFeedIncludeParties } = await import('@causedeck/core/calendar');
    const feed = await setFeedIncludeParties(ctx.tx, {
      workspaceId: ctx.workspaceId,
      actorUserId: ctx.userId,
      includeParties,
    });
    refresh();
    return view(feed);
  },
  { action: 'matter.read' },
);

function reviewScope(ctx: WorkspaceActionCtx) {
  return { db: ctx.tx, workspaceId: ctx.workspaceId, userId: ctx.userId };
}

const confirmEvent = workspaceAction(
  Event,
  async ({ captureId, uid }, ctx) => {
    assertCan(ctx.actor, 'matter.write');
    await requireOn(ctx);
    const { confirmImportEvent } = await import('@causedeck/core/calendar');
    await confirmImportEvent(reviewScope(ctx), { captureId, uid });
    refresh();
    return { uid, status: 'applied' as const };
  },
  { action: 'matter.write' },
);

const skipEvent = workspaceAction(
  Event,
  async ({ captureId, uid }, ctx) => {
    assertCan(ctx.actor, 'matter.write');
    await requireOn(ctx);
    const { skipImportEvent } = await import('@causedeck/core/calendar');
    await skipImportEvent(reviewScope(ctx), { captureId, uid });
    refresh();
    return { uid, status: 'skipped' as const };
  },
  { action: 'matter.write' },
);

const noteEvent = workspaceAction(
  Note,
  async ({ captureId, uid, matterId }, ctx) => {
    assertCan(ctx.actor, 'document.write');
    await requireOn(ctx);
    const { attachImportEventAsNote } = await import('@causedeck/core/calendar');
    const { captureContext } = await import('@causedeck/core/runtime');
    const captureCtx = await captureContext({
      db: ctx.tx,
      store: objectStore(),
      workspaceId: ctx.workspaceId,
      userId: ctx.userId,
      authorize: (action) => {
        assertCan(ctx.actor, action);
      },
      requestId: ctx.requestId,
    });
    await attachImportEventAsNote(reviewScope(ctx), captureCtx, { captureId, uid, matterId });
    refresh();
    return { uid, status: 'noted' as const };
  },
  { action: 'document.write' },
);

export async function createCalendarFeedAction(raw: unknown): Promise<Result<IssuedFeed>> {
  return create(raw);
}

export async function rotateCalendarFeedAction(raw: unknown): Promise<Result<IssuedFeed>> {
  return rotate(raw);
}

export async function revokeCalendarFeedAction(raw: unknown): Promise<Result<{ revoked: true }>> {
  return revoke(raw);
}

export async function setCalendarFeedPartiesAction(
  raw: unknown,
): Promise<Result<CalendarFeedView>> {
  return parties(raw);
}

export async function confirmCalendarEventAction(
  raw: unknown,
): Promise<Result<{ uid: string; status: 'applied' }>> {
  return confirmEvent(raw);
}

export async function skipCalendarEventAction(
  raw: unknown,
): Promise<Result<{ uid: string; status: 'skipped' }>> {
  return skipEvent(raw);
}

export async function noteCalendarEventAction(
  raw: unknown,
): Promise<Result<{ uid: string; status: 'noted' }>> {
  return noteEvent(raw);
}
