'use server';
// Help server actions (#94). Both go through `workspaceAction` (zod input, `requireSession`,
// membership). `dismissCoachmarkAction` records a first-run coachmark dismissal for the caller in
// `help_state`; `requestSupportSessionAction` is the owner-only (`support.manage`) `Request support
// session`: a pending, metadata-only, audited request with the grant length the owner chose.
import { z } from 'zod';

import type { Result } from '../../../../../lib/safe-action.ts';
import { WorkspaceScoped, workspaceAction } from '../../../../../lib/workspace-action.ts';

/** Grant lengths the help sheet offers, in minutes; the domain allows 1 to 240 (default 60). */
const REQUEST_MINUTES = [60, 120, 240] as const;

const DismissCoachmark = WorkspaceScoped.extend({ key: z.string().min(1).max(64) });
const RequestSupport = WorkspaceScoped.extend({
  reason: z.string().trim().min(1).max(500),
  minutes: z.literal(REQUEST_MINUTES).default(60),
});

export interface SupportRequestOutcome {
  sessionId: string;
  status: string;
}

const dismiss = workspaceAction(DismissCoachmark, async (input, ctx) => {
  const { dismissCoachmark } = await import('@causedeck/core/help');
  await dismissCoachmark(
    ctx.tx,
    { userId: ctx.userId, workspaceId: ctx.workspaceId },
    { key: input.key },
  );
  return { key: input.key };
});

const requestSupport = workspaceAction(
  RequestSupport,
  async (input, ctx) => {
    const { requestMemberSupport } = await import('@causedeck/core/support');
    const row = await requestMemberSupport(
      { db: ctx.tx, userId: ctx.userId, workspaceId: ctx.workspaceId },
      { reason: input.reason, minutes: input.minutes },
    );
    return { sessionId: row.id, status: row.status };
  },
  { action: 'support.manage' },
);

export async function dismissCoachmarkAction(raw: unknown): Promise<Result<{ key: string }>> {
  return dismiss(raw);
}

export async function requestSupportSessionAction(
  raw: unknown,
): Promise<Result<SupportRequestOutcome>> {
  return requestSupport(raw);
}
