// @vitest-environment jsdom
// `/w/[slug]/billing` (#256): the view model (formatInr amounts, `dd MMM yyyy` IST dates, the UPI
// Autopay state, grace countdown, Junior) and the server page with every design-spec state:
// loading, error, empty invoices, permission-denied, payment-failed, Junior and ta. Every string
// comes from the catalogs.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  BillingInvoiceInput,
  BillingSubscriptionInput,
} from '../app/(app)/w/[slug]/billing/billing-view.ts';
import type { WorkspaceContext } from '../lib/workspace-context.ts';

import { catalogs, fakeGetTranslations, type TestLocale } from './helpers/intl.ts';

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
const page = vi.hoisted(
  (): {
    context: WorkspaceContext | null;
    dev: boolean;
    locale: TestLocale;
    subscription: unknown;
    seats: { total: number; byRole: Record<string, number>; clerk: number; nonClerk: number };
    invoices: unknown[];
    fail: boolean;
  } => ({
    context: null,
    dev: true,
    locale: 'en',
    subscription: null,
    seats: { total: 0, byRole: {}, clerk: 0, nonClerk: 0 },
    invoices: [],
    fail: false,
  }),
);
const withWorkspace = vi.hoisted(() =>
  vi.fn((_db: unknown, _scope: unknown, fn: (tx: unknown) => Promise<unknown>) =>
    fn({ scoped: true }),
  ),
);
const logger = vi.hoisted(() => ({ error: vi.fn() }));
const reportError = vi.hoisted(() => vi.fn());
const ShellOfflineBanner = vi.hoisted(() => () => null);

