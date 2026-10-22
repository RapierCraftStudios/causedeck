import { describe, expect, it } from 'vitest';

import {
  discardTtl,
  forwardedTextTtl,
  initialTtl,
  isExpired,
  RAW_TTL_DAYS,
  type CaptureStatus,
} from '../index.ts';

const T0 = new Date('2026-10-19T10:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

describe('retention rules', () => {
  it('gives audio a 30 day TTL and keeps everything else', () => {
    expect(RAW_TTL_DAYS).toBe(30);
    expect(initialTtl({ mime: 'audio/webm', createdAt: T0 })?.getTime()).toBe(
      T0.getTime() + 30 * DAY,
    );
    expect(initialTtl({ mime: 'audio/mp4', createdAt: T0 })).not.toBeNull();
    for (const mime of ['application/pdf', 'image/png', 'text/plain', 'application/zip']) {
      expect(initialTtl({ mime, createdAt: T0 }), mime).toBeNull();
    }
  });

  it('expires forwarded raw text 30 days after extraction', () => {
    const extractedAt = new Date('2026-11-02T08:00:00Z');
    expect(forwardedTextTtl(extractedAt).getTime()).toBe(extractedAt.getTime() + 30 * DAY);
  });

  it('makes a discarded capture due at once, so the daily sweep removes it within 24 hours', () => {
    expect(discardTtl(T0).getTime()).toBe(T0.getTime());
  });

  it('expires a raw object only after ttl_at, and a pin keeps it (a discard overrides the pin)', () => {
    const past = new Date(T0.getTime() - 1);
    const future = new Date(T0.getTime() + 1);
    const state = (ttlAt: Date | null, pinned: boolean, status: CaptureStatus = 'ready') => ({
      ttlAt,
      pinned,
      status,
    });
    expect(isExpired(state(null, false), T0)).toBe(false);
    expect(isExpired(state(future, false), T0)).toBe(false);
    expect(isExpired(state(past, false), T0)).toBe(true);
    expect(isExpired(state(T0, false), T0)).toBe(true);
    expect(isExpired(state(past, true), T0)).toBe(false);
    expect(isExpired(state(past, true, 'discarded'), T0)).toBe(true);
  });
});
