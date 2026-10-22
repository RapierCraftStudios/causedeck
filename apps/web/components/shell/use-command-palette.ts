'use client';

import { useHotkey } from '@causedeck/ui/hooks';
import { useEffect, useState, useSyncExternalStore } from 'react';

import { registerNavigationCommands } from '../../lib/commands/navigation-commands.ts';
import { registerMatterCommands } from '../../lib/matters/command-palette.ts';

import type * as PaletteModule from './command-palette.tsx';

export type CommandPaletteComponent = typeof PaletteModule.CommandPalette;

let loaded: CommandPaletteComponent | null = null;
let pending: Promise<CommandPaletteComponent> | null = null;
const listeners = new Set<() => void>();

const subscribe = (onChange: () => void) => {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
};

/** Load the palette chunk (once) and re-render every host waiting for it. */
export function loadCommandPalette(): Promise<CommandPaletteComponent> {
  pending ??= import('./command-palette.tsx').then((mod) => {
    loaded = mod.CommandPalette;
    for (const notify of listeners) notify();
    return mod.CommandPalette;
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

export interface CommandPaletteState {
  open: boolean;
  setOpen: (open: boolean) => void;
  /** The palette component, or `null` until its chunk has loaded. */
  Palette: CommandPaletteComponent | null;
}

/**
 * Palette open state for the topbar. `mod+k` toggles it (also while typing). The chunk loads at
 * idle after mount, or immediately on first open; an open requested before it arrives shows the
 * palette as soon as it does.
 */
export function useCommandPalette(): CommandPaletteState {
  const [open, setOpenState] = useState(false);
  const Palette = useSyncExternalStore(
    subscribe,
    () => loaded,
    () => null,
  );

  useEffect(() => {
    registerNavigationCommands();
    // Matter search and `New matter` (#388): ⌘K finds matters from every workspace route.
    registerMatterCommands();
    return whenIdle(() => {
      void loadCommandPalette();
    });
  }, []);

  const setOpen = (next: boolean) => {
    if (next) void loadCommandPalette();
    setOpenState(next);
  };

  useHotkey('mod+k', () => {
    void loadCommandPalette();
    setOpenState((value) => !value);
  });

  return { open, setOpen, Palette };
}
