import { useEffect, useRef, useSyncExternalStore } from 'react';

/** A chord such as `g then t` must be completed within this window. */
export const CHORD_TIMEOUT_MS = 1000;

/** One key press of a hotkey. `mod` is Cmd on Apple platforms and Ctrl elsewhere. */
export interface HotkeyStep {
  key: string;
  mod: boolean;
  ctrl: boolean;
  meta: boolean;
  alt: boolean;
  shift: boolean;
}

export interface ParsedHotkey {
  steps: HotkeyStep[];
  /** Modifier-based hotkeys stay active while the user is typing in a field. */
  hasModifier: boolean;
}

const KEY_ALIASES: Record<string, string> = {
  esc: 'escape',
  space: ' ',
  up: 'arrowup',
  down: 'arrowdown',
  left: 'arrowleft',
  right: 'arrowright',
  return: 'enter',
  cmd: 'meta',
  command: 'meta',
  option: 'alt',
  control: 'ctrl',
};

const normaliseKey = (key: string): string => {
  const lower = key.toLowerCase();
  return KEY_ALIASES[lower] ?? lower;
};

/** Parse `mod+k`, `shift+?`, or a chord such as `g then t`. */
export function parseHotkey(combo: string): ParsedHotkey {
  const steps = combo
    .trim()
    .split(/\s+then\s+/i)
    .map((part): HotkeyStep => {
      const tokens = part
        .split('+')
        .map((token) => token.trim())
        .filter(Boolean)
        .map(normaliseKey);
      const key = tokens.at(-1);
      if (!key) throw new TypeError(`Invalid hotkey: "${combo}"`);
      const modifiers = new Set(tokens.slice(0, -1));
      return {
        key,
        mod: modifiers.has('mod'),
        ctrl: modifiers.has('ctrl'),
        meta: modifiers.has('meta'),
        alt: modifiers.has('alt'),
        shift: modifiers.has('shift'),
      };
    });
  const hasModifier = steps.some((step) => step.mod || step.ctrl || step.meta || step.alt);
  return { steps, hasModifier };
}

interface NavigatorLike {
  platform?: string;
  userAgent?: string;
  userAgentData?: { platform?: string };
}

/** Apple platforms label `mod` as ⌘ and match it against the Meta key. */
export function isMac(nav?: NavigatorLike): boolean {
  const source: NavigatorLike | undefined =
    nav ?? (typeof navigator === 'undefined' ? undefined : navigator);
  const platform = source?.userAgentData?.platform ?? source?.platform ?? source?.userAgent ?? '';
  return /mac|iphone|ipad|ipod/i.test(platform);
}

interface KeyboardEventLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

function matchesStep(step: HotkeyStep, event: KeyboardEventLike, mac: boolean): boolean {
  if (normaliseKey(event.key) !== step.key) return false;
  const wantMeta = step.meta || (step.mod && mac);
  const wantCtrl = step.ctrl || (step.mod && !mac);
  // Shift is implied for symbols such as `?`, so it only has to match when it was asked for.
  if (step.shift && !event.shiftKey) return false;
  return event.metaKey === wantMeta && event.ctrlKey === wantCtrl && event.altKey === step.alt;
}

interface TargetLike {
  tagName?: string;
  type?: string;
  isContentEditable?: boolean;
}

const NON_TEXT_INPUTS = new Set([
  'button',
  'checkbox',
  'color',
  'file',
  'image',
  'radio',
  'range',
  'reset',
  'submit',
]);

/** True for elements that take text: inputs, textareas, selects and contenteditable regions. */
export function isTypingTarget(target: unknown): boolean {
  if (!target || typeof target !== 'object') return false;
  const element = target as TargetLike;
  if (element.isContentEditable) return true;
  const tag = element.tagName?.toLowerCase();
  if (tag === 'textarea' || tag === 'select') return true;
  if (tag === 'input') return !NON_TEXT_INPUTS.has((element.type ?? 'text').toLowerCase());
  return false;
}

export interface HotkeyMatcherOptions {
  mac: boolean;
  /** Clock for the chord window; tests pass fake timers' `Date.now`. */
  now?: () => number;
  timeoutMs?: number;
}

/**
 * Stateful matcher: feed it every keydown and it returns true when the whole hotkey (or the last
 * step of a chord pressed within the window) has been typed.
 */
