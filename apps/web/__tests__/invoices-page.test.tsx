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
  listFeeClients: vi.fn((): Promise<unknown[]> => Promise.resolve([])),
  getFeeSupplierState: vi.fn((): Promise<string | null> => Promise.resolve(null)),
  setFeeSupplierState: vi.fn((): Promise<string> => Promise.resolve('29')),
  recordPayment: vi.fn(() => Promise.resolve({ id: 'i1', status: 'paid' })),
  issueCreditNote: vi.fn(() => Promise.resolve({ id: 'i1', status: 'issued' })),
  recordClientExpense: vi.fn(() => Promise.resolve({ id: 'l1', kind: 'disbursement' })),
  recordClientReceipt: vi.fn(() => Promise.resolve({ id: 'l2', kind: 'receipt' })),
}));
const graph = vi.hoisted(() => ({
  listMatters: vi.fn((): Promise<{ items: unknown[]; nextCursor: null }> =>
    Promise.resolve({ items: [], nextCursor: null }),
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
vi.mock('@causedeck/core/matter-graph', () => graph);
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
const { PaymentForm, CreditNoteForm, LedgerEntryForm } =
  await import('../app/(app)/w/[slug]/invoices/_components/fee-record-forms.tsx');
const { FeeAgreementForm } =
  await import('../app/(app)/w/[slug]/invoices/_components/fee-agreement-form.tsx');
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

describe('pickers and the stored supplier state (#963)', () => {
  it('offers the matters and clients the actor may see, and the stored state code', async () => {
    graph.listMatters.mockResolvedValueOnce({
      items: [{ id: MATTER, title: 'Synthetic v. Fictional' }],
      nextCursor: null,
    });
    fees.listFeeClients.mockResolvedValueOnce([{ id: PERSON, name: 'Asha Fictional' }]);
    fees.getFeeSupplierState.mockResolvedValueOnce('33');
    withIntl(await NewInvoicePage({ params: Promise.resolve({ slug: 'demo' }) }));
    expect(screen.getByRole('option', { name: 'Synthetic v. Fictional' })).toBeTruthy();
    expect(screen.getAllByRole('option', { name: 'Asha Fictional' })).toHaveLength(1);
    expect(
      (document.querySelector('[data-fees-field="supplier-state"]') as HTMLInputElement).value,
    ).toBe('33');
  });

  it('still renders, with a hint, when the pickers cannot load', async () => {
    graph.listMatters.mockRejectedValueOnce(new Error('db down'));
    withIntl(await NewInvoicePage({ params: Promise.resolve({ slug: 'demo' }) }));
    expect(screen.getAllByText(en.picker.none).length).toBeGreaterThan(0);
    expect(
      (document.querySelector('[data-fees-field="supplier-state"]') as HTMLInputElement).value,
    ).toBe('');
  });

  it('stores the supplier state when a draft is saved, and a failure there does not fail the save', async () => {
    const input = {
      workspaceId: WS,
      invoice: {
        matterId: MATTER,
        personId: PERSON,
        placeOfSupplyStateCode: '29',
        lines: [
          {
            description: 'Appearance',
            quantity: 1,
            unitPricePaise: 100,
            amountPaise: 100,
            gstTreatment: 'forward_charge',
          },
        ],
      },
      supplier: { name: 'Chambers', stateCode: '33' },
    };
    expect(await actions.saveInvoiceDraftAction(input)).toMatchObject({ ok: true });
    expect(fees.setFeeSupplierState).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      stateCode: '33',
    });
    fees.setFeeSupplierState.mockRejectedValueOnce(new Error('settings down'));
    expect(await actions.saveInvoiceDraftAction(input)).toMatchObject({ ok: true });
  });

  it('shows the agreement form with the pickers and refuses an empty choice', async () => {
    const create = vi.fn<
      (input: unknown) => Promise<{ ok: true; data: { id: string; status: string } }>
    >(() => Promise.resolve({ ok: true, data: { id: 'a', status: 'x' } }));
    withIntl(
      <FeeAgreementForm
        workspaceId={WS}
        open
        onOpenChange={vi.fn()}
        create={create}
        matters={[{ id: MATTER, label: 'Synthetic v. Fictional' }]}
        clients={[{ id: PERSON, label: 'Asha Fictional' }]}
      />,
    );
    fireEvent.change(document.querySelector('[data-fees-field="amount"]') as Element, {
      target: { value: '1500' },
    });
    fireEvent.change(document.querySelector('[data-fees-field="starts"]') as Element, {
      target: { value: '2026-04-01' },
    });
    fireEvent.click(screen.getByRole('button', { name: en.agreementForm.submit }));
    expect(await screen.findByText(en.error.invalid)).toBeTruthy();
    expect(create).not.toHaveBeenCalled();
    fireEvent.change(document.querySelector('[data-fees-field="matter"]') as Element, {
      target: { value: MATTER },
    });
    fireEvent.change(document.querySelector('[data-fees-field="person"]') as Element, {
      target: { value: PERSON },
    });
    fireEvent.click(screen.getByRole('button', { name: en.agreementForm.submit }));
    await waitFor(() => {
      expect(create).toHaveBeenCalledTimes(1);
    });
    expect(create.mock.calls[0]?.[0]).toMatchObject({
      agreement: { matterId: MATTER, personId: PERSON, amountPaise: 150000 },
    });
  });
});

describe('payment, credit note and ledger actions (#963)', () => {
  const payment = {
    workspaceId: WS,
    payment: { invoiceId: INVOICE, amountPaise: 500, method: 'upi', receivedOn: '2026-11-03' },
  };
  const note = {
    workspaceId: WS,
    creditNote: {
      invoiceId: INVOICE,
      amountPaise: 500,
      reason: 'Fictional',
      occurredOn: '2026-11-03',
    },
  };
  const expense = {
    workspaceId: WS,
    expense: {
      personId: PERSON,
      amountPaise: 500,
      description: 'Fictional',
      occurredOn: '2026-11-03',
    },
  };
  const receipt = {
    workspaceId: WS,
    receipt: { personId: PERSON, amountPaise: 500, receivedOn: '2026-11-03' },
  };

  it('are NOT_FOUND while the flag is off, and core never runs', async () => {
    state.flag = false;
    for (const result of [
      await actions.recordPaymentAction(payment),
      await actions.issueCreditNoteAction(note),
      await actions.recordClientExpenseAction(expense),
      await actions.recordClientReceiptAction(receipt),
    ]) {
      expect(result).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    }
    expect(fees.recordPayment).not.toHaveBeenCalled();
    expect(fees.recordClientExpense).not.toHaveBeenCalled();
  });

  it('are denied for a clerk', async () => {
    for (const run of [
      () => actions.recordPaymentAction(payment),
      () => actions.issueCreditNoteAction(note),
      () => actions.recordClientExpenseAction(expense),
      () => actions.recordClientReceiptAction(receipt),
    ]) {
      runtime.memberRoleFor.mockResolvedValueOnce('clerk');
      expect(await run()).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    }
    expect(fees.recordPayment).not.toHaveBeenCalled();
    expect(fees.issueCreditNote).not.toHaveBeenCalled();
  });

  it('return only ids and status, and hand core the validated input', async () => {
    expect(await actions.recordPaymentAction(payment)).toEqual({
      ok: true,
      data: { id: 'i1', status: 'paid' },
    });
    expect(fees.recordPayment).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      payment.payment,
    );
    expect(await actions.issueCreditNoteAction(note)).toMatchObject({ ok: true });
    expect(await actions.recordClientExpenseAction(expense)).toEqual({
      ok: true,
      data: { id: 'l1', status: 'disbursement' },
    });
    expect(await actions.recordClientReceiptAction(receipt)).toEqual({
      ok: true,
      data: { id: 'l2', status: 'receipt' },
    });
  });

  it('refuse a malformed amount before core runs', async () => {
    expect(
      await actions.recordPaymentAction({
        ...payment,
        payment: { ...payment.payment, amountPaise: 1.5 },
      }),
    ).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
    expect(
      await actions.recordClientReceiptAction({
        ...receipt,
        receipt: { ...receipt.receipt, amountPaise: 0 },
      }),
    ).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
    expect(fees.recordPayment).not.toHaveBeenCalled();
    expect(fees.recordClientReceipt).not.toHaveBeenCalled();
  });

  it('maps core refusals to the action codes', async () => {
    fees.recordPayment.mockRejectedValueOnce(
      Object.assign(new Error('more than the balance'), {
        name: 'WorkspaceError',
        code: 'CONFLICT',
      }),
    );
    expect(await actions.recordPaymentAction(payment)).toMatchObject({
      ok: false,
      error: { code: 'CONFLICT' },
    });
  });
});

describe('record forms (#963)', () => {
  const ok = () => Promise.resolve({ ok: true as const, data: { id: 'x', status: 'paid' } });
  const field = (name: string) => document.querySelector(`[data-fees-field="${name}"]`) as Element;
  const type = (name: string, value: string) => {
    fireEvent.change(field(name), { target: { value } });
  };

  it('records a payment in paise and refreshes', async () => {
    const record = vi.fn(ok);
    const close = vi.fn();
    withIntl(
      <PaymentForm
        workspaceId={WS}
        invoiceId={INVOICE}
        open
        onOpenChange={close}
        record={record}
      />,
    );
    type('payment-amount', '1,500.50');
    type('payment-method', 'cheque');
    type('payment-reference', ' 000123 ');
    type('payment-date', '2026-11-03');
    fireEvent.click(screen.getByRole('button', { name: en.paymentForm.submit }));
    await waitFor(() => {
      expect(record).toHaveBeenCalledTimes(1);
    });
    expect(record).toHaveBeenCalledWith({
      workspaceId: WS,
      payment: {
        invoiceId: INVOICE,
        amountPaise: 150050,
        method: 'cheque',
        receivedOn: '2026-11-03',
        reference: '000123',
      },
    });
    await waitFor(() => {
      expect(router.refresh).toHaveBeenCalled();
    });
    expect(close).toHaveBeenCalledWith(false);
  });

  it('refuses a bad amount or a missing date on the page', async () => {
    const record = vi.fn(ok);
    withIntl(
      <PaymentForm
        workspaceId={WS}
        invoiceId={INVOICE}
        open
        onOpenChange={vi.fn()}
        record={record}
      />,
    );
    type('payment-amount', '12.345');
    type('payment-date', '2026-11-03');
    fireEvent.click(screen.getByRole('button', { name: en.paymentForm.submit }));
    expect(await screen.findByText(en.error.invalid)).toBeTruthy();
    expect(record).not.toHaveBeenCalled();
  });

  it('shows the server refusal as a translated message and keeps the form open', async () => {
    const record = vi.fn(() =>
      Promise.resolve({
        ok: false as const,
        error: { code: 'CONFLICT', message: 'raw server text' },
      }),
    );
    const close = vi.fn();
    withIntl(
      <PaymentForm
        workspaceId={WS}
        invoiceId={INVOICE}
        open
        onOpenChange={close}
        record={record as never}
      />,
    );
    type('payment-amount', '10');
    type('payment-date', '2026-11-03');
    fireEvent.click(screen.getByRole('button', { name: en.paymentForm.submit }));
    expect(await screen.findByText(en.error.conflict)).toBeTruthy();
    expect(screen.queryByText('raw server text')).toBeNull();
    expect(close).not.toHaveBeenCalled();
  });

  it('is off while offline, and submitting does nothing', () => {
    const record = vi.fn(ok);
    withIntl(
      <PaymentForm
        workspaceId={WS}
        invoiceId={INVOICE}
        open
        offline
        onOpenChange={vi.fn()}
        record={record}
      />,
    );
    expect(screen.getByText(en.offline)).toBeTruthy();
    const submit = screen.getByRole<HTMLButtonElement>('button', { name: en.paymentForm.submit });
    expect(submit.disabled).toBe(true);
    type('payment-amount', '10');
    type('payment-date', '2026-11-03');
    fireEvent.submit(submit.form as HTMLFormElement);
    expect(record).not.toHaveBeenCalled();
  });

  it('saves with Cmd+Enter', async () => {
    const record = vi.fn(ok);
    withIntl(
      <PaymentForm
        workspaceId={WS}
        invoiceId={INVOICE}
        open
        onOpenChange={vi.fn()}
        record={record}
      />,
    );
    type('payment-amount', '10');
    type('payment-date', '2026-11-03');
    fireEvent.keyDown(document.body, { key: 'Enter', ctrlKey: true });
    await waitFor(() => {
      expect(record).toHaveBeenCalledTimes(1);
    });
  });

  it('issues a credit note with a reason', async () => {
    const issue = vi.fn(ok);
    withIntl(
      <CreditNoteForm
        workspaceId={WS}
        invoiceId={INVOICE}
        open
        onOpenChange={vi.fn()}
        issue={issue}
      />,
    );
    type('credit-amount', '250');
    fireEvent.click(screen.getByRole('button', { name: en.creditNoteForm.submit }));
    expect(await screen.findByText(en.error.invalid)).toBeTruthy();
    expect(issue).not.toHaveBeenCalled();
    type('credit-reason', ' Fictional correction ');
    type('credit-date', '2026-11-04');
    fireEvent.click(screen.getByRole('button', { name: en.creditNoteForm.submit }));
    await waitFor(() => {
      expect(issue).toHaveBeenCalledTimes(1);
    });
    expect(issue).toHaveBeenCalledWith({
      workspaceId: WS,
      creditNote: {
        invoiceId: INVOICE,
        amountPaise: 25000,
        reason: 'Fictional correction',
        occurredOn: '2026-11-04',
      },
    });
  });

  it('records an expense (needs a description) and a receipt (reference optional)', async () => {
    const record = vi.fn(ok);
    const matters = [{ id: MATTER, label: 'Synthetic v. Fictional' }];
    withIntl(
      <LedgerEntryForm
        kind="expense"
        workspaceId={WS}
        personId={PERSON}
        matterId={MATTER}
        matters={matters}
        open
        onOpenChange={vi.fn()}
        record={record}
      />,
    );
    type('ledger-amount', '75');
    type('ledger-date', '2026-11-05');
    fireEvent.click(screen.getByRole('button', { name: en.expenseForm.submit }));
    expect(await screen.findByText(en.error.invalid)).toBeTruthy();
    type('ledger-text', 'Court fee');
    fireEvent.click(screen.getByRole('button', { name: en.expenseForm.submit }));
    await waitFor(() => {
      expect(record).toHaveBeenCalledTimes(1);
    });
    expect(record).toHaveBeenCalledWith({
      workspaceId: WS,
      expense: {
        personId: PERSON,
        matterId: MATTER,
        amountPaise: 7500,
        description: 'Court fee',
        occurredOn: '2026-11-05',
      },
    });
    cleanup();
    record.mockClear();
    withIntl(
      <LedgerEntryForm
        kind="receipt"
        workspaceId={WS}
        personId={PERSON}
        matters={matters}
        open
        onOpenChange={vi.fn()}
        record={record}
      />,
    );
    type('ledger-amount', '75');
    type('ledger-date', '2026-11-05');
    fireEvent.click(screen.getByRole('button', { name: en.receiptForm.submit }));
    await waitFor(() => {
      expect(record).toHaveBeenCalledTimes(1);
    });
    expect(record).toHaveBeenCalledWith({
      workspaceId: WS,
      receipt: { personId: PERSON, amountPaise: 7500, receivedOn: '2026-11-05' },
    });
  });

  it('shows the record buttons on a final invoice and hides them from a read-only role', async () => {
    const final = {
      ...INVOICE_ROW,
      taxablePaise: 10000,
      taxPaise: 1800,
      lines: [
        { description: 'Appearance', quantity: 1, unitPricePaise: 10000, amountPaise: 10000 },
      ],
    };
    fees.getInvoice.mockResolvedValueOnce(final);
    withIntl(await InvoicePage({ params: Promise.resolve({ slug: 'demo', id: INVOICE }) }));
    expect(screen.getByRole('button', { name: en.paymentForm.trigger })).toBeTruthy();
    expect(screen.getByRole('button', { name: en.creditNoteForm.trigger })).toBeTruthy();
    expect(screen.getByRole('button', { name: en.expenseForm.trigger })).toBeTruthy();
    cleanup();
    fees.getInvoice.mockResolvedValueOnce({ ...final, status: 'paid' });
    withIntl(await InvoicePage({ params: Promise.resolve({ slug: 'demo', id: INVOICE }) }));
    expect(screen.queryByRole('button', { name: en.paymentForm.trigger })).toBeNull();
    expect(screen.getByRole('button', { name: en.creditNoteForm.trigger })).toBeTruthy();
    cleanup();
    state.context = testWorkspaceContext('demo', 'viewer');
    fees.getInvoice.mockResolvedValueOnce(final);
    withIntl(await InvoicePage({ params: Promise.resolve({ slug: 'demo', id: INVOICE }) }));
    expect(screen.queryByRole('button', { name: en.paymentForm.trigger })).toBeNull();
  });
});
