// `/w/[slug]/settings/sso` (#683): the organisation's single sign-on providers. Owners only
// (`member.role`); everyone else gets the permission-denied page. Providers are listed without their
// settings (`listSsoProviders` never returns the client secret or certificate).
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import { PermissionDeniedPage } from '../../../../../../components/shell/permission-denied-page.tsx';
import { canOpenSettings } from '../../../../../../lib/settings-nav.ts';
import { getWorkspaceContext } from '../../../../../../lib/workspace-loader.ts';
import { logger } from '../../../../../../src/health.ts';

import {
  deleteSsoProviderAction,
  saveSsoProviderAction,
  verifySsoDomainAction,
} from './actions.ts';
import { SsoError } from './error.tsx';
import { SsoProviderForm, SsoSkeleton } from './sso-form.tsx';
import { toView, type SsoProviderView } from './view.ts';

interface SsoPageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('settings.sso');
  return { title: t('metaTitle') };
}

async function SsoSection({ workspaceId, userId }: { workspaceId: string; userId: string }) {
  let providers: SsoProviderView[];
  try {
    const { inWorkspace } = await import('@causedeck/core/runtime');
    const { listSsoProviders } = await import('@causedeck/core/workspaces');
    const rows = await inWorkspace({ workspaceId, userId }, (tx) =>
      listSsoProviders(tx, { workspaceId, actorUserId: userId }),
    );
    providers = rows.map(toView);
  } catch (error) {
    logger.error({ err: error }, 'sso page: could not load providers');
    return <SsoError />;
  }
  return (
    <SsoProviderForm
      workspaceId={workspaceId}
      providers={providers}
      save={saveSsoProviderAction}
      remove={deleteSsoProviderAction}
      verify={verifySsoDomainAction}
    />
  );
}

export default async function SsoPage({ params }: SsoPageProps) {
  const { slug } = await params;
  const context = await getWorkspaceContext(slug);
  if (!context) notFound();
  if (!canOpenSettings(context.role, 'sso')) return <PermissionDeniedPage />;
  const t = await getTranslations('settings.sso');
  return (
    <div data-route="settings-sso" className="flex min-w-0 flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-serif text-2xl font-medium">{t('title')}</h1>
        <p className="text-ink-muted text-sm">{t('description')}</p>
      </header>
      <Suspense fallback={<SsoSkeleton />}>
        <SsoSection workspaceId={context.workspace.id} userId={context.user.id} />
      </Suspense>
    </div>
  );
}
