// `/w/[slug]/settings/privacy` (#286): where data is processed and how long it is kept. It leads
// with a calm summary card (`Your data stays in India. AI processing stays in India. We never train
// on your content.`), then India-only AI processing, locked on with its explanation (no override
// here: the owner override is a staff-reviewed path that is not built), the sensitive-matter
// default and the raw audio retention window, which members with `workspace.manage` (owners and
// advocates) change through `updateWorkspacePrivacyAction`, then the sub-processor list link and
// `What CauseDeck never does`. Clerks and viewers get the permission-denied page, the same `can()`
// check as the sub-nav. Read on the workspace-scoped transaction (`inWorkspace`).
//
// States: loading (skeleton cards while the settings stream in), error (`Could not load the privacy
// settings.` with `Try again`), offline (the settings banner; the controls turn read-only) and
// permission-denied. The page has no list, so there is no empty state: a workspace without a
// settings row shows the defaults. `?__state=loading|error` previews the first two in development.
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ShieldCheck } from 'lucide-react';
import { Suspense } from 'react';

import { SettingSection } from '../../../../../../components/settings/setting-section.tsx';
import { PermissionDeniedPage } from '../../../../../../components/shell/permission-denied-page.tsx';
import { isDev } from '../../../../../../lib/env.ts';
import { canOpenSettings } from '../../../../../../lib/settings-nav.ts';
import { can, type WorkspaceContext } from '../../../../../../lib/workspace-context.ts';
import { getWorkspaceContext } from '../../../../../../lib/workspace-loader.ts';
import { logger } from '../../../../../../src/health.ts';

import {
  setAllowEvalReuseAction,
  updateWorkspacePrivacyAction,
  type PrivacySettingsView,
} from './actions.ts';
import { OfflineCard } from './_offline-card.tsx';
import { PovSection } from './_pov-section.tsx';
import { PrivacyError } from './error.tsx';
import { PrivacyForm, PrivacySkeleton } from './privacy-form.tsx';

/**
 * The public sub-processor list on the site (#95, `apps/site/app/legal/sub-processors`). A relative
 * placeholder until the Launch milestone legal pages exist, like the sign-in legal links.
 */
const SUB_PROCESSORS_HREF = '/legal/sub-processors';

/** The `What CauseDeck never does` items, in display order (keys under `settings.privacy.neverDoes.items`). */
const NEVER_DOES = ['train', 'sell', 'abroad', 'access', 'keep'] as const;

type SearchParams = Record<string, string | string[] | undefined>;

interface PrivacyPageProps {
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
  const t = await getTranslations('settings.privacy');
  return { title: t('metaTitle') };
}

async function loadPrivacy(
  context: WorkspaceContext,
): Promise<{ settings: PrivacySettingsView; allowEvalReuse: boolean }> {
  // One at a time, not in a Promise.all: concurrent imports race the test mocks.
  const { inWorkspace } = await import('@causedeck/core/runtime');
  const { getPrivacySettings, getAllowEvalReuse } = await import('@causedeck/core/workspaces');
  const workspaceId = context.workspace.id;
  return inWorkspace({ workspaceId, userId: context.user.id }, async (tx) => ({
    settings: await getPrivacySettings(tx, workspaceId),
    allowEvalReuse: await getAllowEvalReuse(tx, workspaceId),
  }));
}

async function PrivacySection({
  context,
  state,
}: {
  context: WorkspaceContext;
  state: string | undefined;
}) {
  let loaded: Awaited<ReturnType<typeof loadPrivacy>>;
  try {
    if (state === 'error') throw new Error('Privacy error state (dev toggle)');
    loaded = await loadPrivacy(context);
  } catch (error) {
    if (state !== 'error') logger.error({ err: error }, 'privacy page: could not load settings');
    return <PrivacyError />;
  }
  return (
    <PrivacyForm
      workspaceId={context.workspace.id}
      settings={loaded.settings}
      canEdit={can(context.role, 'workspace.manage')}
      save={updateWorkspacePrivacyAction}
      evalReuse={{
        allow: loaded.allowEvalReuse,
        canEdit: can(context.role, 'member.role'),
        save: setAllowEvalReuseAction,
      }}
    />
  );
}

export default async function PrivacyPage({ params, searchParams }: PrivacyPageProps) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  // The layout already checks membership; checking again keeps the page safe on its own.
  const context = await getWorkspaceContext(slug);
  if (!context) notFound();
  if (!canOpenSettings(context.role, 'privacy')) return <PermissionDeniedPage />;
  const t = await getTranslations('settings.privacy');
  const state = devState(query);

  return (
    <div data-route="settings-privacy" className="flex min-w-0 flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-serif text-2xl font-medium">{t('title')}</h1>
        <p className="text-ink-muted text-sm">{t('description')}</p>
      </header>
      <div
        data-slot="privacy-summary"
        className="border-line bg-surface flex items-start gap-3 rounded-xl border p-4"
      >
        <ShieldCheck aria-hidden="true" className="text-seal mt-0.5 size-6 shrink-0" />
        <p className="font-serif text-lg">{t('summary')}</p>
      </div>
      {state === 'loading' ? (
        <PrivacySkeleton />
      ) : (
        <Suspense fallback={<PrivacySkeleton />}>
          <PrivacySection context={context} state={state} />
        </Suspense>
      )}
      <OfflineCard />
      <PovSection context={context} />
      <SettingSection
        id="privacy-sub-processors"
        title={t('subProcessors.title')}
        description={t('subProcessors.description')}
        data-slot="privacy-sub-processors"
      >
        <p className="pt-2 text-sm">
          <a
            href={SUB_PROCESSORS_HREF}
            className="text-ink focus-visible:outline-ring rounded-sm underline underline-offset-4 outline-offset-2 focus-visible:outline-2"
          >
            {t('subProcessors.link')}
          </a>
        </p>
      </SettingSection>
      <SettingSection
        id="privacy-never-does"
        title={t('neverDoes.title')}
        data-slot="privacy-never-does"
      >
        <ul className="flex list-disc flex-col gap-1 pt-2 pl-5 text-sm">
          {NEVER_DOES.map((item) => (
            <li key={item}>{t(`neverDoes.items.${item}`)}</li>
          ))}
        </ul>
      </SettingSection>
    </div>
  );
}
