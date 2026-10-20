// `/w/[slug]/settings/export` (#288): owners only (`export.run`). A card explains what the
// workspace export contains and how it arrives; the `Export workspace` button stays disabled with
// `Coming from export service` until the `workspace.export` flag is on, which #31 turns on when the
// export service lands and wires the flow to the enabled button (`data-slot="export-start"`).
//
// States: permission-denied (direct URL without `export.run`), loading (`loading.tsx`, a skeleton
// card), error (`error.tsx`, inline retry) and offline (the shell banner; the button is disabled
// with the offline reason). Empty does not apply: the page is a fixed explainer.
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { SettingsAction } from '../../../../../../components/settings/disabled-with-reason.tsx';
import { SettingRow } from '../../../../../../components/settings/setting-row.tsx';
import { SettingSection } from '../../../../../../components/settings/setting-section.tsx';
import { PermissionDeniedPage } from '../../../../../../components/shell/permission-denied-page.tsx';
import { workspaceFlagCheck } from '../../../../../../lib/flags.ts';
import { canOpenSettings } from '../../../../../../lib/settings-nav.ts';
import { getWorkspaceContext } from '../../../../../../lib/workspace-loader.ts';

interface ExportPageProps {
  params: Promise<{ slug: string }>;
}

const CONTENTS = ['matters', 'documents', 'people', 'audit'] as const;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('settings');
  return { title: t('nav.export') };
}

export default async function ExportPage({ params }: ExportPageProps) {
  const { slug } = await params;
  // The layout already checks membership; checking again keeps the page safe on its own.
  const context = await getWorkspaceContext(slug);
  if (!context) notFound();
  if (!canOpenSettings(context.role, 'export')) return <PermissionDeniedPage />;
  const [t, flag] = await Promise.all([getTranslations('settings'), workspaceFlagCheck(context)]);
  const ready = flag('workspace.export');

  return (
    <div data-route="settings-export" className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-serif text-2xl font-medium">{t('nav.export')}</h1>
        <p className="text-ink-muted text-sm">{t('placeholder.export')}</p>
      </header>
      <SettingSection
        id="export-card"
        title={t('export.title')}
        description={t('export.description')}
      >
        <div className="flex flex-col gap-2 py-3">
          <h3 className="text-sm font-medium">{t('export.contentsTitle')}</h3>
          <ul className="text-ink-muted list-disc space-y-1 ps-5 text-sm">
            {CONTENTS.map((item) => (
              <li key={item}>{t(`export.contents.${item}`)}</li>
            ))}
          </ul>
          <p className="text-ink-muted text-sm">{t('export.delivery')}</p>
        </div>
        <SettingRow
          id="export-start"
          label={t('export.actionLabel')}
          description={t('export.actionDescription')}
        >
          <SettingsAction
            id="export-start-action"
            label={t('export.action')}
            variant="primary"
            reason={ready ? null : t('export.comingSoon')}
            offlineReason={t('offline')}
            describedBy="export-start-description"
            slot="export-start"
          />
        </SettingRow>
      </SettingSection>
    </div>
  );
}
