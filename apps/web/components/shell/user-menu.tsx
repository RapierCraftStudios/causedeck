'use client';

import { Avatar } from '@causedeck/ui/avatar';
import { CircleHelp, LogOut, Settings, UserRound } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useTheme } from 'next-themes';
import { useState } from 'react';

import { getNavItem } from '../../lib/nav.ts';
import { useShortcuts } from '../../lib/shortcuts/provider.tsx';
import type { Role, ShellUser } from '../../lib/workspace-context.ts';
import { LocaleSwitcher } from '../locale-switcher.tsx';
import { THEMES, persistThemeCookie, type ThemeChoice } from '../theme-toggle.tsx';

import { loadShellOverlays, useShellOverlays } from './use-shell-overlays.ts';

export interface UserMenuProps {
  user: ShellUser;
  role: Role;
  slug: string;
}

/**
 * Ends the Better Auth session, clears this browser's encrypted offline caches (the next person on
 * a shared device must not read them) and lands on `/sign-in`. The auth client loads on click to
 * stay out of first-load JS; the redirect runs even if the call fails, as the invite page's does.
 */
async function signOut(): Promise<void> {
  try {
    const [{ authClient }, { deleteAllOfflineDbs }] = await Promise.all([
      import('../../lib/auth-client.ts'),
      import('../../lib/offline/db.ts'),
    ]);
    await authClient.signOut();
    await deleteAllOfflineDbs().catch(() => undefined);
  } finally {
    window.location.assign('/sign-in');
  }
}

/**
 * Avatar menu button: who is signed in, account and workspace settings, theme, language and sign
 * out.
 */
export function UserMenu({ user, role, slug }: UserMenuProps) {
  const t = useTranslations();
  const { theme, setTheme } = useTheme();
  const overlays = useShellOverlays();
  const { openHelp } = useShortcuts();
  const [open, setOpen] = useState(false);

  const trigger = (
    <button
      type="button"
      aria-label={`${t('shell.userMenu.label')}: ${user.name}`}
      aria-haspopup="menu"
      aria-expanded={open}
      data-focus-key="user-menu"
      onClick={
        overlays
          ? undefined
          : () => {
              // Clicked before the overlay chunk arrived: open as soon as it does.
              setOpen(true);
              void loadShellOverlays();
            }
      }
      className="focus-visible:outline-ring flex size-11 shrink-0 items-center justify-center rounded-full outline-none focus-visible:outline-2"
    >
      <Avatar name={user.name} size="md" />
    </button>
  );
  if (!overlays) return trigger;

  const {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
  } = overlays;
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="flex flex-col gap-0.5">
          <span className="text-ink truncate text-sm font-medium">{user.name}</span>
          <span className="text-ink-muted truncate text-xs font-normal">{user.email}</span>
          <span className="text-ink-subtle text-xs font-normal">{t(`shell.roles.${role}`)}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/account">
            <UserRound aria-hidden="true" />
            {t('shell.userMenu.account')}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href={getNavItem('settings').href(slug)}>
            <Settings aria-hidden="true" />
            {t('shell.userMenu.settings')}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={openHelp}>
          <CircleHelp aria-hidden="true" />
          {t('help.title')}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>{t('shell.userMenu.theme')}</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={theme ?? 'system'}
          onValueChange={(value) => {
            setTheme(value);
            persistThemeCookie(value as ThemeChoice);
          }}
        >
          {THEMES.map((choice) => (
            <DropdownMenuRadioItem key={choice} value={choice}>
              {t(`theme.${choice}`)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>{t('locale.label')}</DropdownMenuLabel>
        <LocaleSwitcher
          variant="menu"
          menu={{ RadioGroup: DropdownMenuRadioGroup, RadioItem: DropdownMenuRadioItem }}
        />
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => {
            void signOut();
          }}
          data-user-menu-sign-out=""
        >
          <LogOut aria-hidden="true" />
          {t('shell.userMenu.signOut')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
