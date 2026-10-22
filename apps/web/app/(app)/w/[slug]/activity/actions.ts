'use server';
// Activity page server actions (#232, #26 part 6). Both go through `workspaceAction` (zod input,
// session, membership); the `audit.read` gate (owners; advocates unless the workspace turned it
// off) is checked again by core: `queryAuditFeed` authorizes itself and `verifyAuditRange` calls
// `authorizeAuditRead` first. A denial comes back as `FORBIDDEN`.
//
// The automation feed (#49) adds paging, the undo preview, undo, bulk undo and reassign. Undo and
// reassign are performed by the engine (`@causedeck/core/automation`); these only call it. When the
// engine refuses an undo (the lawyer confirmed or edited the result, or the 7-day window closed)
// the action succeeds with `status: 'refused' | 'expired'` and the engine's reason, so the dialog
// can show it and offer `Open the matter` instead of a dead end.
import { z } from 'zod';

import type { Result } from '../../../../../lib/safe-action.ts';
import { WorkspaceScoped, workspaceAction } from '../../../../../lib/workspace-action.ts';

import type { AuditFeedPage } from './audit-feed.tsx';
import type { ActivityPage } from '@causedeck/core/automation';

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

const LEVEL = z.enum(['L1', 'L2', 'L3', 'L4']);
const CAPTURE_ID = z.uuid();

const LoadMoreActivities = WorkspaceScoped.extend({
  cursor: z.string().min(1).max(200).optional(),
  level: LEVEL.optional(),
  kind: z
    .string()
    .regex(/^[a-z][a-z0-9_]{0,59}$/)
    .optional(),
  matterId: z.uuid().optional(),
  captureId: CAPTURE_ID.optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  q: z.string().trim().min(1).max(200).optional(),
});

const ActivityRef = WorkspaceScoped.extend({ activityId: z.uuid() });
const CaptureRef = WorkspaceScoped.extend({ captureId: CAPTURE_ID });
const Reassign = CaptureRef.extend({ matterId: z.uuid() });

export interface UndoItem {
  activityId: string;
  kind: string;
  summary: string;
}

export type UndoPreviewResult = {
  activityId: string;
  undoable: boolean;
  /** The engine's reason when it would refuse, else null. */
  blockedReason: string | null;
  willRemove: UndoItem[];
  /** For `Open the matter` when the engine refuses. */
  matterId: string | null;
};

export type UndoOutcome =
  | { status: 'undone'; undone: UndoItem[]; skipped: (UndoItem & { reason: string })[] }
  | { status: 'refused' | 'expired'; reason: string; matterId: string | null };

const loadMoreActivities = workspaceAction(LoadMoreActivities, async (input, ctx) => {
  const { listActivitiesFor } = await runtime();
  return (await listActivitiesFor(
    { workspaceId: ctx.workspaceId, userId: ctx.userId },
    {
      ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
      ...(input.level === undefined ? {} : { level: input.level }),
      ...(input.kind === undefined ? {} : { kind: input.kind }),
      ...(input.matterId === undefined ? {} : { matterId: input.matterId }),
      ...(input.captureId === undefined ? {} : { captureId: input.captureId }),
      ...(input.from === undefined ? {} : { from: new Date(input.from) }),
      ...(input.to === undefined ? {} : { to: new Date(input.to) }),
      ...(input.q === undefined ? {} : { q: input.q }),
    },
  )) satisfies ActivityPage;
});

/** The matter of an activity, for `Open the matter`; null when it has none or is not readable. */
async function matterOf(scope: { workspaceId: string; userId: string }, activityId: string) {
  const { getActivityDetailFor } = await runtime();
  try {
    return (await getActivityDetailFor(scope, activityId)).matterId;
  } catch {
    return null;
  }
}

const previewUndo = workspaceAction(
  ActivityRef,
  async (input, ctx): Promise<UndoPreviewResult> => {
    const scope = { workspaceId: ctx.workspaceId, userId: ctx.userId };
    const { previewUndoFor } = await runtime();
    const preview = await previewUndoFor(scope, input.activityId);
    return { ...preview, matterId: await matterOf(scope, input.activityId) };
  },
  { action: 'matter.write' },
);

function isUndoRefusal(error: unknown): error is Error {
  return (
    error instanceof Error &&
    (error.name === 'UndoRefusedError' || error.name === 'UndoExpiredError')
  );
}

const undoActivity = workspaceAction(
  ActivityRef,
  async (input, ctx): Promise<UndoOutcome> => {
    const scope = { workspaceId: ctx.workspaceId, userId: ctx.userId };
    const { undoActivityFor } = await runtime();
    try {
      const result = await undoActivityFor(scope, input.activityId);
      return { status: 'undone', undone: result.undone, skipped: [] };
    } catch (error) {
      if (!isUndoRefusal(error)) throw error;
      return {
        status: error.name === 'UndoExpiredError' ? 'expired' : 'refused',
        reason: error.message,
        matterId: await matterOf(scope, input.activityId),
      };
    }
  },
  { action: 'matter.write' },
);

const undoCapture = workspaceAction(
  CaptureRef,
  async (input, ctx): Promise<UndoOutcome> => {
    const { undoCaptureFor } = await runtime();
    const result = await undoCaptureFor(
      { workspaceId: ctx.workspaceId, userId: ctx.userId },
      input.captureId,
    );
    return { status: 'undone', undone: result.undone, skipped: result.skipped };
  },
  { action: 'matter.write' },
);

const reassignCapture = workspaceAction(
  Reassign,
  async (input, ctx) => {
    const { reassignCaptureFor } = await runtime();
    return reassignCaptureFor(
      { workspaceId: ctx.workspaceId, userId: ctx.userId },
      input.captureId,
      input.matterId,
    );
  },
  { action: 'matter.write' },
);

export async function loadMoreActivitiesAction(raw: unknown): Promise<Result<ActivityPage>> {
  return loadMoreActivities(raw);
}

export async function previewActivityUndoAction(raw: unknown): Promise<Result<UndoPreviewResult>> {
  return previewUndo(raw);
}

export async function undoActivityAction(raw: unknown): Promise<Result<UndoOutcome>> {
  return undoActivity(raw);
}

export async function undoCaptureAction(raw: unknown): Promise<Result<UndoOutcome>> {
  return undoCapture(raw);
}

export async function reassignCaptureAction(raw: unknown) {
  return reassignCapture(raw);
}
