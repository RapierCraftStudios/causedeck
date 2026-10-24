// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  bannerMode,
  dismissInstall,
  isDismissed,
  isIos,
  recordVisit,
} from '../../lib/pwa/install.ts';

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

const base = { visits: 2, standalone: false, dismissed: false, ios: false, hasPrompt: true };

describe('install banner rules (#50)', () => {
  it('shows on Android from the second visit once the browser offers the prompt', () => {
    expect(bannerMode({ ...base, visits: 1 })).toBeNull();
    expect(bannerMode(base)).toBe('android');
    expect(bannerMode({ ...base, hasPrompt: false })).toBeNull();
  });

  it('shows add-to-home-screen steps on iOS, which has no install prompt', () => {
    expect(bannerMode({ ...base, ios: true, hasPrompt: false })).toBe('ios');
  });

  it('never shows in standalone mode or after dismissal', () => {
    expect(bannerMode({ ...base, standalone: true })).toBeNull();
    expect(bannerMode({ ...base, ios: true, standalone: true })).toBeNull();
    expect(bannerMode({ ...base, dismissed: true })).toBeNull();
  });

  it('detects iPhone, iPad and iPadOS (a Mac with touch)', () => {
    expect(isIos('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', 5)).toBe(true);
    expect(isIos('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)', 5)).toBe(true);
    expect(isIos('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 5)).toBe(true);
    expect(isIos('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 0)).toBe(false);
    expect(isIos('Mozilla/5.0 (Linux; Android 14; Pixel 8)', 5)).toBe(false);
  });

  it('counts visits and remembers a dismissal per viewer', () => {
    expect(recordVisit()).toBe(1);
    expect(recordVisit()).toBe(2);
    expect(isDismissed('user-a')).toBe(false);
    dismissInstall('user-a');
    expect(isDismissed('user-a')).toBe(true);
    expect(isDismissed('user-b')).toBe(false);
  });

  it('survives storage that throws (private mode, blocked storage)', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => {
      recordVisit();
    }).not.toThrow();
    expect(() => {
      dismissInstall('user-a');
    }).not.toThrow();
    expect(isDismissed('user-a')).toBe(false);
  });
});
