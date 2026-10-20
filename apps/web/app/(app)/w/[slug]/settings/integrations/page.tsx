// `/w/[slug]/settings/integrations` (#287): the workspace's private email intake address
// (`intake+<token>@<domain>`) and private ICS feed URL. Only each token's hash is stored, so the
// cards show a masked placeholder with the token's status; members with `workspace.manage` (owners
// and advocates) create or rotate a token through `rotateIntegrationTokenAction`, which shows the
// full value once and makes the old one stop working. Each card reads `Not enabled yet` and cannot
// rotate until its flag is on (`capture.email-forward`, `capture.ics-feed`). What the address and
// the feed do is the Capture milestone (#54, #53). Clerks and viewers get the permission-denied
// page, the same `can()` check as the sub-nav. Read on the workspace-scoped transaction
// (`inWorkspace`).
//
// States: empty (no token yet: `Not created yet` and `Create`), loading (skeleton cards), error
// (`Could not load the integrations.` with `Try again`), offline (the settings banner; the buttons
// turn disabled with the reason) and permission-denied. `?__state=loading|error` previews the
// loading and error states in development.
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import { PermissionDeniedPage } from '../../../../../../components/shell/permission-denied-page.tsx';
import { isDev, serverEnv } from '../../../../../../lib/env.ts';
import { workspaceFlagCheck } from '../../../../../../lib/flags.ts';
import { canOpenSettings } from '../../../../../../lib/settings-nav.ts';
import type { WorkspaceContext } from '../../../../../../lib/workspace-context.ts';
import { getWorkspaceContext } from '../../../../../../lib/workspace-loader.ts';
import { logger } from '../../../../../../src/health.ts';

import { rotateIntegrationTokenAction } from './actions.ts';
import { EmailIntakeCard } from './email-intake-card.tsx';
import { IntegrationsError } from './error.tsx';
import { IcsFeedCard } from './ics-feed-card.tsx';
import { IntegrationsSkeleton, type IntegrationTokenStatus } from './integration-card.tsx';
import {
  INTEGRATION_FLAGS,
  maskedIntegrationValue,
  type IntegrationKind,
} from './integration-values.ts';

type SearchParams = Record<string, string | string[] | undefined>;
type Statuses = Record<IntegrationKind, IntegrationTokenStatus | null>;

interface IntegrationsPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<SearchParams>;
}

/** `?__state=loading|error` previews a state in development. Ignored in production. */
function devState(searchParams: SearchParams): string | undefined {
  if (!isDev()) return undefined;
  const value = searchParams.__state;
  return Array.isArray(value) ? value[0] : value;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('settings.integrations');
  return { title: t('metaTitle') };
}

async function loadIntegrations(context: WorkspaceContext): Promise<Statuses> {
  // One at a time, not in a Promise.all: concurrent imports race the test mocks.
  const { inWorkspace } = await import('@causedeck/core/runtime');
  const { getIntegrations } = await import('@causedeck/core/workspaces');
  const workspaceId = context.workspace.id;
  return inWorkspace({ workspaceId, userId: context.user.id }, (tx) =>
    getIntegrations(tx, workspaceId),
  );
}

async function IntegrationsSection({
  context,
  state,
}: {
  context: WorkspaceContext;
  state: string | undefined;
}) {
  let statuses: Statuses;
  let flag: Awaited<ReturnType<typeof workspaceFlagCheck>>;
  try {
    if (state === 'error') throw new Error('Integrations error state (dev toggle)');
    statuses = await loadIntegrations(context);
    flag = await workspaceFlagCheck(context);
  } catch (error) {
    if (state !== 'error') {
      logger.error({ err: error }, 'integrations page: could not load the integrations');
    }
    return <IntegrationsError />;
  }
  const appUrl = serverEnv().APP_URL;
  const common = { workspaceId: context.workspace.id, rotate: rotateIntegrationTokenAction };
  return (
    <>
      <EmailIntakeCard
        {...common}
        masked={maskedIntegrationValue('email_intake', appUrl)}
        status={statuses.email_intake}
        enabled={flag(INTEGRATION_FLAGS.email_intake)}
      />
      <IcsFeedCard
        {...common}
        masked={maskedIntegrationValue('ics_feed', appUrl)}
        status={statuses.ics_feed}
        enabled={flag(INTEGRATION_FLAGS.ics_feed)}
      />
    </>
  );
}

export default async function IntegrationsPage({ params, searchParams }: IntegrationsPageProps) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  // The layout already checks membership; checking again keeps the page safe on its own.
  const context = await getWorkspaceContext(slug);
  if (!context) notFound();
  if (!canOpenSettings(context.role, 'integrations')) return <PermissionDeniedPage />;
  const t = await getTranslations('settings.integrations');
  const state = devState(query);

  return (
    <div data-route="settings-integrations" className="flex min-w-0 flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-serif text-2xl font-medium">{t('title')}</h1>
        <p className="text-ink-muted text-sm">{t('description')}</p>
      </header>
      {state === 'loading' ? (
        <IntegrationsSkeleton />
      ) : (
        <Suspense fallback={<IntegrationsSkeleton />}>
          <IntegrationsSection context={context} state={state} />
        </Suspense>
      )}
    </div>
  );
}
