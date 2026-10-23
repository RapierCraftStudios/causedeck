// `/w/[slug]/settings/integrations` (#287): two entry cards, the per-member email intake page
// (`./email`, #54) and the private calendar feed page (`./calendar`, #53). Neither card holds a
// token any more, so the page only reads the flags: the calendar card reads `Not enabled yet` until
// `capture.ics-feed` is on and links to its page once it is; the email page gates itself on
// `capture.email-forward`. Clerks and viewers get the permission-denied page, the same `can()`
// check as the sub-nav.
//
// States: loading (skeleton cards), error
// (`Could not load the integrations.` with `Try again`), offline (the settings banner; the buttons
// turn disabled with the reason) and permission-denied. `?__state=loading|error` previews the
// loading and error states in development.
import { Badge } from '@causedeck/ui/badge';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { Suspense } from 'react';

import { SettingSection } from '../../../../../../components/settings/setting-section.tsx';
import { PermissionDeniedPage } from '../../../../../../components/shell/permission-denied-page.tsx';
import { isDev } from '../../../../../../lib/env.ts';
import { workspaceFlagCheck } from '../../../../../../lib/flags.ts';
import { canOpenSettings } from '../../../../../../lib/settings-nav.ts';
import type { WorkspaceContext } from '../../../../../../lib/workspace-context.ts';
import { getWorkspaceContext } from '../../../../../../lib/workspace-loader.ts';
import { logger } from '../../../../../../src/health.ts';

import { IntegrationsError } from './error.tsx';
import { IntegrationsSkeleton } from './integration-card.tsx';
import { INTEGRATION_FLAGS } from './integration-values.ts';

type SearchParams = Record<string, string | string[] | undefined>;

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

/** The private calendar feed lives on its own page (#53); this card only points to it. */
function CalendarLinkCard({ slug, enabled }: { slug: string; enabled: boolean }) {
  const t = useTranslations('settings.integrations');
  const tc = useTranslations('calendar');
  return (
    <SettingSection
      id="integration-ics_feed-section"
      title={
        <span className="flex flex-wrap items-center gap-2">
          {t('icsFeed.title')}
          {enabled ? null : (
            <Badge tone="neutral" data-slot="integration-not-enabled">
              {t('notEnabled')}
            </Badge>
          )}
        </span>
      }
      description={t('icsFeed.description')}
      data-slot="integration-ics_feed"
    >
      {enabled ? (
        <div className="py-3">
          <Link
            href={`/w/${slug}/settings/integrations/calendar`}
            className="text-accent text-sm font-medium underline underline-offset-2"
            data-slot="integration-calendar-link"
          >
            {tc('link.open')}
          </Link>
        </div>
      ) : null}
    </SettingSection>
  );
}

function EmailLinkCard({ slug, t }: { slug: string; t: (key: string) => string }) {
  return (
    <section
      data-slot="integration-email-link"
      className="border-line bg-surface flex flex-col gap-2 rounded-lg border p-4"
    >
      <h2 className="text-base font-medium">{t('title')}</h2>
      <p className="text-ink-muted text-sm">{t('description')}</p>
      <Link
        href={`/w/${slug}/settings/integrations/email`}
        className="text-sm font-medium underline"
      >
        {t('open')}
      </Link>
    </section>
  );
}

async function IntegrationsSection({
  context,
  state,
}: {
  context: WorkspaceContext;
  state: string | undefined;
}) {
  let flag: Awaited<ReturnType<typeof workspaceFlagCheck>>;
  try {
    if (state === 'error') throw new Error('Integrations error state (dev toggle)');
    flag = await workspaceFlagCheck(context);
  } catch (error) {
    if (state !== 'error') {
      logger.error({ err: error }, 'integrations page: could not load the integrations');
    }
    return <IntegrationsError />;
  }
  const emailT = await getTranslations('settings.integrations.emailIntake');
  return (
    <>
      <EmailLinkCard slug={context.workspace.slug} t={emailT} />
      <CalendarLinkCard slug={context.workspace.slug} enabled={flag(INTEGRATION_FLAGS.ics_feed)} />
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
