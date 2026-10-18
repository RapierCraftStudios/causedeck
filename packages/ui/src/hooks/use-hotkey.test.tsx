// @vitest-environment jsdom
import { act, render, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CHORD_TIMEOUT_MS,
  createHotkeyMatcher,
  formatHotkeyLabel,
  isMac,
  isTypingTarget,
  parseHotkey,
  useHotkey,
} from './use-hotkey';

const key = (
  k: string,
  mods: Partial<Record<'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey', boolean>> = {},
  target?: unknown,
) => ({
  key: k,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
  target,
});

describe('parseHotkey', () => {
  it('parses modifiers and chords', () => {
    expect(parseHotkey('mod+k')).toEqual({
      steps: [{ key: 'k', mod: true, ctrl: false, meta: false, alt: false, shift: false }],
      hasModifier: true,
    });
    const chord = parseHotkey('g then t');
    expect(chord.steps.map((s) => s.key)).toEqual(['g', 't']);
    expect(chord.hasModifier).toBe(false);
  });

  it('rejects an empty hotkey', () => {
    expect(() => parseHotkey('')).toThrow(TypeError);
  });
});

describe('createHotkeyMatcher', () => {
  it('matches mod+k against Meta on Mac and Ctrl elsewhere', () => {
    const mac = createHotkeyMatcher('mod+k', { mac: true });
    expect(mac(key('k', { metaKey: true }))).toBe(true);
    expect(mac(key('k', { ctrlKey: true }))).toBe(false);

    const pc = createHotkeyMatcher('mod+k', { mac: false });
    expect(pc(key('k', { ctrlKey: true }))).toBe(true);
    expect(pc(key('k', { metaKey: true }))).toBe(false);
    expect(pc(key('k'))).toBe(false);
  });

  it('completes `g then t` within the 1 s window', () => {
    let now = 0;
    const matches = createHotkeyMatcher('g then t', { mac: false, now: () => now });
    expect(matches(key('g'))).toBe(false);
    now += CHORD_TIMEOUT_MS - 1;
    expect(matches(key('t'))).toBe(true);
  });

  it('drops a chord whose second key comes after the window', () => {
    let now = 0;
    const matches = createHotkeyMatcher('g then t', { mac: false, now: () => now });
    matches(key('g'));
    now += CHORD_TIMEOUT_MS + 1;
    expect(matches(key('t'))).toBe(false);
  });

  it('restarts a chord on a wrong key, and a fresh `g` starts it again', () => {
    const matches = createHotkeyMatcher('g then t', { mac: false, now: () => 0 });
    matches(key('g'));
    expect(matches(key('x'))).toBe(false);
    expect(matches(key('t'))).toBe(false);
    matches(key('g'));
    matches(key('g'));
    expect(matches(key('t'))).toBe(true);
  });

  it('ignores plain-key hotkeys while typing but not modifier ones', () => {
    const input = document.createElement('input');
    const chord = createHotkeyMatcher('g then t', { mac: false, now: () => 0 });
    expect(chord(key('g', {}, input))).toBe(false);
    expect(chord(key('t', {}, input))).toBe(false);

    const slash = createHotkeyMatcher('/', { mac: false });
    expect(slash(key('/', {}, input))).toBe(false);
    expect(slash(key('/', {}, document.body))).toBe(true);

    const palette = createHotkeyMatcher('mod+k', { mac: false });
    expect(palette(key('k', { ctrlKey: true }, input))).toBe(true);
  });
});

describe('isTypingTarget', () => {
  it('detects text fields and contenteditable', () => {
    const editable = document.createElement('div');
    editable.contentEditable = 'true';
    Object.defineProperty(editable, 'isContentEditable', { value: true });
    expect(isTypingTarget(document.createElement('input'))).toBe(true);
    expect(isTypingTarget(document.createElement('textarea'))).toBe(true);
    expect(isTypingTarget(document.createElement('select'))).toBe(true);
    expect(isTypingTarget(editable)).toBe(true);
  });

  it('does not treat buttons, checkboxes or the body as typing', () => {
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    expect(isTypingTarget(checkbox)).toBe(false);
    expect(isTypingTarget(document.createElement('button'))).toBe(false);
    expect(isTypingTarget(document.body)).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});

describe('labels', () => {
  it('formats ⌘K on Mac and Ctrl+K elsewhere', () => {
    expect(formatHotkeyLabel('mod+k', true)).toBe('⌘K');
    expect(formatHotkeyLabel('mod+k', false)).toBe('Ctrl+K');
    expect(formatHotkeyLabel('mod+shift+p', true)).toBe('⇧⌘P');
    expect(formatHotkeyLabel('mod+shift+p', false)).toBe('Shift+Ctrl+P');
    expect(formatHotkeyLabel('esc', false)).toBe('Esc');
  });

  it('joins chords with a translatable word', () => {
    expect(formatHotkeyLabel('g then t', false)).toBe('G then T');
    expect(formatHotkeyLabel('g then t', true, { then: 'பின்' })).toBe('G பின் T');
  });

  it('detects Apple platforms', () => {
    expect(isMac({ platform: 'MacIntel' })).toBe(true);
    expect(isMac({ userAgentData: { platform: 'macOS' } })).toBe(true);
    expect(isMac({ platform: 'iPhone' })).toBe(true);
    expect(isMac({ platform: 'Win32' })).toBe(false);
    expect(isMac({ platform: 'Linux x86_64' })).toBe(false);
    expect(isMac(undefined)).toBe(false);
  });
});

describe('useHotkey', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const press = (k: string, init: KeyboardEventInit = {}, target: EventTarget = document.body) => {
    act(() => {
      target.dispatchEvent(
        new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }),
      );
    });
  };

  it('fires mod+k and returns the platform label', () => {
    const handler = vi.fn();
    const { result } = renderHook(() => useHotkey('mod+k', handler));
    expect(result.current).toBe('Ctrl+K'); // jsdom is not a Mac
    press('k', { ctrlKey: true });
    expect(handler).toHaveBeenCalledOnce();
  });

  it('fires `g then t` only within 1 s, using real keyboard events', () => {
    const handler = vi.fn();
    renderHook(() => useHotkey('g then t', handler));
    press('g');
    vi.advanceTimersByTime(900);
    press('t');
    expect(handler).toHaveBeenCalledOnce();

    press('g');
    vi.advanceTimersByTime(1100);
    press('t');
    expect(handler).toHaveBeenCalledOnce();
  });

  it('is suppressed while typing in an input, unless modifier-based', () => {
    const chord = vi.fn();
    const palette = vi.fn();
    const { getByRole } = render(<input aria-label="Search" />);
    renderHook(() => {
      useHotkey('g then t', chord);
      useHotkey('mod+k', palette);
    });
    const input = getByRole('textbox');
    press('g', {}, input);
    press('t', {}, input);
    press('k', { ctrlKey: true }, input);
    expect(chord).not.toHaveBeenCalled();
    expect(palette).toHaveBeenCalledOnce();
  });

  it('does nothing when disabled', () => {
    const handler = vi.fn();
    renderHook(() => useHotkey('mod+k', handler, { enabled: false }));
    press('k', { ctrlKey: true });
    expect(handler).not.toHaveBeenCalled();
  });
});
