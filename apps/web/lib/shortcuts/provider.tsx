'use client';

import { useIsEnabled } from '@causedeck/flags/react';
import { useIsMac } from '@causedeck/ui/hooks';
import { useRouter } from 'next/navigation';
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

import { openNotifications } from '../../components/notifications/use-notifications.ts';
import { useCapture } from '../../components/shell/capture-fab.tsx';
import { useSidebar } from '../../components/shell/sidebar-collapse.tsx';
import { getCommands, registerCommands } from '../commands/registry.ts';
import { getNavItem } from '../nav.ts';
import type { FlagKey, Role } from '../workspace-context.ts';

import {
  actionKeys,
  createShortcutDispatcher,
  visibleShortcuts,
  type ShortcutDefinition,
  type VisibleShortcutsOptions,
} from './registry.ts';
import type * as DialogModule from './shortcuts-dialog.tsx';

export type ShortcutsDialogComponent = typeof DialogModule.ShortcutsHelpDialog;

let loaded: ShortcutsDialogComponent | null = null;
let pending: Promise<ShortcutsDialogComponent> | null = null;
const listeners = new Set<() => void>();

const subscribe = (onChange: () => void) => {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
};

/** Load the help dialog chunk (once) and re-render every provider waiting for it. */
export function loadShortcutsDialog(): Promise<ShortcutsDialogComponent> {
  pending ??= import('./shortcuts-dialog.tsx').then((mod) => {
    loaded = mod.ShortcutsHelpDialog;
    for (const notify of listeners) notify();
    return mod.ShortcutsHelpDialog;
  });
  return pending;
}

/** The help dialog component, or `null` until its chunk has loaded. */
function useShortcutsDialog(): { Dialog: ShortcutsDialogComponent | null } {
  const Dialog = useSyncExternalStore(
    subscribe,
    () => loaded,
    () => null,
  );
  return { Dialog };
}

/** The in-page search field `/` focuses. Pages mark theirs with `data-page-search`. */
export const PAGE_SEARCH_SELECTOR = '[data-page-search]';

/**
 * Shortcuts that pages register with their palette commands (`n` for New matter on the matters
 * list): listed in the `?` dialog under Actions, unless the registry already has those keys.
 */
function pageShortcuts(
  known: readonly ShortcutDefinition[],
  options: VisibleShortcutsOptions,
): ShortcutDefinition[] {
  const keys = new Set(known.map((shortcut) => shortcut.keys));
  return getCommands(options).flatMap((command) =>
    command.shortcut === undefined || command.labelKey === undefined || keys.has(command.shortcut)
      ? []
      : [
          {
            id: `page.${command.id}`,
            keys: command.shortcut,
            group: 'actions' as const,
            labelKey: command.labelKey,
          },
        ],
  );
}

export interface ShortcutsApi {
  /** Shortcuts this user can use (chords to hidden destinations are left out). */
  shortcuts: readonly ShortcutDefinition[];
  openHelp: () => void;
}

const ShortcutsContext = createContext<ShortcutsApi | null>(null);

export function useShortcuts(): ShortcutsApi {
  const api = useContext(ShortcutsContext);
  if (!api) throw new Error('useShortcuts must be used inside <ShortcutsProvider>');
  return api;
}

export interface ShortcutsProviderProps {
  slug: string;
  role: Role;
  isEnabled?: ((flag: FlagKey) => boolean) | undefined;
  children: ReactNode;
}

/**
 * The shell's keyboard shortcuts: `g` chords to destinations, `c` capture, `[` sidebar, `/` page
 * search, `Shift+N` notifications and `?` help, through one document listener. `mod+k` is listed
 * here but bound by the palette itself (use-command-palette.ts). Also adds the capture, sidebar,
 * notifications and help actions to the command palette with their key hints. Needs
 * `<CaptureProvider>` and `<SidebarProvider>` above.
 */
