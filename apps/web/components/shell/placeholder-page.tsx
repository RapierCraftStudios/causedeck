import { EmptyState } from '@causedeck/ui/empty-state';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { isDev } from '../../lib/env.ts';
import { flagsOff, getNavItem, isNavItemEnabled, type WorkspaceRoute } from '../../lib/nav.ts';
import { can, type FlagKey } from '../../lib/workspace-context.ts';
import { getWorkspaceContext } from '../../lib/workspace-loader.ts';

import { ShellOfflineBanner } from './offline-banner.tsx';
import { PermissionDeniedPage } from './permission-denied-page.tsx';
import { RouteSkeleton } from './route-skeleton.tsx';

/** Every workspace route except `settings`, which redirects to its first section. */
export type PlaceholderRoute = Exclude<WorkspaceRoute, 'settings'>;

export type SearchParams = Record<string, string | string[] | undefined>;

export interface WorkspacePageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<SearchParams>;
}

export interface PlaceholderOptions {
  /** Feature-flag check. TODO(#22): the real evaluator from `@causedeck/flags`. Defaults to off. */
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
 * state.
 */
export function placeholderPage(
  routeId: PlaceholderRoute,
  { isEnabled = flagsOff }: PlaceholderOptions = {},
) {
  const item = getNavItem(routeId);

  return async function WorkspacePlaceholderPage({ params, searchParams }: WorkspacePageProps) {
    const [{ slug }, query] = await Promise.all([params, searchParams]);
    // The layout already checks membership; checking again keeps the page safe on its own.
    const context = await getWorkspaceContext(slug);
    if (!context) notFound();
    if (!isNavItemEnabled(item, isEnabled)) notFound();
    if (item.requires !== undefined && !can(context.role, item.requires)) {
      return <PermissionDeniedPage />;
    }

    const state = devState(query);
    if (state === 'loading') return <RouteSkeleton />;
    if (state === 'error') throw new Error('Placeholder error state (dev toggle)');

    const t = await getTranslations();
    const Icon = item.icon;
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
        />
      </div>
    );
  };
}
