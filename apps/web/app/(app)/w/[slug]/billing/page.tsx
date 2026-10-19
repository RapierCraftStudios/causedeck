// `/w/[slug]/billing` (#256): the workspace's plan, seats (with clerk seats), next renewal, UPI
// Autopay state, grace banners and invoices, read on the workspace-scoped transaction
// (`withWorkspace`). Owners only (`billing.read`); other roles see `Only workspace owners can manage
// billing.` With `billing.manage` (#257) the cards host the owner actions: change plan, seats,
// cancel or resume, and the GSTIN; without it they are read-only. The payment method update
// arrives later; the invoice PDF route with #258.
//
// States: loading (skeleton cards and rows while billing streams in), error (`Could not load
// billing.` with `Try again`), empty invoices, offline (the shell banner; every action is disabled
// anyway), permission-denied, payment-failed (danger alert with the grace countdown) and Junior
// (upgrade cards for Advocate and Chamber). `?__state=loading|error` previews the first two in
// development, like the members page.
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import { ShellOfflineBanner } from '../../../../../components/shell/offline-banner.tsx';
import { isDev } from '../../../../../lib/env.ts';
import { can, type WorkspaceContext } from '../../../../../lib/workspace-context.ts';
import { getWorkspaceContext } from '../../../../../lib/workspace-loader.ts';
import { logger } from '../../../../../src/health.ts';

import { toBillingView, type BillingView } from './billing-view.ts';
import { BillingError, BillingPermissionDenied } from './billing-error.tsx';
import { InvoiceTable } from './invoice-table.tsx';
import { BillingSkeleton } from './loading.tsx';
import { GstinForm } from './gstin-form.tsx';
import { BillingBanner, PaymentMethodCard } from './payment-method-card.tsx';
import { JuniorPlanCard, PlanCard } from './plan-card.tsx';
import { SeatSummary } from './seat-summary.tsx';

type SearchParams = Record<string, string | string[] | undefined>;

interface BillingPageProps {
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
  const t = await getTranslations('billing');
  return { title: t('metaTitle') };
}

/** Subscription, seats in use and invoices, in one workspace-scoped transaction. */
async function loadBilling(context: WorkspaceContext): Promise<BillingView> {
  const [{ db, withWorkspace }, { listSaasInvoices, loadSubscription }, { countBillableSeats }] =
    await Promise.all([
      import('@causedeck/db'),
      import('@causedeck/core/billing'),
      import('@causedeck/core/workspaces'),
    ]);
  const [{ isLocale, DEFAULT_LOCALE }, requested] = await Promise.all([
    import('@causedeck/i18n'),
    getLocale(),
  ]);
  const workspaceId = context.workspace.id;
  const loaded = await withWorkspace(db, { workspaceId, userId: context.user.id }, async (tx) => ({
    subscription: await loadSubscription(tx, workspaceId),
    seats: await countBillableSeats(tx, workspaceId),
    invoices: await listSaasInvoices(tx, workspaceId),
  }));
  return toBillingView({
    slug: context.workspace.slug,
    subscription: loaded.subscription,
    seatsUsed: { nonClerk: loaded.seats.nonClerk, clerk: loaded.seats.clerk },
    invoices: loaded.invoices,
    now: new Date(),
    locale: isLocale(requested) ? requested : DEFAULT_LOCALE,
  });
}

async function BillingSection({
  context,
  failOnPurpose,
}: {
  context: WorkspaceContext;
  failOnPurpose: boolean;
}) {
  let view: BillingView;
  try {
    if (failOnPurpose) throw new Error('Billing error state (dev toggle)');
    view = await loadBilling(context);
  } catch (error) {
    if (!failOnPurpose) logger.error({ err: error }, 'billing page: could not load billing');
    return <BillingError />;
  }

  if (view.kind === 'junior') {
    return (
      <div data-billing="junior" className="flex flex-col gap-6">
        <JuniorPlanCard upgrades={view.upgrades} />
        <InvoiceTable invoices={view.invoices} />
      </div>
    );
  }
  const manage = can(context.role, 'billing.manage')
    ? { workspaceId: context.workspace.id, slug: context.workspace.slug, view: view.manage }
    : undefined;
  return (
    <div data-billing="paid" className="flex flex-col gap-6">
      {view.banner === null ? null : <BillingBanner banner={view.banner} />}
      {/* 360: stacked. 768: Plan and Seats left, Payment right. 1280: one summary row. */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <PlanCard plan={view.plan} status={view.status} renewal={view.renewal} manage={manage} />
        {view.paymentMethod === null ? null : <PaymentMethodCard state={view.paymentMethod} />}
        <SeatSummary seats={view.seats} manage={manage} />
      </div>
      {manage ? (
        <GstinForm workspaceId={manage.workspaceId} slug={manage.slug} gstin={view.manage.gstin} />
      ) : null}
      <InvoiceTable invoices={view.invoices} />
    </div>
  );
}

export default async function BillingPage({ params, searchParams }: BillingPageProps) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  // The layout already checks membership; checking again keeps the page safe on its own.
  const context = await getWorkspaceContext(slug);
  if (!context) notFound();
  if (!can(context.role, 'billing.read')) return <BillingPermissionDenied />;
  const t = await getTranslations('billing');
  const state = devState(query);

  return (
    <div data-route="billing" className="mx-auto flex w-full max-w-[1100px] flex-col gap-6">
      <ShellOfflineBanner />
      <header className="flex flex-col gap-1">
        <h1 className="font-serif text-2xl font-medium">{t('title')}</h1>
        <p className="text-ink-muted text-sm">
          {t('description', { workspace: context.workspace.name })}
        </p>
      </header>
      {state === 'loading' ? (
        <BillingSkeleton />
      ) : (
        <Suspense fallback={<BillingSkeleton />}>
          <BillingSection context={context} failOnPurpose={state === 'error'} />
        </Suspense>
      )}
    </div>
  );
}