vi.mock('next/navigation', () => ({
  useRouter: () => router,
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));
vi.mock('next-intl/server', () => ({
  getTranslations: (namespace?: string) => fakeGetTranslations(page.locale)(namespace),
  getLocale: () => Promise.resolve(page.locale),
}));
vi.mock('../lib/workspace-loader.ts', () => ({
  getWorkspaceContext: () => Promise.resolve(page.context),
}));
vi.mock('../lib/env.ts', () => ({ isDev: () => page.dev }));
vi.mock('../lib/report-error.ts', () => ({ reportError }));
vi.mock('../src/health.ts', () => ({ logger }));
vi.mock('../components/shell/offline-banner.tsx', () => ({ ShellOfflineBanner }));
vi.mock('@causedeck/db', () => ({ db: { fake: 'db' }, withWorkspace }));
vi.mock('@causedeck/core/billing', () => ({
  loadSubscription: () =>
    page.fail ? Promise.reject(new Error('db down')) : Promise.resolve(page.subscription),
  listSaasInvoices: () => Promise.resolve(page.invoices),
}));
vi.mock('@causedeck/core/workspaces', () => ({
  countBillableSeats: () => Promise.resolve(page.seats),
}));

const { toBillingView, daysLeft } = await import('../app/(app)/w/[slug]/billing/billing-view.ts');
const { default: BillingPage } = await import('../app/(app)/w/[slug]/billing/page.tsx');
const { default: BillingErrorBoundary } = await import('../app/(app)/w/[slug]/billing/error.tsx');
const { default: BillingLoading } = await import('../app/(app)/w/[slug]/billing/loading.tsx');

const en = catalogs.en.billing;

const WORKSPACE = {
  id: '00000000-0000-4000-8000-00000000a001',
  slug: 'chennai-solo',
  name: 'Iyer Chambers',
};

const chamber: BillingSubscriptionInput = {
  planId: 'chamber-seat-1',
  status: 'active',
  seats: 10,
  clerkSeats: 4,
  // 11 Apr 2026 18:30 UTC is 12 Apr 2026 00:00 IST.
  currentPeriodEnd: new Date('2026-04-11T18:30:00Z'),
  graceUntil: null,
  cancelAtPeriodEnd: false,
  dunningStartedAt: null,
};

const paidInvoice: BillingInvoiceInput = {
  id: 'inv-1',
  number: 'CD/26-27/000001',
  issueDate: '2026-03-12',
  status: 'paid',
  totalPaise: 123_456_789,
  pdfBlobId: 'blob-1',
};
const issuedInvoice: BillingInvoiceInput = {
  id: 'inv-2',
  number: 'CD/26-27/000002',
  issueDate: '2026-04-12',
  status: 'issued',
  totalPaise: 682_748,
  pdfBlobId: null,
};

const NOW = new Date('2026-03-12T04:00:00Z'); // 09:30 IST

function view(subscription: BillingSubscriptionInput | null, invoices = [paidInvoice]) {
  return toBillingView({
    slug: WORKSPACE.slug,
    subscription,
    seatsUsed: { nonClerk: 5, clerk: 1 },
    invoices,
    now: NOW,
    locale: 'en',
  });
}

function paid(subscription: BillingSubscriptionInput) {
  const result = view(subscription);
  if (result.kind !== 'paid') throw new Error('expected a paid view');
  return result;
}

describe('billing view model', () => {
  it('formats amounts with formatInr (Indian grouping) and dates as dd MMM yyyy in IST', () => {
    const result = paid(chamber);
    expect(result.invoices[0]).toEqual({
      id: 'inv-1',
      number: 'CD/26-27/000001',
      date: '12 Mar 2026',
      amount: '₹12,34,567.89',
      status: 'paid',
      pdfHref: '/w/chennai-solo/billing/invoices/inv-1/pdf',
    });
    expect(result.renewal).toEqual({ key: 'renewal', date: '12 Apr 2026' });
    // 10 seats x ₹499 + 4 clerk seats x ₹199, ex-GST.
    expect(result.plan).toEqual({
      name: 'Chamber 1 (per seat, monthly)',
      price: '₹5,786.00',
      interval: 'month',
      breakdown: { seats: 10, seatPrice: '₹499.00', clerkSeats: 4, clerkPrice: '₹199.00' },
    });
  });

  it('renders the IST calendar day, not the UTC one', () => {
    const result = paid({ ...chamber, currentPeriodEnd: new Date('2026-03-31T19:00:00Z') });
    expect(result.renewal).toEqual({ key: 'renewal', date: '01 Apr 2026' });
  });

  it('shows seats with clerk seats apart', () => {
    expect(paid(chamber).seats).toEqual({ used: 5, total: 10, clerks: { used: 1, total: 4 } });
    expect(paid({ ...chamber, planId: 'advocate-monthly-1', clerkSeats: 0 }).seats.clerks).toBe(
      null,
    );
  });

  it('maps the subscription to the UPI Autopay state', () => {
    expect(paid(chamber).paymentMethod).toBe('active');
    expect(paid({ ...chamber, status: 'trialing' }).paymentMethod).toBe('pending');
    expect(paid({ ...chamber, status: 'past_due' }).paymentMethod).toBe('failed');
    expect(paid({ ...chamber, status: 'paused' }).paymentMethod).toBe('failed');
    expect(paid({ ...chamber, dunningStartedAt: NOW }).paymentMethod).toBe('failed');
    expect(paid({ ...chamber, status: 'cancelled' }).paymentMethod).toBeNull();
  });

  it('shows the grace badge and countdown while past due in grace', () => {
    const result = paid({
      ...chamber,
      status: 'past_due',
      dunningStartedAt: NOW,
      graceUntil: new Date('2026-03-15T18:00:00Z'), // 15 Mar 23:30 IST
    });
    expect(result.status).toEqual({ key: 'grace', date: '15 Mar 2026' });
    expect(result.banner).toEqual({ key: 'grace', date: '15 Mar 2026', days: 3 });
  });

  it('shows a payment-failed banner without a grace period', () => {
    const result = paid({ ...chamber, status: 'past_due' });
    expect(result.status).toEqual({ key: 'pastDue' });
    expect(result.banner).toEqual({ key: 'paymentFailed' });
  });

  it('shows when a plan cancels at period end', () => {
    const result = paid({ ...chamber, cancelAtPeriodEnd: true });
    expect(result.status).toEqual({ key: 'cancelsOn', date: '12 Apr 2026' });
    expect(result.renewal).toEqual({ key: 'endsOn', date: '12 Apr 2026' });
    expect(result.banner).toEqual({ key: 'cancels', date: '12 Apr 2026' });
  });

  it('is Junior without a subscription or after a downgrade, with upgrade options', () => {
    for (const subscription of [null, { ...chamber, status: 'expired' }]) {
      const result = view(subscription);
      expect(result.kind).toBe('junior');
      if (result.kind !== 'junior') return;
      expect(result.upgrades).toEqual([
        { kind: 'advocate', fromPrice: '₹499.00', minSeats: 1 },
        { kind: 'chamber', fromPrice: '₹499.00', minSeats: 3 },
      ]);
    }
  });

  it('links the PDF only once it has been rendered', () => {
    expect(paid(chamber).invoices[0]?.pdfHref).not.toBeNull();
    expect(view(chamber, [issuedInvoice]).invoices[0]?.pdfHref).toBeNull();
  });

  it('counts grace days on IST calendar days and never below zero', () => {
    expect(daysLeft(new Date('2026-03-12T18:00:00Z'), NOW)).toBe(0);
    expect(daysLeft(new Date('2026-03-12T18:31:00Z'), NOW)).toBe(1);
    expect(daysLeft(new Date('2026-03-01T00:00:00Z'), NOW)).toBe(0);
  });
});

const withIntl = (ui: ReactNode, locale: TestLocale = 'en') =>
  render(
    <NextIntlClientProvider locale={locale} messages={catalogs[locale]} timeZone="Asia/Kolkata">
      {ui}
    </NextIntlClientProvider>,
  );

/** Render the page, resolving the async billing section inside its Suspense boundary. */
async function renderPage(search: Record<string, string> = {}) {
  const tree = (await BillingPage({
    params: Promise.resolve({ slug: WORKSPACE.slug }),
    searchParams: Promise.resolve(search),
  })) as ReactElement<{ children?: unknown }>;
  const children = tree.props.children;
  if (!Array.isArray(children)) {
    withIntl(tree, page.locale);
    return;
  }
  // Children: the offline banner (mocked out), the header, then the skeleton or the Suspense body.
  const [, header, body] = children as [ReactElement, ReactElement, ReactElement];
  const section = (body.props as { children?: ReactElement }).children;
  let content: ReactNode = body;
  if (section && typeof section.type === 'function') {
    const Section = section.type as (props: unknown) => Promise<ReactNode>;
    content = await Section(section.props);
  }
  withIntl(
    <div>
      {header}
      {content}
    </div>,
    page.locale,
  );
}

const subscriptionRow = (overrides: Partial<BillingSubscriptionInput> = {}) => ({
  ...chamber,
  currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000),
  ...overrides,
});

