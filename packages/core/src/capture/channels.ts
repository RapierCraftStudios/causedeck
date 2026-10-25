// Per-channel opt-in (#43; PRD CA-9; docs/product/09 §8). Every channel except `manual` and
// `upload` is off until a member with `workspace.manage` turns it on after seeing the plain-language
// note on where the data goes (India region, no training). The row records the note's version.
import {
  CAPTURE_CHANNELS,
  DEFAULT_ENABLED_CHANNELS,
  type CaptureChannel,
} from '@causedeck/capture';
import { schema, withWorkspace, type Queryable } from '@causedeck/db';
import { and, eq } from 'drizzle-orm';

import { invalid } from '../shared/errors.ts';

import { auditCapture } from './audit.ts';
import type { CaptureCtx } from './context.ts';
import { ChannelDisabledError } from './errors.ts';

const { workspaceCaptureChannel } = schema;

/**
 * The version of the "where your data goes" note the settings UI shows (#48, #287). Bump it when
 * the wording changes; `enableChannel` only accepts the current version.
 */
export const CAPTURE_DISCLOSURE_VERSION = '2026-10-v1';

export interface ChannelState {
  channel: CaptureChannel;
  enabled: boolean;
  enabledAt: Date | null;
  disclosureVersion: string | null;
}

function checkChannel(channel: string): CaptureChannel {
  if (!(CAPTURE_CHANNELS as readonly string[]).includes(channel)) {
    throw invalid('Unknown capture channel');
  }
  return channel as CaptureChannel;
}

/** Whether `channel` accepts captures now: the default channels unless switched off, else opt-in. */
export async function isChannelEnabled(
  db: Queryable,
  workspaceId: string,
  channel: CaptureChannel,
): Promise<boolean> {
  const [row] = await db
    .select({ enabled: workspaceCaptureChannel.enabled })
    .from(workspaceCaptureChannel)
    .where(
      and(
        eq(workspaceCaptureChannel.workspaceId, workspaceId),
        eq(workspaceCaptureChannel.channel, channel),
      ),
    );
  return row?.enabled ?? DEFAULT_ENABLED_CHANNELS.includes(channel);
}

/** Throws `ChannelDisabledError` unless the channel is enabled. */
export async function assertChannelEnabled(
  db: Queryable,
  workspaceId: string,
  channel: CaptureChannel,
): Promise<void> {
  if (!(await isChannelEnabled(db, workspaceId, channel))) throw new ChannelDisabledError(channel);
}

/** Every channel with its current state, in registry order. */
export async function listChannels(db: Queryable, workspaceId: string): Promise<ChannelState[]> {
  const rows = await db
    .select()
    .from(workspaceCaptureChannel)
    .where(eq(workspaceCaptureChannel.workspaceId, workspaceId));
  const byChannel = new Map(rows.map((row) => [row.channel, row]));
  return CAPTURE_CHANNELS.map((channel) => {
    const row = byChannel.get(channel);
    return {
      channel,
      enabled: row?.enabled ?? DEFAULT_ENABLED_CHANNELS.includes(channel),
      enabledAt: row?.enabledAt ?? null,
      disclosureVersion: row?.disclosureVersion ?? null,
    };
  });
}

export interface EnableChannelInput {
  channel: string;
  /** The version of the note the member was shown; must be the current one. */
  disclosureVersion: string;
}

/** Enable a channel (needs `workspace.manage`), recording the disclosure version; audited fail-closed. */
export async function enableChannel(
  ctx: CaptureCtx,
  input: EnableChannelInput,
): Promise<ChannelState> {
  await ctx.authorize('workspace.manage');
  const channel = checkChannel(input.channel);
  if (input.disclosureVersion !== CAPTURE_DISCLOSURE_VERSION) {
    throw invalid('Review the current data-flow note before enabling this channel');
  }
  const now = ctx.now?.() ?? new Date();
  return withWorkspace(ctx.db, { workspaceId: ctx.workspaceId, userId: ctx.userId }, async (tx) => {
    const values = {
      enabled: true,
      enabledBy: ctx.userId,
      enabledAt: now,
      disclosureVersion: CAPTURE_DISCLOSURE_VERSION,
    };
    await tx
      .insert(workspaceCaptureChannel)
      .values({ workspaceId: ctx.workspaceId, channel, ...values })
      .onConflictDoUpdate({
        target: [workspaceCaptureChannel.workspaceId, workspaceCaptureChannel.channel],
        set: values,
      });
    await auditCapture(
      ctx,
      tx,
      'capture.channel_enabled',
      { kind: 'capture_channel', id: channel },
      {
        channel,
        disclosureVersion: CAPTURE_DISCLOSURE_VERSION,
      },
    );
    return {
      channel,
      enabled: true,
      enabledAt: now,
      disclosureVersion: CAPTURE_DISCLOSURE_VERSION,
    };
  });
}

/** Disable a channel (needs `workspace.manage`). Captures already taken are untouched. */
export async function disableChannel(ctx: CaptureCtx, channelName: string): Promise<ChannelState> {
  await ctx.authorize('workspace.manage');
  const channel = checkChannel(channelName);
  return withWorkspace(ctx.db, { workspaceId: ctx.workspaceId, userId: ctx.userId }, async (tx) => {
    await tx
      .insert(workspaceCaptureChannel)
      .values({ workspaceId: ctx.workspaceId, channel, enabled: false })
      .onConflictDoUpdate({
        target: [workspaceCaptureChannel.workspaceId, workspaceCaptureChannel.channel],
        set: { enabled: false },
      });
    await auditCapture(
      ctx,
      tx,
      'capture.channel_disabled',
      { kind: 'capture_channel', id: channel },
      {
        channel,
      },
    );
    const [row] = await tx
      .select()
      .from(workspaceCaptureChannel)
      .where(
        and(
          eq(workspaceCaptureChannel.workspaceId, ctx.workspaceId),
          eq(workspaceCaptureChannel.channel, channel),
        ),
      );
    return {
      channel,
      enabled: false,
      enabledAt: row?.enabledAt ?? null,
      disclosureVersion: row?.disclosureVersion ?? null,
    };
  });
}
