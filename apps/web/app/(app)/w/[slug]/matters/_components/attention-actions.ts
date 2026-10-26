'use server';
// Stale-matter attention server actions (#70): snooze with a reason, dismiss as intentionally
// dormant, lift. Each goes through `workspaceAction` (strict zod input, session, membership) and
// `@causedeck/core/attention` on the workspace-scoped transaction, which checks the role again and
// writes the audit entry. A flag never changes a matter, listing, hearing or obligation, and nothing
// here sends a message.
import { assertCan } from '@causedeck/auth/policy';
import { LiftSnoozeInput, Snooze } from '@causedeck/validators/attention';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { type Result } from '../../../../../../lib/safe-action.ts';
import {
  WorkspaceScoped,
  workspaceAction,
  type WorkspaceActionCtx,
} from '../../../../../../lib/workspace-action.ts';

const SnoozeAction = WorkspaceScoped.extend({
  matterId: z.uuid(),
  rule: z
    .enum([
      'no_next_date',
      'past_date_no_outcome',
      'no_recent_update',
      'obligation_overdue_unowned',
    ])
    .nullable(),
  until: z.iso.date(),
  reason: z.string().trim().min(1).max(500),
}).strict();
const DismissAction = WorkspaceScoped.extend({
  matterId: z.uuid(),
  rule: z
    .enum([
      'no_next_date',
      'past_date_no_outcome',
      'no_recent_update',
      'obligation_overdue_unowned',
    ])
    .nullable(),
}).strict();
const LiftAction = WorkspaceScoped.extend({ snoozeId: LiftSnoozeInput.shape.snoozeId }).strict();

export interface AttentionActionResult {
  id: string;
  dismissed: boolean;
  until: string | null;
}

const deps = (ctx: WorkspaceActionCtx) => ({ db: ctx.tx });
const actor = (ctx: WorkspaceActionCtx) => ({ workspaceId: ctx.workspaceId, userId: ctx.userId });
const refresh = () => {
  revalidatePath('/w/[slug]/matters', 'page');
};

const snooze = workspaceAction(
  SnoozeAction,
  async ({ matterId, rule, until, reason }, ctx) => {
    assertCan(ctx.actor, 'matter.write');
    const { snoozeFlag } = await import('@causedeck/core/attention');
    const input = Snooze.parse({ kind: 'snooze', matterId, rule, until, reason });
    const row = await snoozeFlag(deps(ctx), actor(ctx), input);
    refresh();
    return { id: row.id, dismissed: row.dismissed, until: row.until };
  },
  { action: 'matter.write' },
);

const dismiss = workspaceAction(
  DismissAction,
  async ({ matterId, rule }, ctx) => {
    assertCan(ctx.actor, 'matter.write');
    const { dismissFlag } = await import('@causedeck/core/attention');
    const input = Snooze.parse({ kind: 'dismiss', matterId, rule });
    const row = await dismissFlag(deps(ctx), actor(ctx), input);
    refresh();
    return { id: row.id, dismissed: row.dismissed, until: row.until };
  },
  { action: 'matter.write' },
);

const lift = workspaceAction(
  LiftAction,
  async ({ snoozeId }, ctx) => {
    assertCan(ctx.actor, 'matter.write');
    const { liftSnooze } = await import('@causedeck/core/attention');
    await liftSnooze(deps(ctx), actor(ctx), { snoozeId });
    refresh();
    return { id: snoozeId, dismissed: false, until: null };
  },
  { action: 'matter.write' },
);

export async function snoozeFlagAction(input: unknown): Promise<Result<AttentionActionResult>> {
  return snooze(input);
}
export async function dismissFlagAction(input: unknown): Promise<Result<AttentionActionResult>> {
  return dismiss(input);
}
export async function liftSnoozeAction(input: unknown): Promise<Result<AttentionActionResult>> {
  return lift(input);
}
