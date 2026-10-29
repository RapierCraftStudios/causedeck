// @vitest-environment jsdom
// The fees and invoices surface (#871, #83 part 4): the pages (flag off is a 404, a denied load is
// the permission page, the standing notices show, a clerk is denied), the actions (flag off is
// NOT_FOUND before core runs; a clerk is denied) and the components (the list and its shortcut,
// the editor's save and final shortcuts, the GST gate, the ledger balance).
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppSession } from '../lib/auth.ts';
import type { WorkspaceContext } from '../lib/workspace-context.ts';

import { catalogs, fakeGetTranslations } from './helpers/intl.ts';
import { testWorkspaceContext } from './helpers/workspace.ts';

const WS = '00000000-0000-4000-8000-00000000a001';
const USER = '00000000-0000-4000-8000-0000000b0101';
const MATTER = '00000000-0000-4000-8000-0000000a0001';
const PERSON = '00000000-0000-4000-8000-0000000a0002';
const INVOICE = '00000000-0000-4000-8000-0000000d0001';

const state = vi.hoisted(
  (): { context: WorkspaceContext | null; flag: boolean; session: AppSession | null } => ({
    context: null,
    flag: true,
    session: null,
  }),
);
const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
const runtime = vi.hoisted(() => ({
  memberRoleFor: vi.fn(() => Promise.resolve('advocate')),
  ownerGraceFor: vi.fn(() => Promise.resolve(null)),
  inWorkspace: vi.fn((_scope: unknown, fn: (tx: unknown) => Promise<unknown>) => fn({ tx: true })),
  recordAccessDeniedFor: vi.fn(() => Promise.resolve()),
}));
const fees = vi.hoisted(() => ({
  listFeeAgreements: vi.fn((): Promise<unknown[]> => Promise.resolve([])),
  listInvoices: vi.fn((): Promise<unknown[]> => Promise.resolve([])),
  getInvoice: vi.fn((): Promise<unknown> => Promise.resolve({})),
  listLedger: vi.fn((): Promise<unknown[]> => Promise.resolve([])),
  getClientBalance: vi.fn(() => Promise.resolve(0)),
  createFeeAgreement: vi.fn(),
  setFeeAgreementStatus: vi.fn(() => Promise.resolve({ id: 'a1', status: 'active' })),
  prepareFeeInvoice: vi.fn(),
  createDraftInvoice: vi.fn(() => Promise.resolve({ id: 'i1', status: 'draft' })),
  updateDraftInvoice: vi.fn(),
  discardDraftInvoice: vi.fn(),
  issueInvoice: vi.fn(() =>
    Promise.resolve({ id: 'i1', status: 'issued', number: 'FE/26-27/000001' }),
  ),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => router,
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));
vi.mock('next-intl/server', () => ({
  getLocale: () => Promise.resolve('en'),
  getTranslations: (namespace?: string) => fakeGetTranslations('en')(namespace),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('../lib/auth.ts', () => ({
  getSession: () => Promise.resolve(state.session),
  requireSession: () => Promise.resolve(state.session),
}));
vi.mock('../lib/workspace-loader.ts', () => ({
  getWorkspaceContext: () => Promise.resolve(state.context),
}));
vi.mock('../lib/env.ts', () => ({ isDev: () => false }));
vi.mock('../lib/flags.ts', () => ({
  requireWorkspaceFlag: () => {
    if (!state.flag) throw new Error('NEXT_NOT_FOUND');
    return Promise.resolve();
  },
}));
vi.mock('../src/health.ts', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@causedeck/flags/server', () => ({ isEnabled: () => Promise.resolve(state.flag) }));
vi.mock('@causedeck/core/runtime', () => runtime);
vi.mock('@causedeck/core/fees', () => fees);
// Async server components cannot render under jsdom; stand in with the same copy.
vi.mock('../app/(app)/w/[slug]/invoices/_components/gated-notice.tsx', () => ({
  FeesGatedNotice: () => <p>{catalogs.en.fees.gatedNotice}</p>,
}));

// Core modules load one after the other: a Promise.all of them bypasses vi.mock.
const { default: InvoicesPage } = await import('../app/(app)/w/[slug]/invoices/page.tsx');
const { default: NewInvoicePage } = await import('../app/(app)/w/[slug]/invoices/new/page.tsx');
const { default: InvoicePage } = await import('../app/(app)/w/[slug]/invoices/[id]/page.tsx');
const actions = await import('../app/(app)/w/[slug]/invoices/actions.ts');
const { InvoiceList } = await import('../app/(app)/w/[slug]/invoices/_components/invoice-list.tsx');
const { InvoiceEditor } =
  await import('../app/(app)/w/[slug]/invoices/_components/invoice-editor.tsx');
const { LedgerTable } = await import('../app/(app)/w/[slug]/invoices/_components/ledger-table.tsx');
const { formatPaise, rupeesToPaise } = await import('../lib/fees/money.ts');

const en = catalogs.en.fees;
const AGREEMENT = {
  id: '00000000-0000-4000-8000-0000000e0001',
  matterId: MATTER,
  personId: PERSON,
  basis: 'fixed',
  amountPaise: 12345600,
  gstTreatment: 'forward_charge',
  status: 'draft',
  startsOn: '2026-04-01',
  endsOn: null,
};
const INVOICE_ROW = {
  id: INVOICE,
  matterId: MATTER,
  personId: PERSON,
  number: 'FE/26-27/000001',
  status: 'issued',
  totalPaise: 11800,
};

const withIntl = (ui: ReactNode) =>
  render(
    <NextIntlClientProvider locale="en" messages={catalogs.en} timeZone="Asia/Kolkata">
      {ui}
    </NextIntlClientProvider>,
  );
const renderPage = async () =>
  withIntl(
    await InvoicesPage({
      params: Promise.resolve({ slug: 'demo' }),
      searchParams: Promise.resolve({}),
    }),
  );

beforeEach(() => {
  state.context = testWorkspaceContext('demo', 'advocate');
  state.flag = true;
  state.session = {
    session: { id: 's1' },
    user: { id: USER, name: 'Asha', email: 'a@x.test', twoFactorEnabled: true },
  } as unknown as AppSession;
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('money', () => {
  it('groups rupees the Indian way and converts typed amounts to paise', () => {
    expect(formatPaise(12345600)).toBe('₹1,23,456.00');
    expect(rupeesToPaise('1,500.5')).toBe(150050);
    expect(rupeesToPaise('12.345')).toBeNull();
    expect(rupeesToPaise('abc')).toBeNull();
  });
});

describe('invoices pages', () => {
  it('are a 404 while invoices.enabled is off, and core never runs', async () => {
    state.flag = false;
    await expect(renderPage()).rejects.toThrow('NEXT_NOT_FOUND');
    await expect(NewInvoicePage({ params: Promise.resolve({ slug: 'demo' }) })).rejects.toThrow(
      'NEXT_NOT_FOUND',
    );
    expect(fees.listInvoices).not.toHaveBeenCalled();
  });

  it('shows the notice and both empty states to an advocate', async () => {
    await renderPage();
    expect(document.querySelector('[data-route="invoices"]')).not.toBeNull();
    expect(screen.getByText(en.gatedNotice)).toBeTruthy();
    expect(screen.getByText(en.agreements.empty.title)).toBeTruthy();
    expect(screen.getByText(en.invoices.empty.title)).toBeTruthy();
  });

  it('shows the permission page to a clerk without reading any fee row', async () => {
    state.context = testWorkspaceContext('demo', 'clerk');
    await renderPage();
    expect(document.querySelector('[data-route="invoices"]')).toBeNull();
    expect(fees.listInvoices).not.toHaveBeenCalled();
  });

  it('shows the permission page when core denies the load', async () => {
    fees.listFeeAgreements.mockRejectedValueOnce(
      Object.assign(new Error('no'), { code: 'FORBIDDEN' }),
    );
    await renderPage();
    expect(document.querySelector('[data-route="invoices"]')).toBeNull();
  });

  it('throws to the error boundary when the load fails', async () => {
    fees.listInvoices.mockRejectedValueOnce(new Error('db down'));
    await expect(renderPage()).rejects.toThrow('Could not load the fee records');
  });

  it('opens a final invoice read-only with its ledger', async () => {
    fees.getInvoice.mockResolvedValueOnce({
      ...INVOICE_ROW,
      taxablePaise: 10000,
      taxPaise: 1800,
      lines: [
        { description: 'Appearance', quantity: 1, unitPricePaise: 10000, amountPaise: 10000 },
      ],
    });
    withIntl(await InvoicePage({ params: Promise.resolve({ slug: 'demo', id: INVOICE }) }));
    expect(screen.getByText(en.editor.final)).toBeTruthy();
    expect(screen.getByText('Appearance')).toBeTruthy();
    expect(screen.getByText(en.ledger.empty.title)).toBeTruthy();
    expect(screen.queryByRole('button', { name: en.editor.save })).toBeNull();
  });

  it('is a 404 for an unknown invoice', async () => {
    fees.getInvoice.mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'NOT_FOUND' }));
    await expect(
      InvoicePage({ params: Promise.resolve({ slug: 'demo', id: INVOICE }) }),
    ).rejects.toThrow('NEXT_NOT_FOUND');
  });
});

describe('fee actions', () => {
  const draft = {
    workspaceId: WS,
    invoice: {
      matterId: MATTER,
      personId: PERSON,
      placeOfSupplyStateCode: '29',
      lines: [
        {
          description: 'Appearance',
          quantity: 1,
          unitPricePaise: 10000,
          amountPaise: 10000,
          gstTreatment: 'forward_charge',
        },
      ],
    },
    supplier: { name: 'Chambers', stateCode: '29' },
  };

  it('are NOT_FOUND while the flag is off, and core never runs', async () => {
    state.flag = false;
    expect(await actions.saveInvoiceDraftAction(draft)).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });
    expect(
      await actions.issueInvoiceAction({
        workspaceId: WS,
        invoiceId: INVOICE,
        supplier: draft.supplier,
      }),
    ).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    expect(fees.createDraftInvoice).not.toHaveBeenCalled();
    expect(fees.issueInvoice).not.toHaveBeenCalled();
  });

  it('save returns only the id and status; issue adds the number', async () => {
    expect(await actions.saveInvoiceDraftAction(draft)).toEqual({
      ok: true,
      data: { id: 'i1', status: 'draft' },
    });
    expect(
      await actions.issueInvoiceAction({
        workspaceId: WS,
        invoiceId: INVOICE,
        supplier: draft.supplier,
      }),
    ).toEqual({ ok: true, data: { id: 'i1', status: 'issued', number: 'FE/26-27/000001' } });
  });

  it('are denied for a clerk', async () => {
    runtime.memberRoleFor.mockResolvedValueOnce('clerk');
    const result = await actions.saveInvoiceDraftAction(draft);
    expect(result).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(fees.createDraftInvoice).not.toHaveBeenCalled();
  });
});

describe('invoice list', () => {
  const done = () => Promise.resolve({ ok: true as const, data: { id: 'a', status: 'active' } });
  const renderList = (over: { canWrite?: boolean; forceOffline?: boolean } = {}) => {
    const setAgreementStatus = vi.fn(done);
    withIntl(
      <InvoiceList
        workspaceId={WS}
        basePath="/w/demo/invoices"
        agreements={[AGREEMENT] as never}
        invoices={[INVOICE_ROW] as never}
        canWrite={over.canWrite ?? true}
        forceOffline={over.forceOffline ?? false}
        actions={{ createAgreement: vi.fn(done), setAgreementStatus }}
      />,
    );
    return setAgreementStatus;
  };

  it('lists the proposal and the invoice with Indian-grouped amounts', () => {
    renderList();
    expect(screen.getByText('₹1,23,456.00')).toBeTruthy();
    expect(screen.getByText('₹118.00')).toBeTruthy();
    expect(screen.getByText(en.agreement.proposedNote)).toBeTruthy();
  });

  it('activates a proposal', async () => {
    const setStatus = renderList();
    fireEvent.click(screen.getByRole('button', { name: en.agreement.activate }));
    await waitFor(() => {
      expect(setStatus).toHaveBeenCalledWith({
        workspaceId: WS,
        agreementId: AGREEMENT.id,
        status: 'active',
      });
    });
  });

  it('opens a new invoice with n, and not while a dialog is open', async () => {
    renderList();
    fireEvent.keyDown(document.body, { key: 'n' });
    expect(router.push).toHaveBeenCalledWith('/w/demo/invoices/new');
    router.push.mockClear();
    fireEvent.click(screen.getByRole('button', { name: en.agreementForm.trigger }));
    expect(await screen.findByRole('dialog')).toBeTruthy();
    fireEvent.keyDown(document.body, { key: 'n' });
    expect(router.push).not.toHaveBeenCalled();
  });

  it('is read-only offline and shows no write controls to a clerk', () => {
    renderList({ forceOffline: true });
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: en.agreementForm.trigger }).disabled,
    ).toBe(true);
    expect(document.querySelector('[data-fees-offline]')).not.toBeNull();
    cleanup();
    renderList({ canWrite: false });
    expect(screen.queryByRole('button', { name: en.agreementForm.trigger })).toBeNull();
    expect(screen.queryByRole('button', { name: en.agreement.activate })).toBeNull();
  });
});

