// Raw-input retention (#43; docs/product/09 §8): audio raw lives 30 days, forwarded raw text 30
// days after extraction unless pinned, and a discarded capture's raw object goes within 24 hours.
// Pure date rules; the sweep that deletes objects is `sweepExpiredCaptures` in `@causedeck/core`.
import type { CaptureChannel, CaptureStatus } from './types.ts';

export const RAW_TTL_DAYS = 30;
export const DISCARD_DELETE_HOURS = 24;

const DAY_MS = 24 * 60 * 60 * 1000;

/** `ttl_at` at creation: now + 30 days for audio, null (kept) for everything else. */
export function initialTtl(input: { mime: string; createdAt: Date }): Date | null {
  return input.mime.toLowerCase().startsWith('audio/')
    ? new Date(input.createdAt.getTime() + RAW_TTL_DAYS * DAY_MS)
    : null;
}

/** `ttl_at` for forwarded raw text (email channel): extraction time + 30 days. */
export function forwardedTextTtl(extractedAt: Date): Date {
  return new Date(extractedAt.getTime() + RAW_TTL_DAYS * DAY_MS);
}

/**
 * `ttl_at` for a discarded capture: due at once, so the daily sweep (02:00 IST) deletes the raw
 * object within `DISCARD_DELETE_HOURS` of the discard.
 */
export function discardTtl(now: Date): Date {
  return new Date(now.getTime());
}

export interface RetentionState {
  ttlAt: Date | null;
  pinned: boolean;
  status: CaptureStatus;
}

/** Whether the raw object is due for deletion. A pin keeps it, except for a discarded capture. */
export function isExpired(state: RetentionState, now: Date): boolean {
  if (state.ttlAt === null || state.ttlAt.getTime() > now.getTime()) return false;
  return state.status === 'discarded' || !state.pinned;
}

/** The channel whose raw text expires 30 days after extraction. */
export const FORWARDED_TEXT_CHANNEL: CaptureChannel = 'email';