export function createHotkeyMatcher(
  hotkey: string | ParsedHotkey,
  { mac, now = Date.now, timeoutMs = CHORD_TIMEOUT_MS }: HotkeyMatcherOptions,
): (event: KeyboardEventLike & { target?: unknown }) => boolean {
  const parsed = typeof hotkey === 'string' ? parseHotkey(hotkey) : hotkey;
  let index = 0;
  let lastAt = 0;

  return (event) => {
    if (!parsed.hasModifier && isTypingTarget(event.target)) {
      index = 0;
      return false;
    }
    if (index > 0 && now() - lastAt > timeoutMs) index = 0;

    const step = parsed.steps[index];
    if (step && matchesStep(step, event, mac)) {
      index += 1;
      lastAt = now();
    } else {
      const first = parsed.steps[0];
      index = first && matchesStep(first, event, mac) ? 1 : 0;
      lastAt = now();
    }

    if (index === parsed.steps.length) {
      index = 0;
      return true;
    }
    return false;
  };
}

const MAC_SYMBOLS = { mod: '⌘', meta: '⌘', ctrl: '⌃', alt: '⌥', shift: '⇧' } as const;
const PC_NAMES = { mod: 'Ctrl', meta: 'Win', ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift' } as const;
const KEY_LABELS: Record<string, string> = {
  ' ': 'Space',
  escape: 'Esc',
  enter: '↵',
  arrowup: '↑',
  arrowdown: '↓',
  arrowleft: '←',
  arrowright: '→',
  backspace: '⌫',
  tab: 'Tab',
};

export interface HotkeyLabels {
  /** Joins chord steps: `G then T`. */
  then: string;
}

export const DEFAULT_HOTKEY_LABELS: HotkeyLabels = { then: 'then' };

const keyLabel = (key: string): string =>
  KEY_LABELS[key] ??
  (key.length === 1 ? key.toUpperCase() : key.charAt(0).toUpperCase() + key.slice(1));

/** Human label: `⌘K` on Apple platforms, `Ctrl+K` elsewhere, `G then T` for chords. */
export function formatHotkeyLabel(
  hotkey: string | ParsedHotkey,
  mac: boolean,
  labels: HotkeyLabels = DEFAULT_HOTKEY_LABELS,
): string {
  const parsed = typeof hotkey === 'string' ? parseHotkey(hotkey) : hotkey;
  return parsed.steps
    .map((step) => {
      const modifiers = (['ctrl', 'alt', 'shift', 'mod', 'meta'] as const).filter((m) => step[m]);
      const key = keyLabel(step.key);
      if (mac) return modifiers.map((m) => MAC_SYMBOLS[m]).join('') + key;
      return [...modifiers.map((m) => PC_NAMES[m]), key].join('+');
    })
    .join(` ${labels.then} `);
}

const noopSubscribe = () => () => undefined;

/** `isMac()` as a hook that renders the non-Mac label on the server and hydrates to the real one. */
export function useIsMac(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => isMac(),
    () => false,
  );
}

export interface UseHotkeyOptions {
  enabled?: boolean;
  /** Defaults to true: stop the browser handling the key (e.g. `mod+k` focusing the URL bar). */
  preventDefault?: boolean;
  labels?: HotkeyLabels;
}

/**
 * Run `handler` when `hotkey` is pressed anywhere in the document. Plain-key hotkeys and chords
 * are ignored while typing in a field; modifier-based ones (`mod+k`) still fire. Returns the
 * platform-aware label for display in a `Kbd`.
 */
export function useHotkey(
  hotkey: string,
  handler: (event: KeyboardEvent) => void,
  { enabled = true, preventDefault = true, labels = DEFAULT_HOTKEY_LABELS }: UseHotkeyOptions = {},
): string {
  const mac = useIsMac();
  const handlerRef = useRef(handler);

  useEffect(() => {
    handlerRef.current = handler;
  });

  useEffect(() => {
    if (!enabled) return undefined;
    const matches = createHotkeyMatcher(hotkey, { mac });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || !matches(event)) return;
      if (preventDefault) event.preventDefault();
      handlerRef.current(event);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [hotkey, enabled, preventDefault, mac]);

  return formatHotkeyLabel(hotkey, mac, labels);
}
