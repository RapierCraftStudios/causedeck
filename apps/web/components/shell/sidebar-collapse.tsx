'use client';

import { useMediaQuery } from '@causedeck/ui/hooks';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import {
  SIDEBAR_EXPANDED_QUERY,
  isSidebarCollapsed,
  nextSidebarState,
  persistSidebarCookie,
  type SidebarState,
} from '../../lib/sidebar-state.ts';

export const SIDEBAR_ID = 'shell-sidebar';

export interface SidebarApi {
  state: SidebarState;
  /** Whether the sidebar currently shows as the 64 px rail. */
  collapsed: boolean;
  /** Flip between the rail and the expanded sidebar, and remember the choice. */
  toggle: () => void;
  setCollapsed: (collapsed: boolean) => void;
}

const SidebarContext = createContext<SidebarApi | null>(null);

/** The sidebar toggle API (the `[` shortcut in #157 calls `toggle`). */
export function useSidebar(): SidebarApi {
  const api = useContext(SidebarContext);
  if (!api) throw new Error('useSidebar must be used inside <SidebarProvider>');
  return api;
}

/** After a collapse, focus that fell to <body> (its element was hidden) returns to the toggle. */
function keepFocus(root: HTMLElement | null) {
  requestAnimationFrame(() => {
    const active = document.activeElement;
    if (active !== null && active !== document.body && active.isConnected) return;
    root?.querySelector<HTMLElement>('[data-sidebar-toggle]')?.focus();
  });
}

const WIDTHS: Record<SidebarState, string> = {
  auto: 'md:[--sidebar-w:64px] xl:[--sidebar-w:264px]',
  collapsed: 'md:[--sidebar-w:64px]',
  expanded: 'md:[--sidebar-w:264px]',
};

export interface SidebarProviderProps {
  initialState: SidebarState;
  children: ReactNode;
}

/**
 * The shell grid. `data-sidebar` drives the column width (`--sidebar-w`) and the rail styling, so
 * the server-rendered cookie state paints at the right width. Width changes animate
 * `grid-template-columns` over 200 ms, and are instant under reduced motion.
 */
export function SidebarProvider({ initialState, children }: SidebarProviderProps) {
  const [state, setState] = useState<SidebarState>(initialState);
  const wide = useMediaQuery(SIDEBAR_EXPANDED_QUERY);
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)');
  const root = useRef<HTMLDivElement>(null);
  const collapsed = isSidebarCollapsed(state, wide);

  const apply = useCallback((next: 'expanded' | 'collapsed') => {
    setState(next);
    persistSidebarCookie(next);
    if (next === 'collapsed') keepFocus(root.current);
  }, []);

  const api = useMemo<SidebarApi>(
    () => ({
      state,
      collapsed,
      toggle: () => {
        apply(nextSidebarState(state, wide));
      },
      setCollapsed: (value) => {
        apply(value ? 'collapsed' : 'expanded');
      },
    }),
    [apply, collapsed, state, wide],
  );

  return (
    <SidebarContext.Provider value={api}>
      <div
        ref={root}
        data-shell=""
        data-sidebar={state}
        data-reduced-motion={reduced ? 'true' : undefined}
        className={[
          'group/shell min-h-dvh [--sidebar-w:0px] md:grid md:grid-cols-[var(--sidebar-w)_minmax(0,1fr)]',
          'ease-standard transition-[grid-template-columns] duration-200 motion-reduce:transition-none',
          reduced ? 'transition-none' : '',
          WIDTHS[state],
        ].join(' ')}
      >
        {children}
      </div>
    </SidebarContext.Provider>
  );
}

/** Hidden in the rail (collapsed, or `auto` below 1280 px), still read by screen readers. */
export const railHidden =
  'group-data-[sidebar=collapsed]/shell:sr-only group-data-[sidebar=auto]/shell:max-xl:sr-only';

/** Removed entirely in the rail. */
export const railRemoved =
  'group-data-[sidebar=collapsed]/shell:hidden group-data-[sidebar=auto]/shell:max-xl:hidden';

/** Rail toggle. The button stays in place in both states, so focus is never lost on collapse. */
export function SidebarCollapse() {
  const t = useTranslations('shell.sidebar');
  const { collapsed, toggle } = useSidebar();
  const Icon = collapsed ? PanelLeftOpen : PanelLeftClose;
  const label = collapsed ? t('expand') : t('collapse');
  return (
    <button
      type="button"
      data-sidebar-toggle=""
      aria-controls={SIDEBAR_ID}
      aria-expanded={!collapsed}
      onClick={toggle}
      className="text-ink-muted hover:bg-accent-soft/60 hover:text-ink focus-visible:outline-ring flex h-9 min-w-0 items-center gap-3 rounded-md px-2.5 text-sm font-medium outline-none group-data-[sidebar=collapsed]/shell:justify-center focus-visible:outline-2 group-data-[sidebar=auto]/shell:max-xl:justify-center"
    >
      <Icon aria-hidden="true" className="size-[18px] shrink-0" strokeWidth={1.5} />
      <span className={railHidden}>{label}</span>
    </button>
  );
}
