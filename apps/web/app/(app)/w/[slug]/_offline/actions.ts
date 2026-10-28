'use server';
// Offline server actions (#65 part 2, #743). `pullCourtDaySnapshotAction` returns the court-day
// boards and briefs of a date range for the client's encrypted cache; `pushOutboxAction` applies the
// queued edits. Both go through `workspaceAction` (zod input, session, membership); the services
// decide again per matter and listing, and the acting user is always the session's. A
// `'use server'` module can only export async functions, so the logic is in snapshot.ts and
// outbox.ts.
import { z } from 'zod';

import type { Role } from '../../../../../lib/workspace-context.ts';
import { type Result } from '../../../../../lib/safe-action.ts';
import { WorkspaceScoped, workspaceAction } from '../../../../../lib/workspace-action.ts';

import { applyOutbox, OutboxBatch, type OutboxResult } from './outbox.ts';
import { daysInRange, MAX_PULL_DAYS, pullSnapshot, type CourtDaySnapshot } from './snapshot.ts';

const ids = z.array(z.uuid()).max(2000).default([]);

const PullInput = WorkspaceScoped.extend({
  from: z.iso.date(),
  to: z.iso.date(),
  known: z
    .strictObject({ matterIds: ids, listingIds: ids, memberIds: ids })
    .default({ matterIds: [], listingIds: [], memberIds: [] }),
}).refine((v) => v.to >= v.from && daysInRange(v.from, v.to) <= MAX_PULL_DAYS, {
  path: ['to'],
  message: `A range of at most ${String(MAX_PULL_DAYS)} days`,
});

const pull = workspaceAction(PullInput, (input, ctx): Promise<CourtDaySnapshot> =>
  pullSnapshot(
    { workspaceId: ctx.workspaceId, userId: ctx.userId, role: ctx.role as Role },
    ctx.tx,
    input,
  ),
);

const PushInput = WorkspaceScoped.extend(OutboxBatch.shape);

const push = workspaceAction(PushInput, (input, ctx): Promise<OutboxResult[]> =>
  applyOutbox(input.items, ctx),
);

export async function pullCourtDaySnapshotAction(raw: unknown): Promise<Result<CourtDaySnapshot>> {
  return pull(raw);
}

export async function pushOutboxAction(raw: unknown): Promise<Result<OutboxResult[]>> {
  return push(raw);
}
