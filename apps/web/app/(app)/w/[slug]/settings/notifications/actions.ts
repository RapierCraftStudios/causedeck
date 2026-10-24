'use server';
// Notification preferences server actions (#199). Each one goes through `workspaceAction`
// (lib/workspace-action.ts): zod input, `requireSession`, then the caller's membership, with
// non-members rejected as FORBIDDEN before the handler runs. The handlers call the notifications
// service (`@causedeck/notifications`) on the workspace-scoped transaction `ctx.tx`, always for the
// signed-in user: the input never names a user, so a member only changes their own preferences.
// Turning off a mandatory (locked) channel is refused by the service as VALIDATION.
import {
  CHANNELS,
  DIGESTS,
  isCategoryKey,
  type CategoryKey,
  type Digest,
} from '@causedeck/notifications/categories';
import { z } from 'zod';

import { ActionError, type Result } from '../../../../../../lib/safe-action.ts';
import {
  WorkspaceScoped,
  workspaceAction,
  type WorkspaceActionCtx,
} from '../../../../../../lib/workspace-action.ts';

/** One category/channel cell as the client sees it. */
export interface PreferenceView {
  category: CategoryKey;
  channel: (typeof CHANNELS)[number];
  enabled: boolean;
  digest: Digest;
  locked: boolean;
}

export interface SettingsView {
  courtHoursQuiet: boolean;
  lockScreenDetails: boolean;
}

const PreferenceInput = WorkspaceScoped.extend({
  category: z.string().refine(isCategoryKey, 'unknown notification category'),
  channel: z.enum(CHANNELS),
  enabled: z.boolean(),
});
const DigestInput = WorkspaceScoped.extend({ digest: z.enum(DIGESTS) });
const ToggleInput = WorkspaceScoped.extend({ enabled: z.boolean() });

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

const setPref = workspaceAction(PreferenceInput, async (input, ctx) => {
  const { setPreference } = await service();
  return run(async (): Promise<PreferenceView> =>
    setPreference(scope(ctx), {
      userId: ctx.userId,
      category: input.category,
      channel: input.channel,
      enabled: input.enabled,
    }),
  );
});

const setDigestMode = workspaceAction(DigestInput, async (input, ctx) => {
  const { setDigest } = await service();
  const digest = await run(() =>
    setDigest(scope(ctx), { userId: ctx.userId, digest: input.digest }),
  );
  return { digest };
});

const setCourtHours = workspaceAction(ToggleInput, async (input, ctx) => {
  const { setCourtHoursQuiet } = await service();
  return run(async (): Promise<SettingsView> =>
    setCourtHoursQuiet(scope(ctx), { userId: ctx.userId, enabled: input.enabled }),
  );
});

const setLockScreen = workspaceAction(ToggleInput, async (input, ctx) => {
  const { setLockScreenDetails } = await service();
  return run(async (): Promise<SettingsView> =>
    setLockScreenDetails(scope(ctx), { userId: ctx.userId, enabled: input.enabled }),
  );
});

// A `'use server'` module may only export async functions, so each action is wrapped.

export async function setNotificationPreferenceAction(
  raw: unknown,
): Promise<Result<PreferenceView>> {
  return setPref(raw);
}

export async function setNotificationDigestAction(
  raw: unknown,
): Promise<Result<{ digest: Digest }>> {
  return setDigestMode(raw);
}

export async function setCourtHoursQuietAction(raw: unknown): Promise<Result<SettingsView>> {
  return setCourtHours(raw);
}

export async function setLockScreenDetailsAction(raw: unknown): Promise<Result<SettingsView>> {
  return setLockScreen(raw);
}
