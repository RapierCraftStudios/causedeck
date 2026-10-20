// `/w/[slug]/settings/danger` (#288): owners only (`workspace.delete`). The danger zone card
// (`--danger-soft` border) holds the destructive entry points:
// - Transfer ownership opens the members page with the transfer picker (`?transfer=1`), the
//   existing two-step transfer of #18 that still confirms with the workspace slug.
// - Delete workspace stays disabled, its reason in a focusable tooltip, until the deletion flow
//   arrives in #31; the row links to the export page, because deletion follows an export.
//
// States: permission-denied (direct URL without `workspace.delete`), loading (`loading.tsx`),
// error (`error.tsx`, inline retry) and offline (the shell banner; both actions are disabled with
// the offline reason). Empty does not apply: the rows are fixed.
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { DangerZone } from '../../../../../../components/settings/danger-zone.tsx';
import { SettingsAction } from '../../../../../../components/settings/disabled-with-reason.tsx';
import {
  SettingRow,
  settingDescriptionId,
} from '../../../../../../components/settings/setting-row.tsx';
import { PermissionDeniedPage } from '../../../../../../components/shell/permission-denied-page.tsx';
import { canOpenSettings, settingsHref } from '../../../../../../lib/settings-nav.ts';
import { getWorkspaceContext } from '../../../../../../lib/workspace-loader.ts';

interface DangerPageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('settings');
  return { title: t('nav.danger') };
}

export default async function DangerPage({ params }: DangerPageProps) {
  const { slug } = await params;
  // The layout already checks membership; checking again keeps the page safe on its own.
  const context = await getWorkspaceContext(slug);
  if (!context) notFound();
  if (!canOpenSettings(context.role, 'danger')) return <PermissionDeniedPage />;
  const t = await getTranslations('settings');
  const workspaceSlug = context.workspace.slug;

  return (
    <div data-route="settings-danger" className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-serif text-2xl font-medium">{t('nav.danger')}</h1>
        <p className="text-ink-muted text-sm">{t('placeholder.danger')}</p>
      </header>
      <DangerZone title={t('danger.title')} description={t('danger.description')}>
        <SettingRow
          id="danger-transfer"
          label={t('danger.transfer.label')}
          description={t('danger.transfer.description')}
          note={t('danger.transferHint')}
        >
          <SettingsAction
            id="danger-transfer-action"
            label={t('danger.transfer.action')}
            variant="secondary"
            reason={null}
            offlineReason={t('offline')}
            href={`${settingsHref(workspaceSlug, 'members')}?transfer=1`}
            describedBy={settingDescriptionId('danger-transfer')}
            slot="danger-transfer"
          />
        </SettingRow>
        <SettingRow
          id="danger-delete"
          label={t('danger.delete.label')}
          description={t('danger.delete.description')}
          note={
            <Link
              href={settingsHref(workspaceSlug, 'export')}
              className="text-accent underline-offset-2 hover:underline"
            >
              {t('danger.exportFirst')}
            </Link>
          }
        >
          <SettingsAction
            id="danger-delete-action"
            label={t('danger.delete.action')}
            variant="destructive"
            reason={t('danger.unavailable')}
            offlineReason={t('offline')}
            describedBy={settingDescriptionId('danger-delete')}
          />
        </SettingRow>
      </DangerZone>
    </div>
  );
}
