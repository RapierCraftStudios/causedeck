import { buttonVariants } from '@causedeck/ui/button';
import { EmptyState } from '@causedeck/ui/empty-state';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { isDev } from '../../lib/env.ts';
import { requireWorkspaceFlag } from '../../lib/flags.ts';
import { getNavItem, isNavItemEnabled, type WorkspaceRoute } from '../../lib/nav.ts';
import { can, type FlagKey } from '../../lib/workspace-context.ts';
import { getWorkspaceContext } from '../../lib/workspace-loader.ts';

import { ShellOfflineBanner } from './offline-banner.tsx';
import { PermissionDeniedPage } from './permission-denied-page.tsx';
import { RouteSkeleton } from './route-skeleton.tsx';

/** Every workspace route. Settings is an index until its sections arrive in #25. */
export type PlaceholderRoute = WorkspaceRoute;

/**
 * Where each empty state's primary action leads: a related route that exists today and that every
 * role can open (no permission or flag), or the account page for settings.
 */
export const EMPTY_ACTION_TARGET: Record<PlaceholderRoute, WorkspaceRoute | 'account'> = {
  today: 'courts',
  tomorrow: 'today',
  calendar: 'today',
  inbox: 'today',
  matters: 'courts',
  briefs: 'matters',
  obligations: 'matters',
  drafts: 'matters',
  memory: 'activity',
  people: 'matters',
  courts: 'calendar',
  activity: 'today',
  billing: 'matters',
  invoices: 'matters',
  limitation: 'matters',
  insights: 'activity',
  settings: 'account',
};

/** The href of a route's empty-state action. */
export function emptyActionHref(routeId: PlaceholderRoute, slug: string): string {
  const target = EMPTY_ACTION_TARGET[routeId];
  return target === 'account' ? '/account' : getNavItem(target).href(slug);
}

export type SearchParams = Record<string, string | string[] | undefined>;

export interface WorkspacePageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<SearchParams>;
}

export interface PlaceholderOptions {
  /**
   * Feature-flag check override (tests). By default a flagged route asks `@causedeck/flags` on the
   * server (`requireWorkspaceFlag`): off, the page is `notFound()`.
   */
  isEnabled?: ((flag: FlagKey) => boolean) | undefined;
}

/** `?__state=loading|error` previews a state in development. Ignored in production. */
function devState(searchParams: SearchParams): string | undefined {
  if (!isDev()) return undefined;
  const value = searchParams.__state;
  return Array.isArray(value) ? value[0] : value;
}

/**
 * A designed placeholder for a workspace route that a later milestone fills in. It renders the
 * permission-denied page when the role lacks the route's permission, the loading skeleton or the
 * error boundary under the dev toggle, and otherwise the title, the offline banner and the empty
 * state (icon, title, one-line hint and a primary action to a related page).
 */
export function placeholderPage(routeId: PlaceholderRoute, { isEnabled }: PlaceholderOptions = {}) {
  const item = getNavItem(routeId);

  return async function WorkspacePlaceholderPage({ params, searchParams }: WorkspacePageProps) {
    const [{ slug }, query] = await Promise.all([params, searchParams]);
    // The layout already checks membership; checking again keeps the page safe on its own.
    const context = await getWorkspaceContext(slug);
    if (!context) notFound();
    if (isEnabled !== undefined) {
      if (!isNavItemEnabled(item, isEnabled)) notFound();
    } else if (item.flag !== undefined) {
      await requireWorkspaceFlag(item.flag, context);
    }
    if (item.requires !== undefined && !can(context.role, item.requires)) {
      return <PermissionDeniedPage />;
    }

    const state = devState(query);
    if (state === 'loading') return <RouteSkeleton />;
    if (state === 'error') throw new Error('Placeholder error state (dev toggle)');

    const t = await getTranslations();
    const Icon = item.icon;
    const target = EMPTY_ACTION_TARGET[routeId];
    const destination = target === 'account' ? t('shell.userMenu.account') : t(`nav.${target}`);
    return (
      <div data-route={routeId} className="flex flex-col gap-6">
        <ShellOfflineBanner />
        <header className="flex flex-col gap-1">
          <h1 className="font-serif text-2xl font-medium">{t(item.labelKey)}</h1>
          <p className="text-ink-muted text-sm">{t(`shell.pages.${routeId}.description`)}</p>
        </header>
        <EmptyState
          data-pattern-state="empty"
          icon={<Icon />}
          title={t(`shell.pages.${routeId}.empty`)}
          description={t(`shell.pages.${routeId}.hint`)}
          action={
            <Link
              href={emptyActionHref(routeId, slug)}
              data-empty-action={target}
              className={buttonVariants({ variant: 'primary' })}
            >
              {t('shell.pages.goTo', { destination })}
            </Link>
          }
        />
      </div>
    );
  };
}
