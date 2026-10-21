// The settings shell (#284, #25 design spec). Every `/w/[slug]/settings/*` page renders inside it:
// the `Settings` header, the sub-nav and the content column, with the settings offline banner on
// top (settings are read-only offline).
// - 360: one column; the sub-nav is a horizontally scrollable segmented strip pinned under the
//   topbar, edge-faded; no page-level horizontal scroll.
// - 768: a 200 px sticky sub-nav at the left and a content column of at most 560 px.
// - 1280+: a 220 px sub-nav and a 640 px content column. Pages that want the 280 px `Why this
//   matters` help rail (privacy, roles) render it in their own content.
// The sub-nav lists the sections the role may open (`can()`, lib/settings-nav.ts); each page checks
// the same permission, so a direct URL to a hidden section shows the permission-denied page.
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import {
  SettingsNav,
  type SettingsNavEntry,
} from '../../../../../components/settings/settings-nav.tsx';
import { SettingsOfflineBanner } from '../../../../../components/settings/settings-offline-banner.tsx';
import { settingsHref, visibleSettingsItems } from '../../../../../lib/settings-nav.ts';
import { getWorkspaceContext } from '../../../../../lib/workspace-loader.ts';

interface SettingsLayoutProps {
  children: ReactNode;
  params: Promise<{ slug: string }>;
}

export default async function SettingsLayout({ children, params }: SettingsLayoutProps) {
  const { slug } = await params;
  // The workspace layout already checks membership; checking again keeps the shell safe on its own.
  const context = await getWorkspaceContext(slug);
  if (!context) notFound();
  const t = await getTranslations('settings');
  const entries: SettingsNavEntry[] = visibleSettingsItems(context.role).map((item) => ({
    id: item.id,
    href: settingsHref(context.workspace.slug, item.id),
    label: t(`nav.${item.labelKey}`),
    group: item.group,
  }));

  return (
    <div data-slot="settings-shell" className="flex min-w-0 flex-col gap-4">
      <p className="font-serif text-2xl font-medium" data-slot="settings-title">
        {t('title')}
      </p>
      <div className="flex min-w-0 flex-col gap-6 md:grid md:grid-cols-[200px_minmax(0,560px)] md:items-start md:gap-8 xl:grid-cols-[220px_minmax(0,640px)]">
        <SettingsNav entries={entries} label={t('navLabel')} moreLabel={t('nav.more')} />
        <div data-slot="settings-content" className="flex min-w-0 flex-col gap-4">
          <SettingsOfflineBanner />
          {children}
        </div>
      </div>
    </div>
  );
}
