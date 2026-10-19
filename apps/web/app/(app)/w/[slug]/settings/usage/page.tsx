// `/w/[slug]/settings/usage` (#223, #30 part 6): this IST month's usage against the plan's limits,
// read on the workspace-scoped transaction (`withWorkspace`). One meter per capped resource (AI
// processing spend against the AI budget, OCR pages, transcription minutes, active matters) with
// percent used, the reset date and plain copy (`AI processing budget resets on 1 Apr`), and a
// breakdown of every metered key underneath. Owners only (`billing.read`); other roles see `Only
// workspace owners can see usage.`
//
// States: loading (skeleton meters while usage streams in), empty (`No usage yet this month.` above
// the zeroed meters), error (`Could not load usage.` with `Try again`), offline (the shell banner
// over the last rendered values) and permission-denied. `?__state=loading|error|empty` previews the
// first three in development, like the billing page.
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import { ShellOfflineBanner } from '../../../../../../components/shell/offline-banner.tsx';
import { isDev } from '../../../../../../lib/env.ts';
import { can, type WorkspaceContext } from '../../../../../../lib/workspace-context.ts';
import { getWorkspaceContext } from '../../../../../../lib/workspace-loader.ts';
import { logger } from '../../../../../../src/health.ts';

import { UsageSkeleton } from './loading.tsx';
import { UsageBreakdown } from './usage-breakdown.tsx';
import { UsageMeter } from './usage-meter.tsx';
import { UsageEmpty, UsageError, UsagePermissionDenied } from './usage-states.tsx';
import { toUsageView, type UsageView } from './usage-view.ts';

type SearchParams = Record<string, string | string[] | undefined>;

interface UsagePageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<SearchParams>;
}

/** `?__state=loading|error|empty` previews a state in development. Ignored in production. */
function devState(searchParams: SearchParams): string | undefined {
  if (!isDev()) return undefined;
  const value = searchParams.__state;
  return Array.isArray(value) ? value[0] : value;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('usage');
  return { title: t('metaTitle') };
}

/** Every counter for this IST month, the AI budget and the plan's caps, in one transaction. */
async function loadUsage(context: WorkspaceContext, emptyOnPurpose: boolean): Promise<UsageView> {
  const [
    { db, withWorkspace },
    { getAiBudget, getUsage, nextPeriodStart, SOFT_LIMIT_BPS, USAGE_KEYS },
    { getWorkspaceEntitlements },
  ] = await Promise.all([
    import('@causedeck/db'),
    import('@causedeck/core/usage'),
    import('@causedeck/core/billing'),
  ]);
  const [{ isLocale, DEFAULT_LOCALE }, requested] = await Promise.all([
    import('@causedeck/i18n'),
    getLocale(),
  ]);
  const workspaceId = context.workspace.id;
  const now = new Date();
  const loaded = await withWorkspace(db, { workspaceId, userId: context.user.id }, async (tx) => {
    const ctx = { db: tx, workspaceId, now: () => now };
    // One after another: each read nests a savepoint on this transaction's connection.
    const counters: Partial<Record<(typeof USAGE_KEYS)[number], number>> = {};
    for (const key of USAGE_KEYS) counters[key] = await getUsage(ctx, key);
    const budget = await getAiBudget(ctx);
    const entitlements = await getWorkspaceEntitlements(tx, workspaceId, now);
    return { counters, budget, entitlements };
  });
  return toUsageView({
    counters: emptyOnPurpose ? {} : loaded.counters,
    limits: {
      aiBudgetPaise: loaded.budget.budgetPaise,
      ocrPages: loaded.entitlements.ocr_pages,
      captureMinutes: loaded.entitlements.capture_minutes,
      maxActiveMatters: loaded.entitlements.max_active_matters,
    },
    resetAt: nextPeriodStart(now),
    locale: isLocale(requested) ? requested : DEFAULT_LOCALE,
    softLimitBps: SOFT_LIMIT_BPS,
  });
}

async function UsageSection({
  context,
  state,
}: {
  context: WorkspaceContext;
  state: string | undefined;
}) {
  let view: UsageView;
  try {
    if (state === 'error') throw new Error('Usage error state (dev toggle)');
    view = await loadUsage(context, state === 'empty');
  } catch (error) {
    if (state !== 'error') logger.error({ err: error }, 'usage page: could not load usage');
    return <UsageError />;
  }

  return (
    <div data-usage={view.empty ? 'empty' : 'metered'} className="flex flex-col gap-6">
      {view.empty ? <UsageEmpty /> : null}
      {/* 360: stacked. 768: two columns. 1280: three columns, the breakdown underneath. */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {view.meters.map((meter) => (
          <UsageMeter key={meter.id} meter={meter} />
        ))}
      </div>
      <UsageBreakdown rows={view.breakdown} />
    </div>
  );
}

export default async function UsagePage({ params, searchParams }: UsagePageProps) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  // The layout already checks membership; checking again keeps the page safe on its own.
  const context = await getWorkspaceContext(slug);
  if (!context) notFound();
  if (!can(context.role, 'billing.read')) return <UsagePermissionDenied />;
  const t = await getTranslations('usage');
  const state = devState(query);

  return (
    <div data-route="usage" className="mx-auto flex w-full max-w-[1100px] flex-col gap-6">
      <ShellOfflineBanner />
      <header className="flex flex-col gap-1">
        <h1 className="font-serif text-2xl font-medium">{t('title')}</h1>
        <p className="text-ink-muted text-sm">
          {t('description', { workspace: context.workspace.name })}
        </p>
      </header>
      {state === 'loading' ? (
        <UsageSkeleton />
      ) : (
        <Suspense fallback={<UsageSkeleton />}>
          <UsageSection context={context} state={state} />
        </Suspense>
      )}
    </div>
  );
}
