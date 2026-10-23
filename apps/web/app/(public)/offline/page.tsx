import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { OfflineScreen } from '../../../components/pwa/offline-screen.tsx';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('pwa.offline');
  return { title: t('metaTitle') };
}

/**
 * Offline fallback (#50): the service worker precaches this page and serves it for navigations that
 * fail while offline. It holds no tenant data, only what works offline and the outbox summary the
 * browser reads from this device.
 */
export default function OfflinePage() {
  return <OfflineScreen />;
}
