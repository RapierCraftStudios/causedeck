// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';

import {
  SIDEBAR_COOKIE,
  SIDEBAR_EXPANDED_QUERY,
  isSidebarCollapsed,
  nextSidebarState,
  parseSidebarCookie,
  persistSidebarCookie,
} from '../../../lib/sidebar-state.ts';

afterEach(() => {
  document.cookie = `${SIDEBAR_COOKIE}=; path=/; max-age=0`;
});

describe('sidebar state', () => {
  it('reads an explicit cookie choice and falls back to auto', () => {
    expect(parseSidebarCookie('expanded')).toBe('expanded');
    expect(parseSidebarCookie('collapsed')).toBe('collapsed');
    expect(parseSidebarCookie(undefined)).toBe('auto');
    expect(parseSidebarCookie('sideways')).toBe('auto');
  });

  it('persists the choice in a year-long, site-wide cookie', () => {
    persistSidebarCookie('collapsed');
    expect(document.cookie).toContain('sidebar=collapsed');
  });

  it('is the rail at 768 px and expanded at 1280 px+ under auto', () => {
    expect(SIDEBAR_EXPANDED_QUERY).toBe('(min-width: 1280px)');
    expect(isSidebarCollapsed('auto', false)).toBe(true);
    expect(isSidebarCollapsed('auto', true)).toBe(false);
    expect(isSidebarCollapsed('collapsed', true)).toBe(true);
    expect(isSidebarCollapsed('expanded', false)).toBe(false);
  });

  it('toggles to the opposite of what is shown', () => {
    expect(nextSidebarState('auto', true)).toBe('collapsed');
    expect(nextSidebarState('auto', false)).toBe('expanded');
    expect(nextSidebarState('expanded', false)).toBe('collapsed');
    expect(nextSidebarState('collapsed', true)).toBe('expanded');
  });
});
