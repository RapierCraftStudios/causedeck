// `/w/[slug]/settings/danger` (#288, wired in #305): owners only (`workspace.delete`). The danger
// zone card (`--danger-soft` border) holds the destructive entry points:
// - Transfer ownership opens the members page with the transfer picker (`?transfer=1`), the
//   existing two-step transfer of #18 that still confirms with the workspace slug.
// - `Delete this workspace`: the consequences (everything is deleted, permanent after 14 days,
//   export first, crypto-erase) and `Delete workspace`, which opens the 3-step dialog (export
//   reminder, step-up, type the name; `delete-workspace-dialog.tsx`). While a deletion waits out its
//   cool-off, the card shows the date and `Cancel deletion` instead (step-up again).
//
// States: permission-denied (direct URL without `workspace.delete`: `Only workspace owners can
// export or delete this workspace.`), loading (`loading.tsx`), error (`error.tsx`, inline retry)
// and offline (the shell banner; actions are disabled with `Needs a connection`). Empty does not
// apply: the rows are fixed.
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { getFormatter, getTranslations } from 'next-intl/server';

import { DangerZone } from '../../../../../../components/settings/danger-zone.tsx';
import { SettingsAction } from '../../../../../../components/settings/disabled-with-reason.tsx';
import {
  SettingRow,
  settingDescriptionId,
} from '../../../../../../components/settings/setting-row.tsx';
import { PermissionDeniedPage } from '../../../../../../components/shell/permission-denied-page.tsx';
import { getAuth } from '../../../../../../lib/auth.ts';
import { canOpenSettings, settingsHref } from '../../../../../../lib/settings-nav.ts';
import { getWorkspaceContext } from '../../../../../../lib/workspace-loader.ts';
import { verifyTwoFactorAction } from '../../../../account/actions.ts';

import { cancelWorkspaceDeletionAction, requestWorkspaceDeletionAction } from './actions.ts';
import { CancelDeletion, DeleteWorkspace } from './delete-workspace-dialog.tsx';

interface DangerPageProps {
  params: Promise<{ slug: string }>;
}

const CONSEQUENCES = ['data', 'permanent', 'export', 'cryptoErase'] as const;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('settings');
  return { title: t('nav.danger') };
}

/** Whether the signed-in user has TOTP on, so the step-up offers the code option. */
async function twoFactorEnabled(): Promise<boolean> {
  const session = await getAuth().api.getSession({ headers: await headers() });
  const user = session?.user as { twoFactorEnabled?: boolean | null } | undefined;
  return user?.twoFactorEnabled === true;
}

export default async function DangerPage({ params }: DangerPageProps) {
  const { slug } = await params;
  // The layout already checks membership; checking again keeps the page safe on its own.
  const context = await getWorkspaceContext(slug);
  if (!context) notFound();
  if (!canOpenSettings(context.role, 'danger')) {
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
  const { activeWorkspaceDeletionIn } = await import('@causedeck/core/runtime');
  const scope = { workspaceId: context.workspace.id, userId: context.user.id };
  const deletion = await activeWorkspaceDeletionIn(scope);
  const [t, tl, format, stepUpCode] = await Promise.all([
    getTranslations('settings'),
    getTranslations('lifecycle'),
    getFormatter(),
    twoFactorEnabled(),
  ]);
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
      </DangerZone>
      <DangerZone
        title={tl('danger.title')}
        data-slot="delete-workspace-card"
        data-deletion={deletion ? deletion.status : 'none'}
      >
        <div className="flex flex-col gap-4 py-3">
          <ul className="text-ink-muted list-disc space-y-1 ps-5 text-sm">
            {CONSEQUENCES.map((item) => (
              <li key={item}>{tl(`danger.consequences.${item}`)}</li>
            ))}
          </ul>
          {deletion?.cooloffUntil ? (
            <>
              <p className="text-sm font-medium" data-slot="deletion-scheduled">
                {tl('danger.scheduled', {
                  date: format.dateTime(deletion.cooloffUntil, { dateStyle: 'medium' }),
                })}
              </p>
              {deletion.status === 'running' ? null : (
                <CancelDeletion
                  workspaceId={context.workspace.id}
                  jobId={deletion.id}
                  twoFactorEnabled={stepUpCode}
                  cancelDeletion={cancelWorkspaceDeletionAction}
                  verifyCode={verifyTwoFactorAction}
                />
              )}
            </>
          ) : (
            <div className="self-start">
              <DeleteWorkspace
                workspaceId={context.workspace.id}
                workspaceName={context.workspace.name}
                exportHref={settingsHref(workspaceSlug, 'export')}
                twoFactorEnabled={stepUpCode}
                requestDeletion={requestWorkspaceDeletionAction}
                verifyCode={verifyTwoFactorAction}
              />
            </div>
          )}
        </div>
      </DangerZone>
    </div>
  );
}
