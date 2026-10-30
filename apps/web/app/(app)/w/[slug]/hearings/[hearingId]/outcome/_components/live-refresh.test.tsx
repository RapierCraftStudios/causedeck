/* eslint-disable unicorn/filename-case -- the route segment `[hearingId]` is fixed by the issue's path */
// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

import { LiveRefresh } from './live-refresh.tsx';

function setOnline(value: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value });
}

describe('LiveRefresh', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    refresh.mockClear();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    setOnline(true);
  });

  it('refreshes on the interval while online', () => {
    setOnline(true);
    render(<LiveRefresh active />);
    vi.advanceTimersByTime(15_000);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('never refreshes offline: a failed refresh would re-mount the form (offline Confirm)', () => {
    setOnline(false);
    render(<LiveRefresh active />);
    vi.advanceTimersByTime(60_000);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('does nothing once the outcome is confirmed', () => {
    setOnline(true);
    render(<LiveRefresh active={false} />);
    vi.advanceTimersByTime(60_000);
    expect(refresh).not.toHaveBeenCalled();
  });
});
