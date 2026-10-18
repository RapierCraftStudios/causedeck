// Sidebar width state. The cookie holds only an explicit choice; without one the shell renders
// `auto`, and CSS picks the 64 px rail from 768 px and the 264 px sidebar from 1280 px. The server
// reads the cookie, so the first paint already has the right width (no layout shift).

export const SIDEBAR_COOKIE = 'sidebar';

export type SidebarState = 'auto' | 'expanded' | 'collapsed';

/** Viewports at least this wide show the expanded sidebar under `auto`. */
export const SIDEBAR_EXPANDED_QUERY = '(min-width: 1280px)';

/** The cookie value, or `auto` when it is missing or unrecognised. */
export function parseSidebarCookie(value: string | undefined): SidebarState {
  return value === 'expanded' || value === 'collapsed' ? value : 'auto';
}

export function persistSidebarCookie(state: Exclude<SidebarState, 'auto'>): void {
  document.cookie = `${SIDEBAR_COOKIE}=${state}; path=/; max-age=31536000; samesite=lax`;
}

/** Whether the sidebar shows as the rail, given whether the viewport is 1280 px or wider. */
export function isSidebarCollapsed(state: SidebarState, wide: boolean): boolean {
  return state === 'collapsed' || (state === 'auto' && !wide);
}

/** The explicit state a toggle moves to. `auto` resolves against the current breakpoint. */
export function nextSidebarState(state: SidebarState, wide: boolean): 'expanded' | 'collapsed' {
  return isSidebarCollapsed(state, wide) ? 'expanded' : 'collapsed';
}
