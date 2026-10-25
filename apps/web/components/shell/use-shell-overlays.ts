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
  if (key === undefined || typeof requestAnimationFrame !== 'function') return;
  requestAnimationFrame(() => {
    // The page (or a test's DOM) can be gone by the next frame.
    if (typeof document === 'undefined') return;
    const active = document.activeElement;
    if (active !== null && active !== document.body && active.isConnected) return;
    const replacement = [...document.querySelectorAll<HTMLElement>('[data-focus-key]')].find(
      (element) => element.dataset.focusKey === key,
    );
    replacement?.focus();
  });
}

/** The `data-focus-key` of the focused element, if there is still a DOM to ask. */
function focusedKey(): string | undefined {
  if (typeof document === 'undefined') return undefined;
  const active = document.activeElement;
  return active instanceof HTMLElement ? active.dataset.focusKey : undefined;
}

/**
 * Load the overlay chunk (once) and re-render every shell component waiting for it. The chunk can
 * arrive after the DOM is gone (a test environment torn down mid-load), so focus is only carried
 * over while a document exists. A failed load is forgotten, so the next trigger tries again.
 */
export function loadShellOverlays(): Promise<ShellOverlays> {
  pending ??= import('./shell-overlays.tsx').then(
    (mod) => {
      const key = focusedKey();
      loaded = mod;
      for (const notify of listeners) notify();
      restoreFocus(key);
      return mod;
    },
    (error: unknown) => {
      pending = null;
      throw error;
    },
  );
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
        // A prefetch that fails is not an error: opening a trigger loads the chunk again.
        loadShellOverlays().catch(() => undefined);
      }),
    [],
  );
  return useSyncExternalStore(
    subscribe,
    () => loaded,
    () => null,
  );
}