export function ShortcutsProvider({ slug, role, isEnabled, children }: ShortcutsProviderProps) {
  // Flag-gated chords follow the server-evaluated snapshot unless a caller overrides it.
  const fromFlags = useIsEnabled();
  const enabled = isEnabled ?? fromFlags;
  const router = useRouter();
  const sidebar = useSidebar();
  const capture = useCapture();
  const mac = useIsMac();
  const [helpOpen, setHelpOpen] = useState(false);
  const { Dialog } = useShortcutsDialog();
  const shortcuts = useMemo(() => visibleShortcuts({ role, isEnabled: enabled }), [role, enabled]);

  const openHelp = () => {
    void loadShortcutsDialog();
    setHelpOpen(true);
  };

  /** Runs a shortcut; false when it did nothing (so the browser keeps the key). */
  const run = (shortcut: ShortcutDefinition): boolean => {
    if (shortcut.navId !== undefined) {
      router.push(getNavItem(shortcut.navId).href(slug));
      return true;
    }
    switch (shortcut.action) {
      case 'capture':
        capture.openCapture();
        return true;
      case 'sidebar':
        sidebar.toggle();
        return true;
      case 'search': {
        const field = document.querySelector<HTMLElement>(PAGE_SEARCH_SELECTOR);
        field?.focus();
        return field !== null;
      }
      case 'notifications':
        openNotifications();
        return true;
      case 'help':
        void loadShortcutsDialog();
        setHelpOpen((open) => !open);
        return true;
      default:
        return false;
    }
  };

  // Handlers read the latest state without re-binding the listener or re-registering commands.
  const latest = useRef({ run, openHelp });
  useEffect(() => {
    latest.current = { run, openHelp };
  });

  useEffect(() => {
    const dispatch = createShortcutDispatcher(
      shortcuts.filter((shortcut) => shortcut.action !== 'palette'),
      { mac },
    );
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const shortcut = dispatch(event);
      if (shortcut && latest.current.run(shortcut)) event.preventDefault();
    };
    // On `window`, so it runs after every page-level `document` hotkey whatever order they bound
    // in (a streamed page hydrates after the shell): a page that claims a key, like `c` for the
    // board's carry list, calls `preventDefault` and the shell leaves it alone.
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [shortcuts, mac]);

  useEffect(() => {
    const perform = (action: ShortcutDefinition['action']) => () => {
      const shortcut = shortcuts.find((entry) => entry.action === action);
      if (shortcut) latest.current.run(shortcut);
    };
    const removers = [
      registerCommands('create', [
        {
          id: 'create.capture',
          labelKey: 'shortcuts.actions.capture',
          shortcut: actionKeys('capture'),
          perform: perform('capture'),
        },
      ]),
      registerCommands('goTo', [
        {
          id: 'notifications.open',
          labelKey: 'notifications.shortcut',
          keywords: ['notifications', 'bell', 'unread'],
          shortcut: actionKeys('notifications'),
          perform: perform('notifications'),
        },
      ]),
      registerCommands('settings', [
        {
          id: 'view.toggleSidebar',
          labelKey: 'shortcuts.actions.sidebar',
          shortcut: actionKeys('sidebar'),
          perform: perform('sidebar'),
        },
      ]),
      registerCommands('help', [
        {
          id: 'help.shortcuts',
          labelKey: 'shortcuts.actions.help',
          keywords: ['keyboard', 'hotkeys'],
          shortcut: actionKeys('help'),
          perform: () => {
            latest.current.openHelp();
          },
        },
      ]),
    ];
    return () => {
      for (const remove of removers) remove();
    };
  }, [shortcuts]);

  const api = useMemo<ShortcutsApi>(
    () => ({
      shortcuts,
      openHelp: () => {
        latest.current.openHelp();
      },
    }),
    [shortcuts],
  );

  return (
    <ShortcutsContext.Provider value={api}>
      {children}
      {Dialog ? (
        <Dialog
          open={helpOpen}
          onOpenChange={setHelpOpen}
          shortcuts={
            helpOpen
              ? [...shortcuts, ...pageShortcuts(shortcuts, { role, isEnabled: enabled })]
              : shortcuts
          }
        />
      ) : null}
    </ShortcutsContext.Provider>
  );
}
