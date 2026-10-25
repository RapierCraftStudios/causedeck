'use server';
// Court-day reminder preferences server actions (#64): get and set the signed-in member's evening,
// morning and outcome-missing reminders (kind, time or delay, channels). Each goes through
// `workspaceAction` (zod, `requireSession`, membership) and calls the notifications service on the
// workspace-scoped transaction for `ctx.userId`: the input never names a user.
import { ReminderChannels } from '@causedeck/validators';
import { z } from 'zod';

import { ActionError, type Result } from '../../../../../../lib/safe-action.ts';
import { WorkspaceScoped, workspaceAction } from '../../../../../../lib/workspace-action.ts';

export interface ReminderPrefsView {
  evening: { enabled: boolean; time: string; channels: ReminderChannels };
  morning: { enabled: boolean; time: string; channels: ReminderChannels };
  outcome_missing: { enabled: boolean; delayMinutes: number; channels: ReminderChannels };
}

const SetInput = WorkspaceScoped.extend({
  evening: z.strictObject({ time: z.string(), channels: ReminderChannels }).partial({ time: true }),
  morning: z.strictObject({ channels: ReminderChannels }),
  outcome_missing: z
    .strictObject({ delayMinutes: z.int(), channels: ReminderChannels })
    .partial({ delayMinutes: true }),
});

const service = () => import('@causedeck/notifications');

const get = workspaceAction(WorkspaceScoped, async (_input, ctx) => {
  const { getReminderPreferences } = await service();
  return getReminderPreferences(
    { db: ctx.tx, workspaceId: ctx.workspaceId },
    { userId: ctx.userId },
  );
});

const set = workspaceAction(SetInput, async (input, ctx) => {
  const { setReminderPreferences, NotificationError } = await service();
  try {
    return await setReminderPreferences(
      { db: ctx.tx, workspaceId: ctx.workspaceId },
      {
        userId: ctx.userId,
        evening: {
          channels: input.evening.channels,
          ...(input.evening.time === undefined ? {} : { time: input.evening.time }),
        },
        morning: input.morning,
        outcome_missing: {
          channels: input.outcome_missing.channels,
          ...(input.outcome_missing.delayMinutes === undefined
            ? {}
            : { delayMinutes: input.outcome_missing.delayMinutes }),
        },
      },
    );
  } catch (error) {
    if (error instanceof NotificationError) throw new ActionError(error.code, error.message);
    throw error;
  }
});

// A `'use server'` module may only export async functions, so each action is wrapped.

export async function getReminderPreferencesAction(
  raw: unknown,
): Promise<Result<ReminderPrefsView>> {
  return get(raw);
}

export async function setReminderPreferencesAction(
  raw: unknown,
): Promise<Result<ReminderPrefsView>> {
  return set(raw);
}
