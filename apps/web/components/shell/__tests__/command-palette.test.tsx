// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerCommands, resetCommands } from '../../../lib/commands/registry.ts';
import { testWorkspaceContext } from '../../../__tests__/helpers/workspace.ts';

import { mockMatchMedia, renderWithIntl, stubResizeObserver } from './helpers.tsx';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  usePathname: () => '/w/demo/today',
  useRouter: () => ({ push, refresh: vi.fn() }),
}));

const { AppShell } = await import('../app-shell.tsx');
const { loadCommandPalette } = await import('../use-command-palette.ts');
const { loadShellOverlays } = await import('../use-shell-overlays.ts');

const shellDir = path.join(import.meta.dirname, '..');

const context = testWorkspaceContext();

const renderShell = () =>
  renderWithIntl(
    <AppShell context={context} sidebarState="auto">
      <p>content</p>
    </AppShell>,
  );

const searchButton = () =>
  document.querySelector<HTMLElement>('[data-shell-search]') as HTMLElement;
const dialog = () => screen.queryByRole('dialog');
const input = () => screen.getByRole('combobox');
const groups = () =>
  [...document.querySelectorAll('[data-palette-group]')].map((group) =>
    group.getAttribute('data-palette-group'),
  );
const ctrlK = () => {
  fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
};
const type = (value: string) => {
  fireEvent.change(input(), { target: { value } });
};

beforeEach(async () => {
  mockMatchMedia();
  stubResizeObserver();
  Element.prototype.scrollIntoView = () => undefined;
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
  });
  // Tests drive the palette after its chunk has loaded, as it is at idle in the browser.
  await Promise.all([loadCommandPalette(), loadShellOverlays()]);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  resetCommands();
  push.mockReset();
});

describe('command palette', () => {
  it('opens and closes with Ctrl+K', async () => {
    renderShell();
    expect(dialog()).toBeNull();
    act(ctrlK);
    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(screen.getByText('↑↓ to move, ↵ to open, esc to close')).toBeTruthy();
    act(ctrlK);
    await waitFor(() => {
      expect(dialog()).toBeNull();
    });
  });

  it('opens from the topbar search button, traps focus in the search and returns it on Esc', async () => {
    renderShell();
    searchButton().focus();
    fireEvent.click(searchButton());
    await screen.findByRole('dialog');
    await waitFor(() => {
      expect(document.activeElement).toBe(input());
    });
    expect(input().getAttribute('placeholder')).toBe('Search or jump to...');
    fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' });
    await waitFor(() => {
      expect(dialog()).toBeNull();
    });
    expect(document.activeElement).toBe(searchButton());
  });

  it('lists every group and supports / (navigation) and > (commands) prefixes', async () => {
    registerCommands('create', [
      { id: 'create.matter', labelKey: 'nav.matters', perform: vi.fn() },
    ]);
    renderShell();
    act(ctrlK);
    await screen.findByRole('dialog');
    // The shell's shortcuts (#157) add capture, sidebar and help commands.
    expect(groups()).toEqual(['goTo', 'create', 'settings', 'help']);
    type('/');
    expect(groups()).toEqual(['goTo']);
    type('>');
    expect(groups()).toEqual(['create', 'settings', 'help']);
    type('zzzz');
    expect(screen.getByText('No matches. Try a matter name, court or action.')).toBeTruthy();
  });

  it('runs a command, navigates and shows it under Recent next time', async () => {
    renderShell();
    act(ctrlK);
    await screen.findByRole('dialog');
    type('matt');
    fireEvent.click(screen.getByRole('option', { name: /Matters/ }));
    expect(push).toHaveBeenCalledWith('/w/demo/matters');
    await waitFor(() => {
      expect(dialog()).toBeNull();
    });
    act(ctrlK);
    await screen.findByRole('dialog');
    expect(groups()[0]).toBe('recent');
    const recent = document.querySelector('[data-palette-group="recent"]');
    expect(recent?.textContent).toContain('Recent');
    expect(recent?.textContent).toContain('Matters');
  });

  it('shows commands another module registers while the palette is open', async () => {
    renderShell();
    act(ctrlK);
    await screen.findByRole('dialog');
    act(() => {
      registerCommands('help', [
        { id: 'help.shortcuts', labelKey: 'palette.groups.help', perform: vi.fn() },
      ]);
    });
    expect(groups()).toContain('help');
  });

  it('animates only with token durations, which are instant under prefers-reduced-motion', async () => {
    renderShell();
    act(ctrlK);
    const content = await screen.findByRole('dialog');
    const classes = content.className;
    expect(classes).toContain('data-[state=open]:duration-(--dur-base)');
    expect(classes).toContain('data-[state=closed]:duration-(--dur-exit)');
    expect(classes).not.toMatch(/duration-\d|\d+ms/);
    const motionCss = readFileSync(
      path.join(shellDir, '../../../../packages/ui/tokens/motion.css'),
      'utf8',
    );
    const reduce = motionCss.slice(motionCss.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reduce).toContain('--dur-base: 0.01ms');
    expect(reduce).toContain('--dur-exit: 0.01ms');
  });
});

describe('command palette code splitting', () => {
  const source = (file: string) => readFileSync(path.join(shellDir, file), 'utf8');
  const staticImport =
    /^import\s+(?!type\b)[^;]*?from\s+'(\.\/command-palette\.tsx|@causedeck\/ui\/command|cmdk)'/mu;

  it.each(['topbar.tsx', 'app-shell.tsx', 'use-command-palette.ts', 'sidebar.tsx'])(
    '%s never imports the palette or cmdk statically',
    (file) => {
      expect(source(file)).not.toMatch(staticImport);
    },
  );

  it('loads the palette with import()', () => {
    expect(source('use-command-palette.ts')).toContain("import('./command-palette.tsx')");
  });
});
