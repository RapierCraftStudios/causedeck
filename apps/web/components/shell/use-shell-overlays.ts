'use client';

import { useEffect, useSyncExternalStore } from 'react';

import type * as Overlays from './shell-overlays.tsx';

export type ShellOverlays = typeof Overlays;

let loaded: ShellOverlays | null = null;
let pending: Promise<ShellOverlays> | null = null;
const listeners = new Set<() => void>();

const subscribe = (onChange: () => void) => {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
};

/**
 * Swapping a static trigger for its Radix-wrapped twin remounts it, so focus on an element tagged
 * `data-focus-key` moves to its replacement.
 */
function restoreFocus(key: string | undefined) {
  if (key === undefined) return;
  requestAnimationFrame(() => {
    const active = document.activeElement;
    if (active !== null && active !== document.body && active.isConnected) return;
    const replacement = [...document.querySelectorAll<HTMLElement>('[data-focus-key]')].find(
      (element) => element.dataset.focusKey === key,
    );
    replacement?.focus();
  });
}

/** Load the overlay chunk (once) and re-render every shell component waiting for it. */
export function loadShellOverlays(): Promise<ShellOverlays> {
  pending ??= import('./shell-overlays.tsx').then((mod) => {
    const active = document.activeElement;
    const key = active instanceof HTMLElement ? active.dataset.focusKey : undefined;
    loaded = mod;
    for (const notify of listeners) notify();
    restoreFocus(key);
    return mod;
  });
  return pending;
}

function whenIdle(run: () => void): () => void {
  if (typeof window.requestIdleCallback === 'function') {
    const id = window.requestIdleCallback(run, { timeout: 2000 });
    return () => {
      window.cancelIdleCallback(id);
    };
  }
  const id = window.setTimeout(run, 200);
  return () => {
    window.clearTimeout(id);
  };
}

/**
 * The overlay primitives (switcher popover, user menu, rail tooltips), or `null` until their
 * chunk has loaded: at idle after mount, or sooner when a trigger calls `loadShellOverlays()`.
 * Render a static fallback until then.
 */
export function useShellOverlays(): ShellOverlays | null {
  useEffect(
    () =>
      whenIdle(() => {
        void loadShellOverlays();
      }),
    [],
  );
  return useSyncExternalStore(
    subscribe,
    () => loaded,
    () => null,
  );
}
