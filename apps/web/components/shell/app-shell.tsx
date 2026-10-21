import { PolicyProvider } from '@causedeck/auth/react';
import type { FlagSnapshot } from '@causedeck/flags/keys';
import { FlagsProvider } from '@causedeck/flags/react';
import type { ReactNode } from 'react';

import {
  CooloffBanner,
  type ShellDeletion,
} from '../../app/(app)/w/[slug]/settings/danger/cooloff-banner.tsx';

import type { OwnerTwoFactorState } from '../../lib/require-2fa-for-owners.ts';
import { ShortcutsProvider } from '../../lib/shortcuts/provider.tsx';
import type { SidebarState } from '../../lib/sidebar-state.ts';
import type { WorkspaceContext } from '../../lib/workspace-context.ts';

import { CaptureProvider } from './capture-fab.tsx';
import { MobileNav } from './mobile-nav.tsx';
import { OwnerTwoFactorBanner } from './owner-two-factor-banner.tsx';
import { SidebarProvider } from './sidebar-collapse.tsx';
import { Sidebar } from './sidebar.tsx';
import { SupportBanner, type ShellSupportSession } from './support-banner.tsx';
import { Topbar } from './topbar.tsx';

export interface AppShellProps {
  context: WorkspaceContext;
  /** From the `sidebar` cookie, so the first paint has the final width. */
  sidebarState: SidebarState;
  /** Server-evaluated flags (`getWorkspaceFlags`); booleans only, for hiding dark features. */
  flags: FlagSnapshot;
  /** The owner 2FA policy for the signed-in user (#290); `required` shows the banner. */
  ownerTwoFactor?: OwnerTwoFactorState;
  /** The active support session (#313), loaded for owners only; shows the support banner. */
  supportSession?: ShellSupportSession | null;
  /** The workspace deletion waiting out its cool-off (#305); every member sees the banner. */
  deletion?: ShellDeletion | null;
  children: ReactNode;
}

/**
 * The workspace chrome: sidebar column (hidden below 768 px, a 64 px rail to 1280 px, 264 px from
 * there unless the user chose otherwise), the topbar and the single `main#main` the root skip
 * link targets. Content is max 1200 px, centred. Below 768 px the bottom nav (with the capture
 * button) replaces the sidebar, and `main` pads its bottom to clear it. Flag-gated nav items,
 * commands and shortcuts read `flags` through `FlagsProvider`. During an active support session the
 * owner sees the support banner between the topbar and the page. While a workspace deletion waits
 * out its cool-off, every member sees the cool-off banner first (#305).
 */
export function AppShell({
  context,
  sidebarState,
  flags,
  ownerTwoFactor = 'not-owner',
  supportSession = null,
  deletion = null,
  children,
}: AppShellProps) {
  return (
    <PolicyProvider
      actor={{ userId: context.user.id, workspaceId: context.workspace.id, role: context.role }}
    >
      <FlagsProvider flags={flags}>
        <CaptureProvider>
          <SidebarProvider initialState={sidebarState}>
            <ShortcutsProvider slug={context.workspace.slug} role={context.role}>
              <Sidebar context={context} />
              <div className="bg-surface flex min-w-0 flex-col">
                <Topbar context={context} />
                <CooloffBanner
                  deletion={deletion}
                  slug={context.workspace.slug}
                  owner={context.role === 'owner'}
                />
                <OwnerTwoFactorBanner state={ownerTwoFactor} />
                {supportSession ? (
                  <SupportBanner workspaceId={context.workspace.id} session={supportSession} />
                ) : null}
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
            </ShortcutsProvider>
          </SidebarProvider>
        </CaptureProvider>
      </FlagsProvider>
    </PolicyProvider>
  );
}
