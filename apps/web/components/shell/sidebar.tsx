'use client';

import { useIsEnabled } from '@causedeck/flags/react';
import { Avatar } from '@causedeck/ui/avatar';
import { useTranslations } from 'next-intl';
import { useSyncExternalStore } from 'react';

import type { WorkspaceContext } from '../../lib/workspace-context.ts';

import { SIDEBAR_ID, SidebarCollapse, railHidden, railRemoved } from './sidebar-collapse.tsx';
import { SidebarNav } from './sidebar-nav.tsx';
import { WorkspaceSwitcher } from './workspace-switcher.tsx';

export {
  SidebarProvider,
  useSidebar,
  type SidebarApi,
  type SidebarProviderProps,
} from './sidebar-collapse.tsx';

const onlineSubscribe = (onChange: () => void) => {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
};

function SyncStatus() {
  const t = useTranslations('shell.sidebar');
  const online = useSyncExternalStore(
    onlineSubscribe,
    () => navigator.onLine,
    () => true,
  );
  return (
    <span
      className="text-ink-subtle flex items-center gap-1.5 text-xs"
      data-sync={online ? 'synced' : 'offline'}
    >
      <span
        aria-hidden="true"
        className={`size-2 shrink-0 rounded-full ${online ? 'bg-success' : 'bg-warning'}`}
      />
      <span className={railHidden}>{online ? t('synced') : t('offline')}</span>
    </span>
  );
}

export interface SidebarProps {
  context: WorkspaceContext;
}

/** The paper-toned column: wordmark, switcher, primary navigation, collapse toggle and user. */
export function Sidebar({ context }: SidebarProps) {
  const t = useTranslations('shell');
  const isEnabled = useIsEnabled();
  return (
    <aside
      id={SIDEBAR_ID}
      aria-label={t('sidebar.label')}
      className="bg-surface-sunken border-line sticky top-0 hidden h-dvh min-w-0 flex-col overflow-hidden border-r md:flex"
    >
      <div className="flex h-14 shrink-0 items-center gap-2 px-5 group-data-[sidebar=collapsed]/shell:justify-center group-data-[sidebar=collapsed]/shell:px-0 group-data-[sidebar=auto]/shell:max-xl:justify-center group-data-[sidebar=auto]/shell:max-xl:px-0">
        <span aria-hidden="true" className="bg-seal size-2 shrink-0 rounded-full" />
        <span className={`font-serif text-lg font-medium ${railRemoved}`}>CauseDeck</span>
      </div>
      <div className="shrink-0 px-3 pb-2">
        <WorkspaceSwitcher
          current={context.workspace}
          memberships={context.memberships}
          variant="sidebar"
        />
      </div>
      <div
        data-sidebar-scroll=""
        className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-3 py-2"
      >
        <SidebarNav slug={context.workspace.slug} role={context.role} isEnabled={isEnabled} />
      </div>
      <div className="border-line flex shrink-0 flex-col gap-2 border-t px-3 py-3">
        <SidebarCollapse />
        <div className="flex min-w-0 items-center gap-2 px-1 group-data-[sidebar=collapsed]/shell:justify-center group-data-[sidebar=auto]/shell:max-xl:justify-center">
          <Avatar name={context.user.name} size="sm" />
          <div className={`flex min-w-0 flex-col ${railHidden}`}>
            <span className="truncate text-sm font-medium">{context.user.name}</span>
            <span className="flex items-center gap-2">
              <span className="text-ink-muted bg-surface border-line rounded-sm border px-1.5 text-xs">
                {t(`roles.${context.role}`)}
              </span>
              <SyncStatus />
            </span>
          </div>
        </div>
      </div>
    </aside>
  );
}
