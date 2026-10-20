// A settings section that a sibling issue fills in (#284): integrations (#287); roles (#285),
// privacy (#286), export and danger (#288) became real pages. It renders inside the settings shell
// so the sub-nav never leads to a missing page, and checks the section's permission with the same
// `can()` as the sub-nav: a direct URL without it shows the permission-denied page.
import { EmptyState } from '@causedeck/ui/empty-state';
import { Hourglass } from 'lucide-react';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { canOpenSettings, type SettingsSectionId } from '../../lib/settings-nav.ts';
import { getWorkspaceContext } from '../../lib/workspace-loader.ts';
import { PermissionDeniedPage } from '../shell/permission-denied-page.tsx';

export interface SettingsPlaceholderProps {
  params: Promise<{ slug: string }>;
}

export type PlaceholderSection = Extract<SettingsSectionId, 'integrations'>;

export function settingsPlaceholderPage(section: PlaceholderSection) {
  return async function SettingsPlaceholderPage({ params }: SettingsPlaceholderProps) {
    const { slug } = await params;
    // The layout already checks membership; checking again keeps the page safe on its own.
    const context = await getWorkspaceContext(slug);
    if (!context) notFound();
    if (!canOpenSettings(context.role, section)) return <PermissionDeniedPage />;
    const t = await getTranslations('settings');
    return (
      <div data-route={`settings-${section}`} className="flex flex-col gap-6">
        <header className="flex flex-col gap-1">
          <h1 className="font-serif text-2xl font-medium">{t(`nav.${section}`)}</h1>
          <p className="text-ink-muted text-sm">{t(`placeholder.${section}`)}</p>
        </header>
        <EmptyState
          data-pattern-state="empty"
          icon={<Hourglass aria-hidden="true" />}
          title={t('placeholder.title')}
          description={t('placeholder.hint')}
        />
      </div>
    );
  };
}
