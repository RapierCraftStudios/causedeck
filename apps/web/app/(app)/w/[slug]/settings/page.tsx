import { pushConfig } from '@causedeck/notifications/push';

import { PushPermissionCard } from '../../../../../components/notifications/push-permission-card.tsx';
import {
  placeholderPage,
  type WorkspacePageProps,
} from '../../../../../components/shell/placeholder-page.tsx';
import { serverEnv } from '../../../../../lib/env.ts';

/** The settings index. Its sections (profile, members, privacy, ...) arrive in #25. */
const SettingsIndex = placeholderPage('settings');

/**
 * The index plus the push permission card (#197), which moves to the notification panel footer
 * with #198. The card renders nothing when push is disabled (no VAPID keys) or unsupported.
 */
export default async function SettingsPage(props: WorkspacePageProps) {
  const index = await SettingsIndex(props);
  const vapidPublicKey = pushConfig(serverEnv())?.publicKey ?? null;
  return (
    <div className="flex flex-col gap-6">
      {index}
      <PushPermissionCard vapidPublicKey={vapidPublicKey} />
    </div>
  );
}
