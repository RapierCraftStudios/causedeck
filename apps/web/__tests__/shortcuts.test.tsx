// @vitest-environment jsdom
import { defaultSnapshot } from '@causedeck/flags/keys';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  mockMatchMedia,
  renderWithIntl,
  stubResizeObserver,
} from '../components/shell/__tests__/helpers.tsx';
import { getCommands, resetCommands } from '../lib/commands/registry.ts';
import { navigationCommands } from '../lib/commands/navigation-commands.ts';
import { getNavItem } from '../lib/nav.ts';
import {
  NAV_CHORDS,
  SHORTCUTS,
  createShortcutDispatcher,
  visibleShortcuts,
  type ShortcutDefinition,
} from '../lib/shortcuts/registry.ts';
import type { WorkspaceContext } from '../lib/workspace-context.ts';
import { testWorkspaceContext } from './helpers/workspace.ts';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  usePathname: () => '/w/demo/today',
  useRouter: () => ({ push, refresh: vi.fn() }),
}));

const { AppShell } = await import('../components/shell/app-shell.tsx');
const { loadCommandPalette } = await import('../components/shell/use-command-palette.ts');
const { loadShellOverlays } = await import('../components/shell/use-shell-overlays.ts');
const { loadShortcutsDialog } = await import('../lib/shortcuts/provider.tsx');

const owner = testWorkspaceContext();

interface Key {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  repeat?: boolean;
  target?: unknown;
}

const key = ({ key: name, ...rest }: Key) => ({
  key: name,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...rest,
});

const ids = (list: readonly (ShortcutDefinition | null)[]) =>
  list.map((entry) => (entry === null ? null : entry.id));

describe('shortcut dispatcher (fake timers)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const dispatcher = () => createShortcutDispatcher(SHORTCUTS, { mac: false });

  it('completes a chord within the 1 s window', () => {
    const dispatch = dispatcher();
    expect(dispatch(key({ key: 'g' }))).toBeNull();
    vi.advanceTimersByTime(1000);
    expect(dispatch(key({ key: 't' }))?.id).toBe('go.today');
  });

  it('drops the chord after 1 s, and the second key counts on its own', () => {
    const dispatch = dispatcher();
    dispatch(key({ key: 'g' }));
    vi.advanceTimersByTime(1001);
    expect(dispatch(key({ key: 't' }))).toBeNull();
    dispatch(key({ key: 'g' }));
    vi.advanceTimersByTime(1001);
    expect(dispatch(key({ key: 'c' }))?.id).toBe('action.capture');
  });

  it('maps every g chord to its destination and consumes the second key (g c is Courts, not capture)', () => {
    const dispatch = dispatcher();
    for (const [navId, second] of Object.entries(NAV_CHORDS)) {
      dispatch(key({ key: 'g' }));
      expect(dispatch(key({ key: second }))?.navId).toBe(navId);
    }
    expect(Object.keys(NAV_CHORDS).sort()).toEqual(
      [
        'activity',
        'briefs',
        'courts',
        'inbox',
        'matters',
        'obligations',
        'settings',
        'today',
      ].sort(),
    );
  });

  it.each([
    ['an input', { tagName: 'INPUT', type: 'text' }],
    ['a search input', { tagName: 'INPUT', type: 'search' }],
    ['a textarea', { tagName: 'TEXTAREA' }],
    ['a contenteditable region', { tagName: 'DIV', isContentEditable: true }],
  ])('is suppressed while typing in %s', (_name, target) => {
    const dispatch = dispatcher();
    expect(dispatch(key({ key: 'g', target }))).toBeNull();
    expect(dispatch(key({ key: 't', target }))).toBeNull();
    for (const single of ['c', '[', '/', '?']) {
      expect(dispatch(key({ key: single, target }))).toBeNull();
    }
  });

  it('drops a pending g when the user starts typing', () => {
    const dispatch = dispatcher();
    dispatch(key({ key: 'g' }));
    expect(dispatch(key({ key: 't', target: { tagName: 'TEXTAREA' } }))).toBeNull();
    expect(dispatch(key({ key: 't' }))).toBeNull();
  });

  it('still matches mod+k in a field, ignores key repeat and modified plain keys', () => {
    const dispatch = dispatcher();
    expect(dispatch(key({ key: 'k', ctrlKey: true, target: { tagName: 'INPUT' } }))?.id).toBe(
      'action.palette',
    );
    expect(dispatch(key({ key: 'c', repeat: true }))).toBeNull();
    expect(dispatch(key({ key: 'c', ctrlKey: true }))).toBeNull();
    expect(dispatch(key({ key: '?', shiftKey: true }))?.id).toBe('action.help');
    expect(dispatch(key({ key: '[' }))?.id).toBe('action.sidebar');
    expect(dispatch(key({ key: '/' }))?.id).toBe('action.search');
  });

  it('matches mod as Meta on Apple platforms', () => {
    const dispatch = createShortcutDispatcher(SHORTCUTS, { mac: true });
    expect(ids([dispatch(key({ key: 'k', ctrlKey: true }))])).toEqual([null]);
    expect(dispatch(key({ key: 'k', metaKey: true }))?.id).toBe('action.palette');
  });
});

