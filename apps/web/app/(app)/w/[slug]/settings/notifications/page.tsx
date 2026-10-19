// `/w/[slug]/settings/notifications` (#199): the signed-in member's notification preferences in this
// workspace: channel per category, the digest, court-hours quiet and lock-screen details. Read on
// the workspace-scoped transaction (`withWorkspace`) for the caller only; changes go through the
// server actions next to this page. It renders inside the settings shell (#284), whose banner covers
// the offline state; the push permission card (#197) moved here from the old settings index.
//
// States: loading (skeleton rows while the preferences stream in) and error (`Could not load
// notification preferences.` with `Try again`). `?__state=loading|error` previews them in
// development, like the members page.
import type { Digest } from '@causedeck/notifications/categories';
import { pushConfig } from '@causedeck/notifications/push';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import { PushPermissionCard } from '../../../../../../components/notifications/push-permission-card.tsx';
import { isDev, serverEnv } from '../../../../../../lib/env.ts';
import type { WorkspaceContext } from '../../../../../../lib/workspace-context.ts';
import { getWorkspaceContext } from '../../../../../../lib/workspace-loader.ts';
import { logger } from '../../../../../../src/health.ts';

import {
  setCourtHoursQuietAction,
  setLockScreenDetailsAction,
  setNotificationDigestAction,
  setNotificationPreferenceAction,
  type PreferenceView,
  type SettingsView,
} from './actions.ts';
import { PreferencesError, PreferencesForm, PreferencesSkeleton } from './preferences-form.tsx';

type SearchParams = Record<string, string | string[] | undefined>;

interface NotificationPreferencesPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<SearchParams>;
}

/** `?__state=loading|error` previews a state in development. Ignored in production. */
function devState(searchParams: SearchParams): string | undefined {
  if (!isDev()) return undefined;
  const value = searchParams.__state;
  return Array.isArray(value) ? value[0] : value;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('notifications.preferences');
  return { title: t('metaTitle') };
}

interface Loaded {
  preferences: PreferenceView[];
  digest: Digest;
  settings: SettingsView;
}

async function loadPreferences(context: WorkspaceContext): Promise<Loaded> {
  const { loadNotificationPreferences } = await import('@causedeck/core/runtime');
  return loadNotificationPreferences({
    workspaceId: context.workspace.id,
    userId: context.user.id,
  });
}

async function PreferencesSection({
  context,
  failOnPurpose,
}: {
  context: WorkspaceContext;
  failOnPurpose: boolean;
}) {
  let data: Loaded;
  try {
    if (failOnPurpose) throw new Error('Notification preferences error state (dev toggle)');
    data = await loadPreferences(context);
  } catch (error) {
    if (!failOnPurpose) {
      logger.error({ err: error }, 'notification preferences: could not load preferences');
    }
    return <PreferencesError />;
  }
  return (
    <PreferencesForm
      workspaceId={context.workspace.id}
      preferences={data.preferences}
      digest={data.digest}
      settings={data.settings}
      actions={{
        setPreference: setNotificationPreferenceAction,
        setDigest: setNotificationDigestAction,
        setCourtHoursQuiet: setCourtHoursQuietAction,
        setLockScreenDetails: setLockScreenDetailsAction,
      }}
    />
  );
}

export default async function NotificationPreferencesPage({
  params,
  searchParams,
}: NotificationPreferencesPageProps) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  // The layout already checks membership; checking again keeps the page safe on its own.
  const context = await getWorkspaceContext(slug);
  if (!context) notFound();
  const t = await getTranslations('notifications.preferences');
  const state = devState(query);
  // Renders nothing when push is disabled (no VAPID keys) or unsupported.
  const vapidPublicKey = pushConfig(serverEnv())?.publicKey ?? null;

  return (
    <div data-route="notification-preferences" className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-serif text-2xl font-medium">{t('title')}</h1>
        <p className="text-ink-muted text-sm">
          {t('description', { workspace: context.workspace.name })}
        </p>
      </header>
      {state === 'loading' ? (
        <PreferencesSkeleton />
      ) : (
        <Suspense fallback={<PreferencesSkeleton />}>
          <PreferencesSection context={context} failOnPurpose={state === 'error'} />
        </Suspense>
      )}
      <PushPermissionCard vapidPublicKey={vapidPublicKey} />
    </div>
  );
}
