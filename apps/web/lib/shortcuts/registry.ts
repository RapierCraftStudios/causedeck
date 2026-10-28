// The shell's keyboard shortcuts (#157): what they are, who sees them, and a single dispatcher that
// turns keydowns into shortcuts. provider.tsx runs the actions; the `?` dialog lists them.
import {
  CHORD_TIMEOUT_MS,
  isTypingTarget,
  parseHotkey,
  type HotkeyStep,
} from '@causedeck/ui/hooks';

import { can, type FlagKey, type Role } from '../workspace-context.ts';
import { getNavItem, isNavItemEnabled, type WorkspaceRoute } from '../nav.ts';

/** Dialog sections, in display order. Headings are `shortcuts.groups.<id>`. */
export const SHORTCUT_GROUPS = ['navigation', 'actions', 'help'] as const;

export type ShortcutGroupId = (typeof SHORTCUT_GROUPS)[number];

export type ShortcutAction =
  'capture' | 'palette' | 'sidebar' | 'search' | 'notifications' | 'help';

export interface ShortcutDefinition {
  id: string;
  /** `useHotkey` syntax: `c`, `mod+k`, `g then t`. */
  keys: string;
  group: ShortcutGroupId;
  /** Message key from the root of the catalog. Navigation rows read `shortcuts.goTo`. */
  labelKey: string;
  /** Navigation shortcuts go to this nav item. */
  navId?: WorkspaceRoute;
  action?: ShortcutAction;
}

/** The second key of each `g` chord. */
export const NAV_CHORDS: Partial<Record<WorkspaceRoute, string>> = {
  today: 't',
  inbox: 'i',
  matters: 'm',
  obligations: 'o',
  briefs: 'b',
  courts: 'c',
  activity: 'a',
  settings: 's',
};

/** `g then t` for a nav item with a chord. */
export function chordHint(navId: WorkspaceRoute): string | undefined {
  const key = NAV_CHORDS[navId];
  return key === undefined ? undefined : `g then ${key}`;
}

const action = (
  id: ShortcutAction,
  keys: string,
  group: ShortcutGroupId = 'actions',
  labelKey = `shortcuts.actions.${id}`,
): ShortcutDefinition => ({
  id: `action.${id}`,
  keys,
  group,
  labelKey,
  action: id,
});

export const SHORTCUTS: readonly ShortcutDefinition[] = [
  ...(Object.keys(NAV_CHORDS) as WorkspaceRoute[]).map((navId): ShortcutDefinition => ({
    id: `go.${navId}`,
    keys: chordHint(navId) as string,
    group: 'navigation',
    labelKey: getNavItem(navId).labelKey,
    navId,
  })),
  action('capture', 'c'),
  action('palette', 'mod+k'),
  action('sidebar', '['),
  action('search', '/'),
  // The bell's panel (#198); its label lives with the rest of the notifications copy.
  action('notifications', 'shift+n', 'actions', 'notifications.shortcut'),
  action('help', '?', 'help'),
];

/**
 * The drafting studio's keys (#827). The studio handles them itself while it is open and lists them
 * in the `?` sheet as palette commands; `[` and `mod+k` keep their shell meaning everywhere else.
 */
export const DRAFT_STUDIO_SHORTCUTS = [
  { id: 'draft.save', keys: 'mod+s', labelKey: 'drafting.shortcuts.save' },
  { id: 'draft.actions', keys: 'mod+k', labelKey: 'drafting.shortcuts.actions' },
  { id: 'draft.nextFinding', keys: ']', labelKey: 'drafting.shortcuts.nextFinding' },
  { id: 'draft.prevFinding', keys: '[', labelKey: 'drafting.shortcuts.prevFinding' },
  { id: 'draft.close', keys: 'esc', labelKey: 'drafting.shortcuts.close' },
] as const;

/** The keys of an action shortcut, e.g. `c` for capture. */
export function actionKeys(id: ShortcutAction): string {
  const found = SHORTCUTS.find((shortcut) => shortcut.action === id);
  if (!found) throw new Error(`Unknown shortcut action: ${id}`);
  return found.keys;
}

export interface VisibleShortcutsOptions {
  /** When given, chords to destinations the role cannot open are hidden. */
  role?: Role | undefined;
  isEnabled?: ((flag: FlagKey) => boolean) | undefined;
}

/** Shortcuts whose destination is visible to the role and not behind an off flag. */
export function visibleShortcuts(
  { role, isEnabled }: VisibleShortcutsOptions = {},
  source: readonly ShortcutDefinition[] = SHORTCUTS,
): ShortcutDefinition[] {
  return source.filter((shortcut) => {
    if (shortcut.navId === undefined) return true;
    const item = getNavItem(shortcut.navId);
    return (
      isNavItemEnabled(item, isEnabled) &&
      (role === undefined || item.requires === undefined || can(role, item.requires))
    );
  });
}

interface KeyEventLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  repeat?: boolean;
  isComposing?: boolean;
  target?: unknown;
}

const KEY_ALIASES: Record<string, string> = { esc: 'escape', spacebar: ' ' };

function matchesStep(step: HotkeyStep, event: KeyEventLike, mac: boolean): boolean {
  const key = event.key.toLowerCase();
  if ((KEY_ALIASES[key] ?? key) !== step.key) return false;
  const wantMeta = step.meta || (step.mod && mac);
  const wantCtrl = step.ctrl || (step.mod && !mac);
  // Shift is implied for symbols such as `?`, so it only has to match when it was asked for.
  if (step.shift && !event.shiftKey) return false;
  return event.metaKey === wantMeta && event.ctrlKey === wantCtrl && event.altKey === step.alt;
}

export interface ShortcutDispatcherOptions {
  mac: boolean;
  /** Clock for the chord window; tests use fake timers. */
  now?: () => number;
  timeoutMs?: number;
}

interface Entry {
  shortcut: ShortcutDefinition;
  steps: HotkeyStep[];
  hasModifier: boolean;
}

/**
 * One matcher for every shortcut, so a chord's second key is consumed: `g` then `c` goes to Courts
 * and never also opens capture. Feed it every keydown; it returns the shortcut to run, or null.
 * Plain keys and chords are ignored while typing in a field (and drop a pending `g`); a pending
 * chord expires after `timeoutMs`, after which the key counts on its own.
 */
export function createShortcutDispatcher(
  shortcuts: readonly ShortcutDefinition[],
  { mac, now = Date.now, timeoutMs = CHORD_TIMEOUT_MS }: ShortcutDispatcherOptions,
): (event: KeyEventLike) => ShortcutDefinition | null {
  const entries: Entry[] = shortcuts.map((shortcut) => ({
    shortcut,
    ...parseHotkey(shortcut.keys),
  }));
  let pending: Entry[] = [];
  let pendingAt = 0;

  return (event) => {
    if (event.repeat || event.isComposing) return null;
    const typing = isTypingTarget(event.target);
    const active = entries.filter((entry) => entry.hasModifier || !typing);

    const waiting = now() - pendingAt <= timeoutMs ? pending : [];
    pending = [];
    if (!typing) {
      const chord = waiting.find((entry) => {
        const second = entry.steps[1];
        return second !== undefined && matchesStep(second, event, mac);
      });
      if (chord) return chord.shortcut;
    }

    const single = active.find(
      (entry) => entry.steps.length === 1 && matchesStep(entry.steps[0] as HotkeyStep, event, mac),
    );
    if (single) return single.shortcut;

    pending = active.filter(
      (entry) => entry.steps.length === 2 && matchesStep(entry.steps[0] as HotkeyStep, event, mac),
    );
    pendingAt = now();
    return null;
  };
}