describe('invoice editor', () => {
  const prepared = {
    invoice: {
      lines: [
        { description: 'Appearance', quantity: 1, unitPricePaise: 10000, amountPaise: 10000 },
      ],
      taxablePaise: 10000,
      cgst: 900,
      sgst: 900,
      igst: 0,
      rcmPaise: 0,
      totalPaise: 11800,
    },
    gstUnreviewed: true,
  };
  const saved = () =>
    Promise.resolve({ ok: true as const, data: { id: INVOICE, status: 'draft' } });
  const renderEditor = (isOwner: boolean) => {
    type Call<T> = (input: unknown) => Promise<{ ok: true; data: T }>;
    const a = {
      preview: vi.fn<Call<never>>(() => Promise.resolve({ ok: true, data: prepared as never })),
      saveDraft: vi.fn<Call<{ id: string; status: string }>>(() => saved()),
      discardDraft: vi.fn(),
      issue: vi.fn<Call<{ id: string; status: string }>>(() =>
        Promise.resolve({ ok: true, data: { id: INVOICE, status: 'issued' } }),
      ),
    };
    withIntl(
      <InvoiceEditor
        workspaceId={WS}
        basePath="/w/demo/invoices"
        canWrite
        isOwner={isOwner}
        actions={a}
        initial={{
          matterId: MATTER,
          personId: PERSON,
          placeOfSupplyStateCode: '29',
          supplierName: 'Chambers',
          lines: [
            {
              description: 'Appearance',
              quantity: 1,
              unitPricePaise: 10000,
              gstTreatment: 'forward_charge',
            },
          ],
        }}
      />,
    );
    fireEvent.change(document.querySelector('[data-fees-field="supplier-state"]') as Element, {
      target: { value: '29' },
    });
    return a;
  };

  it('saves the draft with Cmd+S, even while typing', async () => {
    const a = renderEditor(true);
    fireEvent.keyDown(document.querySelector('[data-fees-field="line-description"]') as Element, {
      key: 's',
      ctrlKey: true,
    });
    await waitFor(() => {
      expect(a.saveDraft).toHaveBeenCalledTimes(1);
    });
    expect(a.saveDraft.mock.calls[0]?.[0]).toMatchObject({
      workspaceId: WS,
      invoice: { lines: [{ amountPaise: 10000, unitPricePaise: 10000 }] },
    });
    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith(`/w/demo/invoices/${INVOICE}`);
    });
  });

  it('keeps Mark final off until the owner has previewed and acknowledged unreviewed GST', async () => {
    const a = renderEditor(true);
    const final = () => screen.getByRole<HTMLButtonElement>('button', { name: en.editor.issue });
    expect(final().disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: en.editor.preview }));
    expect(await screen.findByText(en.gstBanner)).toBeTruthy();
    expect(final().disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(final().disabled).toBe(false);
    fireEvent.keyDown(document.body, { key: 'Enter', ctrlKey: true });
    await waitFor(() => {
      expect(a.issue).toHaveBeenCalledTimes(1);
    });
    expect(a.issue.mock.calls[0]?.[0]).toMatchObject({
      invoiceId: INVOICE,
      acknowledgeUnreviewedGst: true,
    });
  });

  it('tells an advocate that only an owner can mark it final while GST is unreviewed', async () => {
    renderEditor(false);
    fireEvent.click(screen.getByRole('button', { name: en.editor.preview }));
    expect(await screen.findByText(en.editor.ownerOnly)).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: en.editor.issue }).disabled).toBe(
      true,
    );
  });
});

describe('ledger table', () => {
  const entry = (id: string, direction: 'debit' | 'credit', amountPaise: number) => ({
    id,
    kind: direction === 'debit' ? 'fee' : 'receipt',
    direction,
    amountPaise,
    description: id,
    occurredOn: '2026-05-01',
  });

  it('shows a running balance, the owed summary and the no-payment notice', () => {
    withIntl(
      <LedgerTable
        entries={[entry('Invoice', 'debit', 100000), entry('Cheque', 'credit', 40000)] as never}
        balancePaise={60000}
      />,
    );
    expect(screen.getByText(en.ledgerNotice)).toBeTruthy();
    expect(screen.getByText('₹1,000.00', { selector: 'td:last-child' })).toBeTruthy();
    expect(screen.getByText('₹600.00', { selector: 'td:last-child' })).toBeTruthy();
    expect(screen.getByText('The client owes ₹600.00')).toBeTruthy();
  });
});
