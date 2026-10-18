// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getWorkspaceContext,
  type Role,
  type WorkspaceContext,
} from '../../../lib/workspace-context.ts';

import { mockMatchMedia, nextFrame, renderWithIntl, stubResizeObserver } from './helpers.tsx';

const nav = vi.hoisted(() => ({ pathname: '/w/demo/inbox' }));
vi.mock('next/navigation', () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const { SidebarProvider } = await import('../sidebar-collapse.tsx');
const { Sidebar } = await import('../sidebar.tsx');
const { SidebarNav, isNavItemActive } = await import('../sidebar-nav.tsx');
const { loadShellOverlays } = await import('../use-shell-overlays.ts');
const { getNavItem } = await import('../../../lib/nav.ts');

const renderNav = (role: Role = 'owner', state: 'collapsed' | 'expanded' = 'expanded') =>
  renderWithIntl(
    <SidebarProvider initialState={state}>
      <SidebarNav slug="demo" role={role} />
    </SidebarProvider>,
  );

const links = () => [...document.querySelectorAll<HTMLAnchorElement>('a[data-nav-item]')];

beforeEach(() => {
  nav.pathname = '/w/demo/inbox';
  mockMatchMedia();
  stubResizeObserver();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// Runs first: the overlay chunk is module state, loaded once per test file.
describe('before the overlay chunk loads', () => {
  it('renders a static indicator, then the animated one, keeping focus on the swapped link', async () => {
    renderNav();
    const inbox = screen.getByRole('link', { name: 'Inbox' });
    expect(
      inbox.querySelector('[data-active-indicator]')?.getAttribute('data-active-indicator'),
    ).toBe('static');
    inbox.focus();
    await act(async () => {
      await loadShellOverlays();
    });
    await act(nextFrame);
    const swapped = screen.getByRole('link', { name: 'Inbox' });
    expect(
      swapped.querySelector('[data-active-indicator]')?.getAttribute('data-active-indicator'),
    ).toBe('animated');
    expect(document.activeElement).toBe(swapped);
  });
});

describe('sidebar navigation', () => {
  it('marks only the current route with aria-current=page and the 2 px accent bar', () => {
    renderNav();
    const inbox = screen.getByRole('link', { name: 'Inbox' });
    expect(inbox.getAttribute('aria-current')).toBe('page');
    expect(inbox.className).toContain('bg-accent-soft');
    const bar = inbox.querySelector<HTMLElement>('[data-active-indicator]');
    expect(bar?.className).toContain('w-0.5');
    expect(bar?.className).toContain('bg-accent');
    expect(document.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
    expect(document.querySelectorAll('[data-active-indicator]')).toHaveLength(1);
  });

  it('treats every settings section as Settings', () => {
    expect(isNavItemActive(getNavItem('settings'), 'demo', '/w/demo/settings/profile')).toBe(true);
    expect(isNavItemActive(getNavItem('today'), 'demo', '/w/demo/tomorrow')).toBe(false);
    expect(isNavItemActive(getNavItem('today'), 'demo', '/w/other/today')).toBe(false);
  });

  it('links every item into the current workspace', () => {
    renderNav();
    expect(screen.getByRole('link', { name: 'Today' }).getAttribute('href')).toBe('/w/demo/today');
    expect(screen.getByRole('link', { name: 'Settings' }).getAttribute('href')).toBe(
      '/w/demo/settings/profile',
    );
  });

  it('has count badge slots (stubbed empty) for Inbox and Obligations only', () => {
    renderNav();
    const badges = [...document.querySelectorAll<HTMLElement>('[data-badge]')];
    expect(badges.map((badge) => badge.dataset.badge)).toEqual(['inbox', 'obligations']);
    for (const badge of badges) expect(badge.textContent).toBe('');
  });

  it('hides items the role may not see and flagged items', () => {
    renderNav('clerk');
    const ids = links().map((link) => link.dataset.navItem);
    expect(ids).not.toContain('billing');
    expect(ids).not.toContain('insights');
    expect(ids).not.toContain('invoices');
    expect(ids).not.toContain('limitation');
    expect(ids).toContain('settings');
  });

  it('uses a roving tabindex: one tab stop, arrows, Home and End move focus', () => {
    renderNav();
    const all = links();
    expect(all.filter((link) => link.tabIndex === 0).map((link) => link.dataset.navItem)).toEqual([
      'inbox',
    ]);
    const inbox = screen.getByRole('link', { name: 'Inbox' });
    inbox.focus();
    fireEvent.keyDown(inbox, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Matters' }));
    expect(screen.getByRole('link', { name: 'Matters' }).tabIndex).toBe(0);
    expect(inbox.tabIndex).toBe(-1);
    fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(inbox);
    fireEvent.keyDown(inbox, { key: 'End' });
    expect(document.activeElement).toBe(all.at(-1));
    fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(all[0]);
    fireEvent.keyDown(document.activeElement as Element, { key: 'Home' });
    expect(document.activeElement).toBe(all[0]);
  });

  it('labels the landmark Primary and keeps labels for screen readers in the rail', () => {
    renderNav('owner', 'collapsed');
    expect(screen.getByRole('navigation', { name: 'Primary' })).toBeTruthy();
    const label = screen.getByRole('link', { name: 'Inbox' }).querySelector('span.min-w-0');
    expect(label?.className).toContain('group-data-[sidebar=collapsed]/shell:sr-only');
  });

  it('wraps rail items in tooltips showing the label', () => {
    renderNav('owner', 'collapsed');
    const inbox = screen.getByRole('link', { name: 'Inbox' });
    // Radix TooltipTrigger stamps its state on the link.
    expect(inbox.getAttribute('data-state')).toBe('closed');
    act(() => {
      inbox.focus();
    });
    expect(screen.getByRole('tooltip').textContent).toBe('Inbox');
  });

  it('never shows tooltips when the sidebar is expanded', () => {
    renderNav('owner', 'expanded');
    act(() => {
      screen.getByRole('link', { name: 'Inbox' }).focus();
    });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
});

describe('sidebar', () => {
  it('shows the wordmark, the user with role and sync state', async () => {
    const context = (await getWorkspaceContext('demo')) as WorkspaceContext;
    renderWithIntl(
      <SidebarProvider initialState="expanded">
        <Sidebar context={context} />
      </SidebarProvider>,
    );
    const aside = document.getElementById('shell-sidebar');
    expect(aside?.textContent).toContain('CauseDeck');
    expect(aside?.textContent).toContain('Asha Rao');
    expect(aside?.textContent).toContain('Owner');
    expect(aside?.querySelector('[data-sync]')?.getAttribute('data-sync')).toBe('synced');
  });
});
