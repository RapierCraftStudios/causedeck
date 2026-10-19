import { pushConfig } from '@causedeck/notifications/push';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { PushPermissionCard } from '../../../../../components/notifications/push-permission-card.tsx';
import {
  placeholderPage,
  type WorkspacePageProps,
} from '../../../../../components/shell/placeholder-page.tsx';
import { serverEnv } from '../../../../../lib/env.ts';
import { can } from '../../../../../lib/workspace-context.ts';
import { getWorkspaceContext } from '../../../../../lib/workspace-loader.ts';

/** The settings index. Its sections (profile, members, privacy, ...) arrive in #25. */
const SettingsIndex = placeholderPage('settings');

/**
 * The index, a link to the notification preferences (#199), a link to usage for owners
 * (`billing.read`, #223) and the push permission card (#197), which moves to the notification panel
 * footer with #198. The card renders nothing when push is disabled (no VAPID keys) or unsupported.
 */
export default async function SettingsPage(props: WorkspacePageProps) {
  const index = await SettingsIndex(props);
  const [{ slug }, t, tUsage] = await Promise.all([
    props.params,
    getTranslations('notifications.preferences'),
    getTranslations('usage'),
  ]);
  const context = await getWorkspaceContext(slug);
  const showUsage = context !== null && can(context.role, 'billing.read');
  const vapidPublicKey = pushConfig(serverEnv())?.publicKey ?? null;
  return (
    <div className="flex flex-col gap-6">
      {index}
      <Link
        href={`/w/${encodeURIComponent(slug)}/settings/notifications`}
        className="border-line hover:bg-surface-sunken focus-visible:outline-ring flex flex-col gap-0.5 rounded-lg border p-4 outline-offset-2 focus-visible:outline-2"
      >
        <span className="text-sm font-medium">{t('link')}</span>
        <span className="text-ink-muted text-xs">{t('linkHint')}</span>
      </Link>
      {showUsage ? (
        <Link
          href={`/w/${encodeURIComponent(slug)}/settings/usage`}
          className="border-line hover:bg-surface-sunken focus-visible:outline-ring flex flex-col gap-0.5 rounded-lg border p-4 outline-offset-2 focus-visible:outline-2"
        >
          <span className="text-sm font-medium">{tUsage('link')}</span>
          <span className="text-ink-muted text-xs">{tUsage('linkHint')}</span>
        </Link>
      ) : null}
      <PushPermissionCard vapidPublicKey={vapidPublicKey} />
    </div>
  );
}
