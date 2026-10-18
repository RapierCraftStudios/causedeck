import type { ReactNode } from 'react';

import type { SidebarState } from '../../lib/sidebar-state.ts';
import type { WorkspaceContext } from '../../lib/workspace-context.ts';

import { CaptureProvider } from './capture-fab.tsx';
import { MobileNav } from './mobile-nav.tsx';
import { SidebarProvider } from './sidebar-collapse.tsx';
import { Sidebar } from './sidebar.tsx';
import { Topbar } from './topbar.tsx';

export interface AppShellProps {
  context: WorkspaceContext;
  /** From the `sidebar` cookie, so the first paint has the final width. */
  sidebarState: SidebarState;
  children: ReactNode;
}

/**
 * The workspace chrome: sidebar column (hidden below 768 px, a 64 px rail to 1280 px, 264 px from
 * there unless the user chose otherwise), the topbar and the single `main#main` the root skip
 * link targets. Content is max 1200 px, centred. Below 768 px the bottom nav (with the capture
 * button) replaces the sidebar, and `main` pads its bottom to clear it.
 */
export function AppShell({ context, sidebarState, children }: AppShellProps) {
  return (
    <CaptureProvider>
      <SidebarProvider initialState={sidebarState}>
        <Sidebar context={context} />
        <div className="bg-surface flex min-w-0 flex-col">
          <Topbar context={context} />
          <main
            id="main"
            tabIndex={-1}
            data-workspace-slug={context.workspace.slug}
            className="mx-auto w-full max-w-[1200px] flex-1 px-4 pt-6 pb-[calc(var(--space-6)+56px+env(safe-area-inset-bottom))] outline-none md:px-6 md:py-8"
          >
            {children}
          </main>
        </div>
        <MobileNav slug={context.workspace.slug} role={context.role} />
      </SidebarProvider>
    </CaptureProvider>
  );
}
