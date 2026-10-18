// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SidebarState } from '../../../lib/sidebar-state.ts';
import { getWorkspaceContext, type WorkspaceContext } from '../../../lib/workspace-context.ts';

import { mockMatchMedia, nextFrame, renderWithIntl, stubResizeObserver } from './helpers.tsx';

vi.mock('next/navigation', () => ({
  usePathname: () => '/w/demo/today',
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const { AppShell } = await import('../app-shell.tsx');
const { useSidebar } = await import('../sidebar.tsx');

const context = (await getWorkspaceContext('demo')) as WorkspaceContext;

/** Drives the toggle API the way the `[` shortcut (#157) will, without moving focus. */
function ApiProbe() {
  const api = useSidebar();
  return (
    <>
      <button type="button" hidden data-probe="toggle" onClick={api.toggle} />
      <button
        type="button"
        hidden
        data-probe="expand"
        onClick={() => {
          api.setCollapsed(false);
        }}
      />
      <output hidden data-probe-collapsed={String(api.collapsed)} />
    </>
  );
}

const probe = (name: 'toggle' | 'expand') => {
  fireEvent.click(document.querySelector(`[data-probe="${name}"]`) as HTMLElement);
};
const probeCollapsed = () =>
  document.querySelector('[data-probe-collapsed]')?.getAttribute('data-probe-collapsed');

const renderShell = (sidebarState: SidebarState = 'auto') =>
  renderWithIntl(
    <AppShell context={context} sidebarState={sidebarState}>
      <ApiProbe />
      <p>content</p>
    </AppShell>,
  );

const shellRoot = () => document.querySelector<HTMLElement>('[data-shell]');

beforeEach(() => {
  mockMatchMedia();
  stubResizeObserver();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.cookie = 'sidebar=; path=/; max-age=0';
});

describe('app shell landmarks', () => {
  it('has a header, nav[aria-label=Primary] and exactly one main#main around the page', () => {
    renderShell();
    expect(screen.getByRole('banner').tagName).toBe('HEADER');
    expect(screen.getByRole('navigation', { name: 'Primary' })).toBeTruthy();
    const mains = document.querySelectorAll('main');
    expect(mains).toHaveLength(1);
    expect(mains[0]?.id).toBe('main');
    expect(mains[0]?.tabIndex).toBe(-1);
    expect(mains[0]?.dataset.workspaceSlug).toBe('demo');
    expect(mains[0]?.textContent).toBe('content');
  });

  it('shows the current workspace in the topbar on phones (switcher trigger)', () => {
    renderShell();
    const trigger = document.querySelector<HTMLElement>('[data-switcher-trigger="topbar"]');
    expect(trigger?.closest('.md\\:hidden')).toBeTruthy();
    expect(trigger?.querySelector('[data-current-workspace]')?.textContent).toBe('Demo Chambers');
  });

  it('renders the topbar search button and the user menu', () => {
    renderShell();
    expect(document.querySelector('[data-shell-search]')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Account menu: Asha Rao' })).toBeTruthy();
  });
});

describe('breadcrumbs', () => {
  it('show the workspace, then the current destination as the page', () => {
    renderShell();
    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(crumbs.querySelector('a')?.textContent).toBe('Demo Chambers');
    expect(crumbs.querySelector('a')?.getAttribute('href')).toBe('/w/demo/today');
    expect(crumbs.querySelector('[aria-current="page"]')?.textContent).toBe('Today');
  });
});

describe('sidebar widths', () => {
  it('is a 64 px rail at 768 px and 264 px from 1280 px without a cookie (auto)', () => {
    renderShell('auto');
    const root = shellRoot();
    expect(root?.dataset.sidebar).toBe('auto');
    expect(root?.className).toContain('md:[--sidebar-w:64px]');
    expect(root?.className).toContain('xl:[--sidebar-w:264px]');
    // Below 768 px the column is empty (the bottom nav is #158).
    expect(root?.className).toContain('[--sidebar-w:0px]');
  });

  it('paints the cookie choice on first render (no layout shift)', () => {
    renderShell('collapsed');
    expect(shellRoot()?.dataset.sidebar).toBe('collapsed');
    expect(shellRoot()?.className).toContain('md:[--sidebar-w:64px]');
    expect(shellRoot()?.className).not.toContain('264px');
    cleanup();
    renderShell('expanded');
    expect(shellRoot()?.className).toContain('md:[--sidebar-w:264px]');
    expect(shellRoot()?.className).not.toContain('[--sidebar-w:64px]');
  });

  it('animates grid-template-columns over 200 ms', () => {
    renderShell();
    const classes = shellRoot()?.className.split(' ') ?? [];
    expect(classes).toEqual(
      expect.arrayContaining([
        'md:grid',
        'md:grid-cols-[var(--sidebar-w)_minmax(0,1fr)]',
        'transition-[grid-template-columns]',
        'duration-200',
        'ease-standard',
        'motion-reduce:transition-none',
      ]),
    );
    expect(shellRoot()?.dataset.reducedMotion).toBeUndefined();
  });

  it('collapses instantly under prefers-reduced-motion', () => {
    mockMatchMedia({ '(prefers-reduced-motion: reduce)': true });
    renderShell();
    expect(shellRoot()?.dataset.reducedMotion).toBe('true');
    expect(shellRoot()?.className.split(' ')).toContain('transition-none');
  });

  it('scrolls the navigation independently', () => {
    renderShell();
    const scroll = document.querySelector<HTMLElement>('[data-sidebar-scroll]');
    expect(scroll?.className).toContain('overflow-y-auto');
    expect(scroll?.querySelector('nav')).toBeTruthy();
    expect(document.getElementById('shell-sidebar')?.className).toContain('h-dvh');
  });
});

describe('sidebar toggle', () => {
  it('the collapse button flips the rail and remembers the choice in a cookie', () => {
    mockMatchMedia({ '(min-width: 1280px)': true });
    renderShell('auto');
    const toggle = screen.getByRole('button', { name: 'Collapse sidebar' });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.getAttribute('aria-controls')).toBe('shell-sidebar');
    fireEvent.click(toggle);
    expect(shellRoot()?.dataset.sidebar).toBe('collapsed');
    expect(document.cookie).toContain('sidebar=collapsed');
    const expand = screen.getByRole('button', { name: 'Expand sidebar' });
    expect(expand.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(expand);
    expect(shellRoot()?.dataset.sidebar).toBe('expanded');
    expect(document.cookie).toContain('sidebar=expanded');
  });

  it('exposes a toggle API for the `[` shortcut', () => {
    renderShell('expanded');
    expect(probeCollapsed()).toBe('false');
    probe('toggle');
    expect(shellRoot()?.dataset.sidebar).toBe('collapsed');
    expect(probeCollapsed()).toBe('true');
    probe('expand');
    expect(shellRoot()?.dataset.sidebar).toBe('expanded');
  });

  it('keeps focus on the focused nav item when collapsing via the API', async () => {
    renderShell('expanded');
    const today = screen.getByRole('link', { name: 'Today' });
    today.focus();
    probe('toggle');
    await act(nextFrame);
    expect(document.activeElement).toBe(today);
    expect(shellRoot()?.dataset.sidebar).toBe('collapsed');
  });

  it('moves focus to the toggle when the focused element disappears on collapse', async () => {
    renderShell('expanded');
    const scroll = document.querySelector<HTMLElement>('[data-sidebar-scroll]');
    const transient = document.createElement('button');
    scroll?.append(transient);
    transient.focus();
    probe('toggle');
    transient.remove();
    await act(nextFrame);
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement?.hasAttribute('data-sidebar-toggle')).toBe(true);
  });

  it('throws when useSidebar is used outside the provider', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => renderWithIntl(<ApiProbe />)).toThrow(/SidebarProvider/);
  });
});