describe('visible shortcuts', () => {
  it('hide chords to destinations the role cannot open', () => {
    expect(ids(visibleShortcuts({ role: 'owner' }))).toContain('go.settings');
    expect(ids(visibleShortcuts({ role: 'viewer' }))).not.toContain('go.settings');
    expect(ids(visibleShortcuts({ role: 'viewer' }))).toContain('go.today');
  });

  it('give every chorded navigation command its hint for the palette', () => {
    const hints = Object.fromEntries(
      navigationCommands().map((command) => [command.id, command.shortcut]),
    );
    expect(hints['go.today']).toBe('g then t');
    expect(hints['go.courts']).toBe('g then c');
    expect(hints['go.settings']).toBe('g then s');
    expect(hints['go.drafts']).toBeUndefined();
  });
});

describe('shortcuts in the app shell', () => {
  const renderShell = (context: WorkspaceContext = owner) =>
    renderWithIntl(
      <AppShell context={context} sidebarState="expanded" flags={defaultSnapshot()}>
        <input aria-label="Note" data-testid="field" />
        <div data-testid="editable" contentEditable suppressContentEditableWarning>
          text
        </div>
        <p>content</p>
      </AppShell>,
    );
  const press = (init: Key, target: Element | Document = document) => {
    act(() => {
      fireEvent.keyDown(target, key(init));
    });
  };
  const shellRoot = () => document.querySelector<HTMLElement>('[data-shell]');
  const captureOpen = () =>
    document.querySelector('[data-capture-trigger]')?.getAttribute('aria-expanded');

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    mockMatchMedia();
    stubResizeObserver();
    Element.prototype.scrollIntoView = () => undefined;
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (name: string) => store.get(name) ?? null,
      setItem: (name: string, value: string) => store.set(name, value),
    });
    await Promise.all([loadCommandPalette(), loadShellOverlays(), loadShortcutsDialog()]);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    resetCommands();
    push.mockReset();
    document.cookie = 'sidebar=; path=/; max-age=0';
  });

  it('g then t goes to Today within 1 s, not after', () => {
    renderShell();
    press({ key: 'g' });
    vi.advanceTimersByTime(999);
    press({ key: 't' });
    expect(push).toHaveBeenCalledWith(getNavItem('today').href('demo'));
    push.mockReset();
    press({ key: 'g' });
    vi.advanceTimersByTime(1001);
    press({ key: 'i' });
    expect(push).not.toHaveBeenCalled();
  });

  it('g then c goes to Courts and does not open capture', () => {
    renderShell();
    press({ key: 'g' });
    press({ key: 'c' });
    expect(push).toHaveBeenCalledWith('/w/demo/courts');
    expect(captureOpen()).toBe('false');
  });

  it('is suppressed while typing in an input or a contenteditable region', () => {
    renderShell();
    const field = screen.getByTestId('field');
    press({ key: 'g' }, field);
    press({ key: 't' }, field);
    press({ key: 'c' }, field);
    const editable = screen.getByTestId('editable');
    // jsdom does not implement isContentEditable.
    Object.defineProperty(editable, 'isContentEditable', { value: true });
    press({ key: 'g' }, editable);
    press({ key: 'm' }, editable);
    press({ key: '[' }, editable);
    expect(push).not.toHaveBeenCalled();
    expect(captureOpen()).toBe('false');
    expect(shellRoot()?.dataset.sidebar).toBe('expanded');
  });

  it('[ toggles the sidebar', () => {
    renderShell();
    press({ key: '[' });
    expect(shellRoot()?.dataset.sidebar).toBe('collapsed');
    press({ key: '[' });
    expect(shellRoot()?.dataset.sidebar).toBe('expanded');
  });

  it('c opens capture', () => {
    renderShell();
    press({ key: 'c' });
    expect(captureOpen()).toBe('true');
  });

  it('lets a page hotkey that claims a key win, but g chords still reach the shell', () => {
    renderShell();
    const claimed: string[] = [];
    const claim = (event: KeyboardEvent) => {
      claimed.push(event.key);
      event.preventDefault();
    };
    document.addEventListener('keydown', claim);
    press({ key: 'c' });
    expect(claimed).toEqual(['c']);
    expect(captureOpen()).toBe('false');
    for (const [second, href] of [
      ['o', '/w/demo/obligations'],
      ['c', '/w/demo/courts'],
    ] as const) {
      claimed.length = 0;
      push.mockReset();
      press({ key: 'g' });
      press({ key: second });
      expect(push).toHaveBeenCalledWith(href);
      expect(claimed).toEqual(['g']);
    }
    document.removeEventListener('keydown', claim);
  });

  it('mod+k opens the palette (bound once, so it stays open)', async () => {
    renderShell();
    press({ key: 'k', ctrlKey: true });
    expect(await screen.findByRole('dialog', { name: 'Command palette' })).toBeTruthy();
  });

  it('/ focuses the in-page search when there is one, and is left alone otherwise', () => {
    renderShell();
    const event = new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true });
    act(() => {
      document.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(false);
    cleanup();
    renderWithIntl(
      <AppShell context={owner} sidebarState="expanded" flags={defaultSnapshot()}>
        <input aria-label="Search matters" data-page-search="" />
      </AppShell>,
    );
    press({ key: '/' });
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Search matters' }));
  });

  it('? opens a dialog listing every shortcut grouped by area', async () => {
    renderShell();
    press({ key: '?', shiftKey: true });
    const dialog = await screen.findByRole('dialog', { name: 'Keyboard shortcuts' });
    const groups = [...dialog.querySelectorAll('[data-slot="shortcuts-group"]')].map((group) =>
      group.getAttribute('aria-label'),
    );
    expect(groups).toEqual(['Navigation', 'Actions', 'Help']);
    const navigation = within(dialog.querySelector('[aria-label="Navigation"]') as HTMLElement);
    expect(navigation.getByText('Go to Today')).toBeTruthy();
    expect(navigation.getByText('Go to Settings')).toBeTruthy();
    // The shell registers `New matter` (`n`, matters list) with the palette: one page row on top.
    expect(dialog.querySelectorAll('[data-slot="shortcut"]')).toHaveLength(SHORTCUTS.length + 1);
    const actions = within(dialog.querySelector('[aria-label="Actions"]') as HTMLElement);
    expect(actions.getByText('New matter')).toBeTruthy();
    expect(within(dialog).getByText('Open command palette')).toBeTruthy();
    expect(within(dialog).getByText('Search this page')).toBeTruthy();
    expect(within(dialog).getByText('G then T')).toBeTruthy();
  });

  it('leaves New matter out of the dialog for a viewer, who cannot write matters', async () => {
    renderShell({ ...owner, role: 'viewer' });
    press({ key: '?', shiftKey: true });
    const dialog = await screen.findByRole('dialog', { name: 'Keyboard shortcuts' });
    expect(dialog.querySelectorAll('[data-slot="shortcut"]').length).toBeLessThanOrEqual(
      SHORTCUTS.length,
    );
    expect(within(dialog).queryByText('New matter')).toBeNull();
  });

  it('leaves out g s for a viewer, who cannot open Settings', async () => {
    renderShell({ ...owner, role: 'viewer' });
    press({ key: 'g' });
    press({ key: 's' });
    expect(push).not.toHaveBeenCalled();
    press({ key: '?', shiftKey: true });
    const dialog = await screen.findByRole('dialog', { name: 'Keyboard shortcuts' });
    expect(within(dialog).queryByText('Go to Settings')).toBeNull();
  });

  it('adds capture, sidebar and help to the palette with their key hints', async () => {
    renderShell();
    const hints = Object.fromEntries(
      getCommands({ role: 'owner' }).map((command) => [command.id, command.shortcut]),
    );
    expect(hints).toMatchObject({
      'create.capture': 'c',
      'view.toggleSidebar': '[',
      'help.shortcuts': '?',
      'go.today': 'g then t',
    });
    press({ key: 'k', ctrlKey: true });
    await screen.findByRole('dialog', { name: 'Command palette' });
    fireEvent.click(screen.getByRole('option', { name: /Keyboard shortcuts/ }));
    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeTruthy();
    });
  });
});
