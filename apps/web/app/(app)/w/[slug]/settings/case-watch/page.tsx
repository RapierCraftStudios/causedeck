// `/w/[slug]/settings/case-watch` (#593, part 5 of #483, D-048 tier 4): the member's own case-status
// watches with "Refresh status" and Remove. Lookups run in the background with no captcha shown;
// a changed next date arrives as a proposal, never confirmed for the member, and no court page is
// shown or framed. Dark until the legal-gated flag `court.case-status` is on for the workspace; a
// direct URL without `matter.write` shows the permission-denied page.
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { SettingSection } from '../../../../../../components/settings/setting-section.tsx';
import { PermissionDeniedPage } from '../../../../../../components/shell/permission-denied-page.tsx';
import { workspaceFlagCheck } from '../../../../../../lib/flags.ts';
import { can } from '../../../../../../lib/workspace-context.ts';
import { getWorkspaceContext } from '../../../../../../lib/workspace-loader.ts';

import {
  listCaseWatchesAction,
  recordDeviceStatusAction,
  refreshCaseStatusAction,
  removeCaseWatchAction,
} from './actions.ts';
import { CaseWatchForm } from './watch-form.tsx';

interface CaseWatchPageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('caseWatch');
  return { title: t('title') };
}

export default async function CaseWatchPage({ params }: CaseWatchPageProps) {
  const { slug } = await params;
  const context = await getWorkspaceContext(slug);
  if (!context) notFound();
  if (!can(context.role, 'matter.write')) return <PermissionDeniedPage />;
  const [t, flag] = await Promise.all([getTranslations('caseWatch'), workspaceFlagCheck(context)]);
  const on = flag('court.case-status');
  const watches = on ? await listCaseWatchesAction({ workspaceId: context.workspace.id }) : null;

  return (
    <div data-route="settings-case-watch" className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-serif text-2xl font-medium">{t('title')}</h1>
        <p className="text-ink-muted text-sm">{t('description')}</p>
      </header>
      <SettingSection id="case-watch-card" title={t('title')}>
        {on && watches?.ok ? (
          <CaseWatchForm
            workspaceId={context.workspace.id}
            watches={watches.data}
            remove={removeCaseWatchAction}
            refresh={{ server: refreshCaseStatusAction, recordDevice: recordDeviceStatusAction }}
          />
        ) : (
          <p className="text-ink-muted py-3 text-sm">{t('flagOff')}</p>
        )}
      </SettingSection>
    </div>
  );
}
