'use client';

import { Kbd } from '@causedeck/ui/kbd';
import { Search } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';

import type { WorkspaceContext } from '../../lib/workspace-context.ts';
import { Bell } from '../notifications/bell.tsx';
import { OutboxIndicator } from '../pwa/outbox-indicator.tsx';

import { Breadcrumbs } from './breadcrumbs.tsx';
import { useCommandPalette } from './use-command-palette.ts';
import { UserMenu } from './user-menu.tsx';
import { WorkspaceSwitcher } from './workspace-switcher.tsx';

// Install banner and update toast (#50) load after first paint: the shell's initial JS stays put.
const InstallBanner = dynamic(
  () => import('../pwa/install-banner.tsx').then((m) => ({ default: m.InstallBanner })),
  { ssr: false },
);
const UpdateToast = dynamic(
  () => import('../pwa/update-toast.tsx').then((m) => ({ default: m.UpdateToast })),
  { ssr: false },
);

export interface TopbarProps {
  context: WorkspaceContext;
  /** Called when the search button opens the command palette. */
  onSearch?: (() => void) | undefined;
}

/**
 * 52 px on phones (current workspace opening the switcher, search, avatar); 56 px from 768 px
 * (breadcrumbs, the `Search or jump to...` field button, avatar). The notification bell sits
 * before the avatar at every width.
 */
export function Topbar({ context, onSearch }: TopbarProps) {
  const t = useTranslations('shell.topbar');
  const { open, setOpen, Palette } = useCommandPalette();
  return (
    <header className="bg-surface/95 border-line z-sticky sticky top-0 flex h-[52px] shrink-0 items-center gap-2 border-b px-4 md:h-14 md:px-6">
      <div className="flex min-w-0 flex-1 items-center md:hidden">
        <WorkspaceSwitcher
          current={context.workspace}
          memberships={context.memberships}
          variant="topbar"
        />
      </div>
      <div className="hidden min-w-0 flex-1 items-center md:flex">
        <Breadcrumbs workspace={context.workspace} />
      </div>
      <button
        type="button"
        data-shell-search=""
        aria-label={t('searchHint')}
        aria-haspopup="dialog"
        onClick={() => {
          setOpen(true);
          onSearch?.();
        }}
        className="text-ink-muted hover:text-ink border-line-control bg-surface-raised focus-visible:outline-ring flex size-11 shrink-0 items-center justify-center gap-2 rounded-md outline-none focus-visible:outline-2 md:h-9 md:w-64 md:justify-start md:border md:px-2.5 md:[&:is(:lang(ta),:lang(kn))]:w-auto md:[&:is(:lang(ta),:lang(kn))]:min-w-64"
      >
        <Search aria-hidden="true" className="size-4 shrink-0" />
        <span className="hidden flex-1 truncate text-left text-sm md:inline">{t('search')}</span>
        <Kbd hotkey="mod+k" className="hidden md:inline-flex" />
      </button>
      <OutboxIndicator />
      <Bell workspaceId={context.workspace.id} userId={context.user.id} />
      <UserMenu user={context.user} role={context.role} slug={context.workspace.slug} />
      {Palette ? (
        <Palette
          open={open}
          onOpenChange={setOpen}
          slug={context.workspace.slug}
          workspaceId={context.workspace.id}
          role={context.role}
        />
      ) : null}
      <div className="fixed inset-x-4 bottom-20 z-50 flex flex-col gap-2 md:inset-x-auto md:right-6 md:bottom-6 md:w-96">
        <UpdateToast />
        <InstallBanner viewerId={context.user.id} workspaceId={context.workspace.id} />
      </div>
    </header>
  );
}
