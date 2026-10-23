// `/w/[slug]/settings/integrations/email` (#54 part 2): the member's private email intake address
// (Copy, Rotate, Revoke), the sender allow-list, the AIMS setup guide and the switch that turns
// the `email` capture channel on after the data-flow note. Members with `workspace.manage` (owners
// and advocates) manage it; clerks and viewers get the permission-denied page, the same `can()`
// check as the sub-nav. Everything is gated by `capture.email-forward`: with the flag off the page
// reads `Not enabled yet` and every control is disabled. Read on the workspace-scoped transaction
// (`inWorkspace`).
//
// States: empty (no address, no senders), loading (skeleton cards), error (`Could not load email
// intake.` with `Try again`), offline (controls disabled with the reason) and permission-denied.
// `?__state=loading|error` previews the loading and error states in development.
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import { AddressCard } from '../../../../../../../components/settings/email/address-card.tsx';
import { AimsGuideCard } from '../../../../../../../components/settings/email/aims-guide-card.tsx';
import { AllowlistCard } from '../../../../../../../components/settings/email/allowlist-card.tsx';
import { ChannelCard } from '../../../../../../../components/settings/email/channel-card.tsx';
import { EmailIntakeSkeleton } from '../../../../../../../components/settings/email/email-skeleton.tsx';
import { PermissionDeniedPage } from '../../../../../../../components/shell/permission-denied-page.tsx';
import { isDev } from '../../../../../../../lib/env.ts';
import { workspaceFlagCheck } from '../../../../../../../lib/flags.ts';
import { canOpenSettings } from '../../../../../../../lib/settings-nav.ts';
import type { WorkspaceContext } from '../../../../../../../lib/workspace-context.ts';
import { getWorkspaceContext } from '../../../../../../../lib/workspace-loader.ts';
import { logger } from '../../../../../../../src/health.ts';

import {
  addIntakeAllowlistEntryAction,
  createIntakeAddressAction,
  enableEmailChannelAction,
  removeIntakeAllowlistEntryAction,
  revokeIntakeAddressAction,
  rotateIntakeAddressAction,
} from './actions.ts';
import { EmailIntakeError } from './error.tsx';

type SearchParams = Record<string, string | string[] | undefined>;

interface EmailIntakePageProps {
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
  const t = await getTranslations('emailIntake');
  return { title: t('metaTitle') };
}

async function loadEmailIntake(context: WorkspaceContext) {
  // One at a time, not in a Promise.all: concurrent imports race the test mocks.
  const { inWorkspace } = await import('@causedeck/core/runtime');
  const { getActiveAddress, listAllowlist } = await import('@causedeck/core/email-intake');
  const { isChannelEnabled } = await import('@causedeck/core/capture');
  const workspaceId = context.workspace.id;
  return inWorkspace({ workspaceId, userId: context.user.id }, async (tx) => ({
    address: await getActiveAddress(tx, workspaceId, context.user.id),
    entries: await listAllowlist(tx, workspaceId),
    channelOn: await isChannelEnabled(tx, workspaceId, 'email'),
  }));
}

async function EmailIntakeSection({
  context,
  state,
}: {
  context: WorkspaceContext;
  state: string | undefined;
}) {
  let data: Awaited<ReturnType<typeof loadEmailIntake>>;
  let flag: Awaited<ReturnType<typeof workspaceFlagCheck>>;
  try {
    if (state === 'error') throw new Error('Email intake error state (dev toggle)');
    data = await loadEmailIntake(context);
    flag = await workspaceFlagCheck(context);
  } catch (error) {
    if (state !== 'error') {
      logger.error({ err: error }, 'email intake page: could not load email intake');
    }
    return <EmailIntakeError />;
  }
  const workspaceId = context.workspace.id;
  const enabled = flag('capture.email-forward');
  return (
    <>
      <ChannelCard
        workspaceId={workspaceId}
        enabled={enabled}
        channelOn={data.channelOn}
        enable={enableEmailChannelAction}
      />
      <AddressCard
        workspaceId={workspaceId}
        address={
          data.address && {
            id: data.address.id,
            address: data.address.address,
            createdAt: data.address.createdAt,
          }
        }
        enabled={enabled}
        create={createIntakeAddressAction}
        rotate={rotateIntakeAddressAction}
        revoke={revokeIntakeAddressAction}
      />
      <AllowlistCard
        workspaceId={workspaceId}
        entries={data.entries}
        enabled={enabled}
        add={addIntakeAllowlistEntryAction}
        remove={removeIntakeAllowlistEntryAction}
      />
      <AimsGuideCard />
    </>
  );
}

export default async function EmailIntakePage({ params, searchParams }: EmailIntakePageProps) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  // The layout already checks membership; checking again keeps the page safe on its own.
  const context = await getWorkspaceContext(slug);
  if (!context) notFound();
  if (!canOpenSettings(context.role, 'integrations')) return <PermissionDeniedPage />;
  const t = await getTranslations('emailIntake');
  const state = devState(query);

  return (
    <div data-route="settings-email-intake" className="flex min-w-0 flex-col gap-6">
      <header className="flex flex-col gap-1">
        <Link
          href={`/w/${slug}/settings/integrations`}
          className="text-accent text-sm underline-offset-4 hover:underline"
        >
          {t('back')}
        </Link>
        <h1 className="font-serif text-2xl font-medium">{t('title')}</h1>
        <p className="text-ink-muted text-sm">{t('description')}</p>
      </header>
      {state === 'loading' ? (
        <EmailIntakeSkeleton />
      ) : (
        <Suspense fallback={<EmailIntakeSkeleton />}>
          <EmailIntakeSection context={context} state={state} />
        </Suspense>
      )}
    </div>
  );
}
