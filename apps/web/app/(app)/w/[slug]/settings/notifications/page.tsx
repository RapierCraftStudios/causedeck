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

import {
  WhatsAppLinkCard,
  WhatsAppLinkError,
} from '../../../../../../components/notifications/whatsapp-link-card.tsx';
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
import { RemindersCard, RemindersError, RemindersSkeleton } from './_reminders-card.tsx';
import { setReminderPreferencesAction, type ReminderPrefsView } from './reminders-actions.ts';
import {
  requestWhatsAppOtpAction,
  setWhatsAppCategoriesAction,
  unlinkWhatsAppAction,
  verifyWhatsAppOtpAction,
  type WhatsAppLinkState,
} from './whatsapp-actions.ts';

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

/** The caller's own WhatsApp link (masked number), read on the workspace-scoped transaction. */
async function loadWhatsAppLink(context: WorkspaceContext): Promise<WhatsAppLinkState | null> {
  const { inWorkspace } = await import('@causedeck/core/runtime');
  const { getWhatsAppLink } = await import('@causedeck/core/whatsapp-link');
  const actor = { workspaceId: context.workspace.id, userId: context.user.id };
  const link = await inWorkspace(actor, (tx) => getWhatsAppLink({ db: tx }, actor));
  if (link === null) return null;
  return {
    maskedNumber: link.maskedNumber,
    verifiedAt: link.verifiedAt.toISOString(),
    consentAt: link.consentAt.toISOString(),
    categories: link.categories,
  };
}

async function WhatsAppSection({ context }: { context: WorkspaceContext }) {
  let link: WhatsAppLinkState | null;
  try {
    link = await loadWhatsAppLink(context);
  } catch (error) {
    logger.error({ err: error }, 'notification preferences: could not load the WhatsApp link');
    return <WhatsAppLinkError />;
  }
  return (
    <WhatsAppLinkCard
      workspaceId={context.workspace.id}
      link={link}
      actions={{
        requestOtp: requestWhatsAppOtpAction,
        verifyOtp: verifyWhatsAppOtpAction,
        setCategories: setWhatsAppCategoriesAction,
        unlink: unlinkWhatsAppAction,
      }}
    />
  );
}

/** The caller's own court-day reminder preferences (#64), read on the workspace-scoped transaction. */
async function loadReminders(context: WorkspaceContext): Promise<ReminderPrefsView> {
  const { inWorkspace } = await import('@causedeck/core/runtime');
  const { getReminderPreferences } = await import('@causedeck/notifications');
  const actor = { workspaceId: context.workspace.id, userId: context.user.id };
  return inWorkspace(actor, (tx) =>
    getReminderPreferences({ db: tx, workspaceId: actor.workspaceId }, { userId: actor.userId }),
  );
}

async function RemindersSection({ context }: { context: WorkspaceContext }) {
  let prefs: ReminderPrefsView;
  try {
    prefs = await loadReminders(context);
  } catch (error) {
    logger.error({ err: error }, 'notification preferences: could not load reminders');
    return <RemindersError />;
  }
  return (
    <RemindersCard
      workspaceId={context.workspace.id}
      prefs={prefs}
      actions={{ set: setReminderPreferencesAction }}
    />
  );
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
      {state === 'loading' ? (
        <RemindersSkeleton />
      ) : (
        <Suspense fallback={<RemindersSkeleton />}>
          <RemindersSection context={context} />
        </Suspense>
      )}
      <PushPermissionCard vapidPublicKey={vapidPublicKey} />
      <Suspense>
        <WhatsAppSection context={context} />
      </Suspense>
    </div>
  );
}
