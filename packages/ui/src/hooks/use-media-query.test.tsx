// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useMediaQuery } from './use-media-query';
import { REDUCED_MOTION_QUERY, useReducedMotion } from './use-reduced-motion';

/** A controllable `matchMedia` that emulates one media feature. */
function emulateMedia(matchingQueries: Set<string>) {
  const listeners = new Set<() => void>();
  const matchMedia = vi.fn((query: string) => ({
    get matches() {
      return matchingQueries.has(query);
    },
    media: query,
    addEventListener: (_: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
  }));
  vi.stubGlobal('matchMedia', matchMedia);
  return {
    set(query: string, on: boolean) {
      if (on) matchingQueries.add(query);
      else matchingQueries.delete(query);
      act(() => {
        for (const listener of listeners) listener();
      });
    },
    listeners,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useMediaQuery', () => {
  it('tracks the query and unsubscribes on unmount', () => {
    const media = emulateMedia(new Set());
    const { result, unmount } = renderHook(() => useMediaQuery('(min-width: 768px)'));
    expect(result.current).toBe(false);
    media.set('(min-width: 768px)', true);
    expect(result.current).toBe(true);
    unmount();
    expect(media.listeners.size).toBe(0);
  });
});

describe('useReducedMotion', () => {
  it('is true when prefers-reduced-motion: reduce is emulated', () => {
    const media = emulateMedia(new Set([REDUCED_MOTION_QUERY]));
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(true);
    media.set(REDUCED_MOTION_QUERY, false);
    expect(result.current).toBe(false);
  });
});
