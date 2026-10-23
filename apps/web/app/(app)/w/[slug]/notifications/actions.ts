'use server';
// Notification bell and panel server actions (#198). Each one goes through `workspaceAction`
// (lib/workspace-action.ts): zod input, `requireSession`, then the caller's membership, with
// non-members rejected as FORBIDDEN before the handler runs. The handlers call the notifications
// service (`@causedeck/notifications`, #194) on the workspace-scoped transaction `ctx.tx`, always
// for the signed-in user: the input never names a user, so a member only sees and marks their own.
import { z } from 'zod';

import { ActionError, type Result } from '../../../../../lib/safe-action.ts';
import {
  WorkspaceScoped,
  workspaceAction,
  type WorkspaceActionCtx,
} from '../../../../../lib/workspace-action.ts';

/** One notification as the client sees it: dates as ISO strings, no `data` payload. */
export interface NotificationView {
  id: string;
  category: string;
  title: string;
  body: string | null;
  href: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationList {
  /** Newest first. */
  items: NotificationView[];
  unread: number;
}

/** The panel shows at most this many; older ones wait for the full notifications page. */
const PANEL_LIMIT = 50;

const ListInput = WorkspaceScoped.extend({
  limit: z.number().int().min(1).max(PANEL_LIMIT).optional(),
});
const NotificationTarget = WorkspaceScoped.extend({ notificationId: z.string().min(1).max(64) });

const service = () => import('@causedeck/notifications');

/** `NotificationError` from the service as the matching `ActionError` (codes map 1:1). */
async function run<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    const { NotificationError } = await service();
    if (error instanceof NotificationError) throw new ActionError(error.code, error.message);
    throw error;
  }
}

const scope = (ctx: WorkspaceActionCtx) => ({ db: ctx.tx, workspaceId: ctx.workspaceId });

const list = workspaceAction(ListInput, async (input, ctx) => {
  const { listForUser, unreadCount } = await service();
  return run(async () => {
    const rows = await listForUser(scope(ctx), {
      userId: ctx.userId,
      limit: input.limit ?? PANEL_LIMIT,
    });
    const unread = await unreadCount(scope(ctx), { userId: ctx.userId });
    const items = rows.map((row): NotificationView => ({
      id: row.id,
      category: row.category,
      title: row.title,
      body: row.body,
      href: row.href,
      readAt: row.readAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    }));
    return { items, unread } satisfies NotificationList;
  });
});

const markOne = workspaceAction(NotificationTarget, async (input, ctx) => {
  const { markRead } = await service();
  await run(() =>
    markRead(scope(ctx), { userId: ctx.userId, notificationId: input.notificationId }),
  );
  return { notificationId: input.notificationId };
});

const markAll = workspaceAction(WorkspaceScoped, async (_input, ctx) => {
  const { markAllRead } = await service();
  const count = await run(() => markAllRead(scope(ctx), { userId: ctx.userId }));
  return { count };
});

// A `'use server'` module may only export async functions, so each action is wrapped.

export async function listNotificationsAction(raw: unknown): Promise<Result<NotificationList>> {
  return list(raw);
}

export async function markNotificationReadAction(
  raw: unknown,
): Promise<Result<{ notificationId: string }>> {
  return markOne(raw);
}

export async function markAllNotificationsReadAction(
  raw: unknown,
): Promise<Result<{ count: number }>> {
  return markAll(raw);
}