beforeEach(() => {
  page.context = {
    user: { id: 'u-owner', name: 'Meenakshi Iyer', email: 'owner@x.test' },
    workspace: WORKSPACE,
    role: 'owner',
    memberships: [],
  };
  page.dev = true;
  page.locale = 'en';
  page.subscription = subscriptionRow();
  page.seats = { total: 6, byRole: {}, clerk: 1, nonClerk: 5 };
  page.invoices = [issuedInvoice, paidInvoice];
  page.fail = false;
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('billing page (server)', () => {
  it('is not found for a non-member', async () => {
    page.context = null;
    await expect(renderPage()).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('shows plan, seats, renewal, payment method and invoices for the owner', async () => {
    await renderPage();
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading.textContent).toBe(en.title);
    expect(withWorkspace).toHaveBeenCalledWith(
      { fake: 'db' },
      { workspaceId: WORKSPACE.id, userId: 'u-owner' },
      expect.any(Function),
    );
    expect(screen.getByRole('heading', { name: 'Chamber 1 (per seat, monthly)' })).toBeTruthy();
    expect(document.querySelector('[data-slot="billing-price"]')?.textContent).toBe('₹5,786.00');
    expect(screen.getByText(en.plan.gstNote)).toBeTruthy();
    expect(document.querySelector('[data-slot="billing-renewal"]')?.textContent).toMatch(
      /^Renews on \d{2} [A-Z][a-z]{2} \d{4}$/,
    );
    expect(screen.getByText('5 of 10 seats')).toBeTruthy();
    expect(screen.getByText('1 of 4 clerk seats')).toBeTruthy();
    expect(screen.getByText(en.paymentMethod.active)).toBeTruthy();

    const table = screen.getByRole('table');
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(3);
    const columns = within(rows[0] as HTMLElement)
      .getAllByRole('columnheader')
      .map((th) => th.textContent);
    expect(columns).toEqual(['Number', 'Date', 'Amount', 'Status', 'PDF']);
    const paidRow = within(table).getByText('CD/26-27/000001').closest('tr') as HTMLElement;
    expect(within(paidRow).getByText('12 Mar 2026')).toBeTruthy();
    expect(within(paidRow).getByText('₹12,34,567.89')).toBeTruthy();
    expect(within(paidRow).getByText('Paid')).toBeTruthy();
    const pdf = within(paidRow).getByRole('link', {
      name: 'Download invoice CD/26-27/000001 (PDF)',
    });
    expect(pdf.getAttribute('href')).toBe('/w/chennai-solo/billing/invoices/inv-1/pdf');
    const issuedRow = within(table).getByText('CD/26-27/000002').closest('tr') as HTMLElement;
    expect(within(issuedRow).getByText(en.invoices.preparing)).toBeTruthy();
    expect(within(issuedRow).queryByRole('link')).toBeNull();
    expect(screen.getByRole('button', { name: en.plan.change }).hasAttribute('disabled')).toBe(
      true,
    );
  });

  it.each(['advocate', 'junior', 'clerk', 'viewer'] as const)(
    'shows the billing permission-denied state to a %s without loading billing',
    async (role) => {
      if (page.context) page.context.role = role;
      await renderPage();
      expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
        catalogs.en.shell.permissionDenied.title,
      );
      const denied = document.querySelector('[data-pattern-state="permission-denied"]');
      expect(denied?.textContent).toContain('Only workspace owners can manage billing.');
      expect(withWorkspace).not.toHaveBeenCalled();
    },
  );

  it('shows the error state with Try again when loading fails', async () => {
    page.fail = true;
    await renderPage();
    expect(screen.getByRole('alert').textContent).toContain(en.error.title);
    fireEvent.click(screen.getByRole('button', { name: en.error.retry }));
    expect(router.refresh).toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalled();
  });

  it('previews the loading and error states in development only', async () => {
    await renderPage({ __state: 'loading' });
    expect(document.querySelector('[data-slot="billing-skeleton"]')).not.toBeNull();
    cleanup();
    await renderPage({ __state: 'error' });
    expect(screen.getByRole('alert').textContent).toContain(en.error.title);
    expect(logger.error).not.toHaveBeenCalled();
    cleanup();
    page.dev = false;
    await renderPage({ __state: 'error' });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('renders the shell offline banner above the billing content', async () => {
    const tree = (await BillingPage({
      params: Promise.resolve({ slug: WORKSPACE.slug }),
      searchParams: Promise.resolve({}),
    })) as ReactElement<{ children: ReactElement[] }>;
    expect(tree.props.children[0]?.type).toBe(ShellOfflineBanner);
  });

  it('shows the empty invoices state', async () => {
    page.invoices = [];
    await renderPage();
    const empty = document.querySelector('[data-pattern-state="empty"]');
    expect(empty?.textContent).toContain(
      'No invoices yet. Your first invoice appears after your first payment.',
    );
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('shows the payment-failed alert with the grace countdown', async () => {
    page.subscription = subscriptionRow({
      status: 'past_due',
      dunningStartedAt: new Date(),
      graceUntil: new Date(Date.now() + 3 * 86_400_000),
    });
    await renderPage();
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain(en.banner.graceTitle);
    expect(alert.textContent).toMatch(/Access continues until \d{2} \w{3} \d{4} \(3 days left\)/);
    const update = within(alert).getByRole('button', { name: en.paymentMethod.update });
    expect(update.hasAttribute('disabled')).toBe(true);
    expect(screen.getByText(en.paymentMethod.failed)).toBeTruthy();
    expect(document.querySelector('[data-status="grace"]')?.textContent).toMatch(
      /^Past due: grace until \d{2} \w{3} \d{4}$/,
    );
  });

  it('shows UPI Autopay pending before the mandate is approved', async () => {
    page.subscription = subscriptionRow({ status: 'trialing' });
    await renderPage();
    expect(screen.getByText(en.paymentMethod.pending)).toBeTruthy();
  });

  it('shows the Junior state with upgrade cards for Advocate and Chamber', async () => {
    page.subscription = null;
    page.invoices = [];
    await renderPage();
    expect(screen.getByRole('heading', { name: en.junior.title })).toBeTruthy();
    const cards = [...document.querySelectorAll('[data-slot="billing-upgrade"]')];
    expect(cards.map((card) => card.getAttribute('data-plan-kind'))).toEqual([
      'advocate',
      'chamber',
    ]);
    expect(screen.getByRole('button', { name: 'Upgrade to Advocate' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Upgrade to Chamber' })).toBeTruthy();
    expect(screen.queryByText(en.paymentMethod.active)).toBeNull();
  });

  it('renders ta strings under the ta locale', async () => {
    page.locale = 'ta';
    await renderPage();
    const ta = catalogs.ta.billing;
    const text = document.body.textContent;
    expect(text).toContain(ta.title);
    expect(text).toContain(ta.paymentMethod.active);
    expect(text).toContain(ta.plan.gstNote);
    for (const leak of [en.paymentMethod.active, en.plan.gstNote, en.seats.title]) {
      expect(text).not.toContain(leak);
    }
  });
});

describe('billing route boundaries', () => {
  it('the error boundary reports the error and retries with reset', () => {
    const reset = vi.fn();
    withIntl(<BillingErrorBoundary error={new Error('boom')} reset={reset} />);
    expect(screen.getByRole('alert').textContent).toContain(en.error.title);
    fireEvent.click(screen.getByRole('button', { name: en.error.retry }));
    expect(reset).toHaveBeenCalled();
    expect(reportError).toHaveBeenCalled();
    expect(screen.queryByText('boom')).toBeNull();
  });

  it('the loading boundary shows skeleton cards and rows', () => {
    withIntl(<BillingLoading />);
    expect(document.querySelectorAll('[data-slot="billing-skeleton-card"]')).toHaveLength(3);
    expect(document.querySelectorAll('[data-slot="billing-skeleton-row"]')).toHaveLength(4);
  });
});
