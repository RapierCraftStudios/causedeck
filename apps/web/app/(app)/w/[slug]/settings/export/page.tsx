// `/w/[slug]/settings/export` (#288, wired in #305): owners only (`export.run`). With the
// `workspace.export` flag off, a card explains what the export contains and the `Export workspace`
// button stays disabled with `Coming from export service`. With it on, the page shows the export
// card (`Request export`, progress while it builds, `Download` and `Copy SHA-256` when ready, `Try
// again` when it failed) and the History card with the requester's last 5 exports
// (`export-card.tsx`, `export-history.tsx`, actions in `actions.ts`). Requesting needs a recent
// step-up (passkey or TOTP within 10 minutes, #304), which the card asks for when it is missing.
//
// States: permission-denied (direct URL without `export.run`: `Only workspace owners can export or
// delete this workspace.`), loading (`loading.tsx`, a skeleton card), error (`error.tsx`, inline
// retry), empty (`No exports yet.`) and offline (the shell banner; actions are disabled with
// `Needs a connection`).
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { SettingsAction } from '../../../../../../components/settings/disabled-with-reason.tsx';
import { SettingRow } from '../../../../../../components/settings/setting-row.tsx';
import { SettingSection } from '../../../../../../components/settings/setting-section.tsx';
import { PermissionDeniedPage } from '../../../../../../components/shell/permission-denied-page.tsx';
import { getAuth } from '../../../../../../lib/auth.ts';
import { workspaceFlagCheck } from '../../../../../../lib/flags.ts';
import { canOpenSettings } from '../../../../../../lib/settings-nav.ts';
import { getWorkspaceContext } from '../../../../../../lib/workspace-loader.ts';
import { verifyTwoFactorAction } from '../../../../account/actions.ts';

import { listExportsAction, requestExportAction } from './actions.ts';
import { ExportCard } from './export-card.tsx';
import { toExportView } from './export-history.tsx';

interface ExportPageProps {
  params: Promise<{ slug: string }>;
}

const CONTENTS = ['matters', 'documents', 'people', 'audit'] as const;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('settings');
  return { title: t('nav.export') };
}

/** Whether the signed-in user has TOTP on, so the step-up offers the code option. */
async function twoFactorEnabled(): Promise<boolean> {
  const session = await getAuth().api.getSession({ headers: await headers() });
  const user = session?.user as { twoFactorEnabled?: boolean | null } | undefined;
  return user?.twoFactorEnabled === true;
}

/** The requester's exports for the cards, and when they were read (the countdown's first paint). */
async function loadExports(workspaceId: string, userId: string) {
  const { listExportJobsFor } = await import('@causedeck/core/runtime');
  const jobs = await listExportJobsFor({ workspaceId, userId });
  return { jobs: jobs.map(toExportView), loadedAt: Date.now() };
}

export default async function ExportPage({ params }: ExportPageProps) {
  const { slug } = await params;
  // The layout already checks membership; checking again keeps the page safe on its own.
  const context = await getWorkspaceContext(slug);
  if (!context) notFound();
  if (!canOpenSettings(context.role, 'export')) {
    const t = await getTranslations('lifecycle');
    return (
      <div className="flex flex-col gap-2">
        <PermissionDeniedPage />
        <p className="text-ink-muted text-center text-sm" data-slot="lifecycle-forbidden">
          {t('forbidden')}
        </p>
      </div>
    );
  }
  const [t, flag] = await Promise.all([getTranslations('settings'), workspaceFlagCheck(context)]);
  const ready = flag('workspace.export');

  if (ready) {
    const { jobs, loadedAt } = await loadExports(context.workspace.id, context.user.id);
    return (
      <div data-route="settings-export" className="flex flex-col gap-6">
        <header className="flex flex-col gap-1">
          <h1 className="font-serif text-2xl font-medium">{t('nav.export')}</h1>
          <p className="text-ink-muted text-sm">{t('export.description')}</p>
        </header>
        <ExportCard
          workspaceId={context.workspace.id}
          initialJobs={jobs}
          initialNow={loadedAt}
          twoFactorEnabled={await twoFactorEnabled()}
          requestExport={requestExportAction}
          listExports={listExportsAction}
          verifyCode={verifyTwoFactorAction}
        />
      </div>
    );
  }

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
            reason={t('export.comingSoon')}
            offlineReason={t('offline')}
            describedBy="export-start-description"
            slot="export-start"
          />
        </SettingRow>
      </SettingSection>
    </div>
  );
}
