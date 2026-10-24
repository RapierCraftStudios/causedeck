// `/w/[slug]/settings/court-watch` (#482): the member's watches on the Karnataka HC public cause
// list (an advocate name or BRN). Matches arrive in the Inbox as proposals, never confirmed. The
// page shows whether the flag `court.khc-a2` is on for the workspace and whether the list source
// is cleared; with the flag off the form is hidden. A direct URL without `matter.write` shows the
// permission-denied page.
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { SettingSection } from '../../../../../../components/settings/setting-section.tsx';
import { PermissionDeniedPage } from '../../../../../../components/shell/permission-denied-page.tsx';
import { workspaceFlagCheck } from '../../../../../../lib/flags.ts';
import { canOpenSettings } from '../../../../../../lib/settings-nav.ts';
import { getWorkspaceContext } from '../../../../../../lib/workspace-loader.ts';

import { addCourtWatchAction, listCourtWatchesAction, removeCourtWatchAction } from './actions.ts';
import { WatchForm } from './watch-form.tsx';

interface CourtWatchPageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('settings');
  return { title: t('nav.court-watch') };
}

/** Whether the list source may be fetched: cleared and not killed. */
async function sourceCleared(): Promise<boolean> {
  const [{ KHC_CAUSE_LIST_SOURCE_ID }, { isCleared }, { db }] = await Promise.all([
    import('@causedeck/core/court'),
    import('@causedeck/core/sources'),
    import('@causedeck/core/runtime'),
  ]);
  return isCleared(KHC_CAUSE_LIST_SOURCE_ID, { db });
}

export default async function CourtWatchPage({ params }: CourtWatchPageProps) {
  const { slug } = await params;
  const context = await getWorkspaceContext(slug);
  if (!context) notFound();
  if (!canOpenSettings(context.role, 'court-watch')) return <PermissionDeniedPage />;
  const [t, flag] = await Promise.all([getTranslations('settings'), workspaceFlagCheck(context)]);
  const on = flag('court.khc-a2');
  const watches = on ? await listCourtWatchesAction({ workspaceId: context.workspace.id }) : null;
  const cleared = on ? await sourceCleared() : false;

  return (
    <div data-route="settings-court-watch" className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-serif text-2xl font-medium">{t('courtWatch.title')}</h1>
        <p className="text-ink-muted text-sm">{t('courtWatch.description')}</p>
      </header>
      <SettingSection id="court-watch-card" title={t('courtWatch.title')}>
        {on && watches?.ok ? (
          <>
            <p className="text-ink-muted py-3 text-sm" data-slot="court-watch-source">
              {cleared ? t('courtWatch.cleared') : t('courtWatch.uncleared')}
            </p>
            <WatchForm
              workspaceId={context.workspace.id}
              watches={watches.data}
              add={addCourtWatchAction}
              remove={removeCourtWatchAction}
            />
          </>
        ) : (
          <p className="text-ink-muted py-3 text-sm">{t('courtWatch.flagOff')}</p>
        )}
      </SettingSection>
    </div>
  );
}
