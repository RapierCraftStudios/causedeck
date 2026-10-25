// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Membership } from '../../../lib/workspace-context.ts';
import { testWorkspaceContext } from '../../../__tests__/helpers/workspace.ts';

import { mockMatchMedia, renderWithIntl, stubResizeObserver } from './helpers.tsx';

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({
  usePathname: () => '/w/demo/today',
  useRouter: () => router,
}));

const {
  WorkspaceSwitcher,
  clearClientCaches,
  filterMemberships,
  registerClientCache,
  workspaceTone,
} = await import('../workspace-switcher.tsx');
const { SidebarProvider } = await import('../sidebar-collapse.tsx');
const { loadShellOverlays } = await import('../use-shell-overlays.ts');

const context = testWorkspaceContext();

const renderSwitcher = (variant: 'sidebar' | 'topbar' = 'sidebar') =>
  renderWithIntl(
    <SidebarProvider initialState="expanded">
      <WorkspaceSwitcher
        current={context.workspace}
        memberships={context.memberships}
        variant={variant}
      />
    </SidebarProvider>,
  );

const open = (variant: 'sidebar' | 'topbar' = 'sidebar') => {
  const trigger = document.querySelector<HTMLElement>(`[data-switcher-trigger="${variant}"]`);
  if (!trigger) throw new Error('no trigger');
  fireEvent.click(trigger);
  return screen.getByRole('combobox', { name: 'Find a workspace' });
};

const options = () => screen.queryAllByRole('option');

beforeEach(async () => {
  mockMatchMedia();
  stubResizeObserver();
  router.push.mockReset();
  router.refresh.mockReset();
  await loadShellOverlays();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('workspace switcher', () => {
  it('is a button announcing the current workspace that opens the membership list', () => {
    renderSwitcher();
    const trigger = screen.getByRole('button', { name: 'Switch workspace: Demo Chambers' });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    open();
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('listbox', { name: 'Workspaces' })).toBeTruthy();
  });

  it("lists only the user's memberships, each with its role badge, and checks the current one", () => {
    renderSwitcher();
    open();
    expect(options().map((option) => option.dataset.slug)).toEqual(['demo', 'clerk-desk']);
    expect(document.body.textContent).not.toContain('Other Chambers');
    const [demo, clerk] = options();
    expect(demo?.querySelector('[data-role]')?.textContent).toBe('Owner');
    expect(clerk?.querySelector('[data-role]')?.textContent).toBe('Clerk');
    expect(demo?.getAttribute('aria-current')).toBe('true');
    expect(screen.getByLabelText('Current workspace')).toBeTruthy();
  });

  it('filters as you type, and says so when nothing matches', () => {
    renderSwitcher();
    const input = open();
    fireEvent.change(input, { target: { value: 'CLERK' } });
    expect(options().map((option) => option.dataset.slug)).toEqual(['clerk-desk']);
    fireEvent.change(input, { target: { value: 'nothing here' } });
    expect(options()).toHaveLength(0);
    expect(screen.getByRole('status').textContent).toBe('No workspaces match.');
  });

  it('moves with the arrow keys (aria-activedescendant) and switches on Enter', () => {
    const cleared = vi.fn();
    const unregister = registerClientCache(cleared);
    renderSwitcher();
    const input = open();
    const [demo, clerk] = options();
    expect(input.getAttribute('aria-activedescendant')).toBe(demo?.id);
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input.getAttribute('aria-activedescendant')).toBe(clerk?.id);
    expect(clerk?.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input.getAttribute('aria-activedescendant')).toBe(demo?.id);
    fireEvent.keyDown(input, { key: 'End' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(cleared).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledWith('/w/clerk-desk/today');
    expect(router.refresh).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status').textContent).toBe('Switching workspace');
    unregister();
  });

  it('switches on click and clears caches before navigating', () => {
    const order: string[] = [];
    const unregister = registerClientCache(() => order.push('clear'));
    router.push.mockImplementation(() => order.push('push'));
    renderSwitcher();
    open();
    fireEvent.click(options()[1] as HTMLElement);
    expect(order).toEqual(['clear', 'push']);
    unregister();
  });

  it('just closes when the current workspace is chosen', () => {
    renderSwitcher();
    const input = open();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(router.push).not.toHaveBeenCalled();
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('links Create workspace to /onboarding and closes; join stays disabled (#180)', () => {
    renderSwitcher();
    open();
    const create = screen.getByRole('link', { name: 'Create workspace' });
    expect(create.getAttribute('href')).toBe('/onboarding');
    expect(screen.queryByRole('button', { name: 'Create workspace' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Join with invite' }).hasAttribute('disabled')).toBe(
      true,
    );
    fireEvent.click(create);
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('shows the workspace name in the topbar variant', () => {
    renderSwitcher('topbar');
    expect(document.querySelector('[data-current-workspace]')?.textContent).toBe('Demo Chambers');
    open('topbar');
    expect(options()).toHaveLength(2);
  });
});

describe('switcher helpers', () => {
  const memberships: Membership[] = [
    { workspace: { id: '1', slug: 'demo', name: 'Demo Chambers' }, role: 'owner' },
    { workspace: { id: '2', slug: 'madurai', name: 'மதுரை Bench' }, role: 'junior' },
  ];

  it('filters case- and width-insensitively on name and slug', () => {
    expect(filterMemberships(memberships, '').map((m) => m.workspace.slug)).toEqual([
      'demo',
      'madurai',
    ]);
    expect(filterMemberships(memberships, ' ＤＥＭＯ ').map((m) => m.workspace.slug)).toEqual([
      'demo',
    ]);
    expect(filterMemberships(memberships, 'மதுரை').map((m) => m.workspace.slug)).toEqual([
      'madurai',
    ]);
    expect(filterMemberships(memberships, 'madu').map((m) => m.workspace.slug)).toEqual([
      'madurai',
    ]);
  });

  it('derives a stable token tone from the slug', () => {
    expect(workspaceTone('demo')).toBe(workspaceTone('demo'));
    expect(workspaceTone('demo')).toMatch(/^bg-[a-z-]+-soft text-[a-z-]+$/);
  });

  it('runs every registered cache clearer until unregistered', () => {
    const a = vi.fn();
    const b = vi.fn();
    const offA = registerClientCache(a);
    const offB = registerClientCache(b);
    act(() => {
      clearClientCaches();
    });
    offA();
    clearClientCaches();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(2);
    offB();
  });
});
