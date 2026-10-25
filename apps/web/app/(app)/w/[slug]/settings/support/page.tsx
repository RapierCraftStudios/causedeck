// `/w/[slug]/settings/support` (#313): owners only (`support.manage`). CauseDeck support sees a
// workspace only through a session its owner grants (spike §6, PRD PL-6). The page explains in
// plain language what a session lets support see, then lists pending requests (`Grant for 1 hour`,
// a 2 h or 4 h choice, `Deny`) and active sessions (`Revoke now`). There is no extend: more time
// needs a new request. A request reaches the owners as a `security.alert` (in-app and email).
//
// States: loading (a skeleton while the list streams in), error (`Could not load support
// sessions.` with `Try again`), empty (`No support requests.`), offline (the settings banner; the
// buttons are disabled) and permission-denied (direct URL without `support.manage`).
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import { SettingSection } from '../../../../../../components/settings/setting-section.tsx';
import { PermissionDeniedPage } from '../../../../../../components/shell/permission-denied-page.tsx';
import { canOpenSettings } from '../../../../../../lib/settings-nav.ts';
import type { WorkspaceContext } from '../../../../../../lib/workspace-context.ts';
import { getWorkspaceContext } from '../../../../../../lib/workspace-loader.ts';
import { logger } from '../../../../../../src/health.ts';

import {
  denySupportSessionAction,
  grantSupportSessionAction,
  revokeSupportSessionAction,
} from './actions.ts';
import {
  SupportRequests,
  SupportRequestsError,
  SupportRequestsSkeleton,
  type SupportSessionRow,
} from './support-requests.tsx';

interface SupportPageProps {
  params: Promise<{ slug: string }>;
}

const SCOPE_LINES = ['view', 'metadata', 'audit'] as const;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('settings');
  return { title: t('nav.support') };
}

async function loadSessions(context: WorkspaceContext): Promise<SupportSessionRow[]> {
  const { loadSupportPage } = await import('@causedeck/core/runtime');
  const rows = await loadSupportPage({
    workspaceId: context.workspace.id,
    userId: context.user.id,
  });
  return rows.map((row) => ({
    id: row.id,
    scope: row.scope,
    reason: row.reason,
    status: row.status === 'granted' ? 'granted' : 'requested',
    requestedAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt?.toISOString() ?? null,
  }));
}

async function SupportSection({ context }: { context: WorkspaceContext }) {
  let sessions: SupportSessionRow[];
  try {
    sessions = await loadSessions(context);
  } catch (error) {
    logger.error({ err: error }, 'support page: could not load support sessions');
    return <SupportRequestsError />;
  }
  return (
    <SupportRequests
      workspaceId={context.workspace.id}
      sessions={sessions}
      actions={{
        grant: grantSupportSessionAction,
        deny: denySupportSessionAction,
        revoke: revokeSupportSessionAction,
      }}
    />
  );
}

export default async function SupportPage({ params }: SupportPageProps) {
  const { slug } = await params;
  // The layout already checks membership; checking again keeps the page safe on its own.
  const context = await getWorkspaceContext(slug);
  if (!context) notFound();
  if (!canOpenSettings(context.role, 'support')) return <PermissionDeniedPage />;
  const t = await getTranslations('settings');

  return (
    <div data-route="settings-support" className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-serif text-2xl font-medium">{t('support.title')}</h1>
        <p className="text-ink-muted text-sm">{t('support.description')}</p>
      </header>
      <SettingSection id="support-scope" title={t('support.scope.title')}>
        <ul
          data-slot="support-scope"
          className="text-ink-muted list-disc space-y-2 py-3 ps-5 text-sm"
        >
          {SCOPE_LINES.map((line) => (
            <li key={line}>{t(`support.scope.${line}`)}</li>
          ))}
        </ul>
      </SettingSection>
      <Suspense fallback={<SupportRequestsSkeleton />}>
        <SupportSection context={context} />
      </Suspense>
    </div>
  );
}
