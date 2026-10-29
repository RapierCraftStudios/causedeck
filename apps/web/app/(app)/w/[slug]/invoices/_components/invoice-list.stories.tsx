// Fees and invoices (#871, #83 part 4): the list with a proposal and a final invoice, empty,
// clerk view, offline, the route's loading, error and denied states, the editor with its GST
// gate and shortcuts, the preview and the ledger. Actions are mocked and every name, id and
// amount is fictional. Export names carry the `Fees` prefix: story names are unique across apps/web.
import type { FeeAgreementView, FeeInvoiceRow, LedgerEntryView } from '@causedeck/core/fees';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, screen, userEvent } from 'storybook/test';

import { PermissionDeniedPage } from '../../../../../../components/shell/permission-denied-page.tsx';
import type { Result } from '../../../../../../lib/safe-action.ts';
import InvoicesError from '../error.tsx';
import InvoicesLoading from '../loading.tsx';

import { FeeAgreementForm } from './fee-agreement-form.tsx';
import { FeeProposalCard } from './fee-proposal-card.tsx';
import type { FeesActions } from './fees-actions.ts';
import { FeesGatedNotice } from './gated-notice.tsx';
import { InvoiceEditor } from './invoice-editor.tsx';
import { InvoiceList } from './invoice-list.tsx';
import { GstReviewBanner, InvoicePreview } from './invoice-preview.tsx';
import { LedgerTable } from './ledger-table.tsx';

type Saved = Result<{ id: string; number?: string; status: string }>;
const saved = (): Promise<Saved> =>
  Promise.resolve({ ok: true, data: { id: 'i', status: 'draft' } });
const PREPARED = {
  invoice: {
    lines: [
      {
        description: 'Appearance, synthetic matter',
        quantity: 2,
        unitPricePaise: 500000,
        amountPaise: 1000000,
      },
    ],
    taxablePaise: 1000000,
    cgst: 90000,
    sgst: 90000,
    igst: 0,
    rcmPaise: 0,
    totalPaise: 1180000,
  },
  gstUnreviewed: true,
};
const actions = (): FeesActions => ({
  createAgreement: fn(saved),
  setAgreementStatus: fn(saved),
  preview: fn(() => Promise.resolve({ ok: true as const, data: PREPARED as never })),
  saveDraft: fn(saved),
  discardDraft: fn(() => Promise.resolve({ ok: true as const, data: { id: 'i' } })),
  issue: fn(saved),
});

const MATTER = '00000000-0000-4000-8000-0000000a0001';
const PERSON = '00000000-0000-4000-8000-0000000a0002';
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
} as unknown as FeeAgreementView;
const INVOICE = {
  id: '00000000-0000-4000-8000-0000000d0001',
  matterId: MATTER,
  personId: PERSON,
  number: 'FE/26-27/000001',
  status: 'issued',
  totalPaise: 1180000,
} as unknown as FeeInvoiceRow;
const LEDGER = [
  {
    id: 'l1',
    kind: 'fee',
    direction: 'debit',
    amountPaise: 1180000,
    description: 'Invoice FE/26-27/000001',
    occurredOn: '2026-05-01',
  },
  {
    id: 'l2',
    kind: 'receipt',
    direction: 'credit',
    amountPaise: 500000,
    description: 'Cheque received',
    occurredOn: '2026-05-09',
  },
] as unknown as LedgerEntryView[];

const meta = {
  title: 'Fees/InvoiceList',
  component: InvoiceList,
  args: {
    workspaceId: '00000000-0000-4000-8000-000000000001',
    basePath: '/w/demo/invoices',
    agreements: [AGREEMENT],
    invoices: [INVOICE],
    canWrite: true,
    actions: actions(),
    forceOffline: false,
  },
} satisfies Meta<typeof InvoiceList>;

export default meta;
type Story = StoryObj<typeof meta>;

export const FeesListDefault: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByText('₹1,23,456.00')).toBeVisible();
    await expect(canvas.getByText('FE/26-27/000001')).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'Activate' })).toBeEnabled();
  },
};

export const FeesListEmpty: Story = {
  args: { agreements: [], invoices: [] },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('No fee agreements yet')).toBeVisible();
    await expect(canvas.getByText('No invoices yet')).toBeVisible();
  },
};

export const FeesListGatedNotice: Story = {
  render: (args) => (
    <div className="flex flex-col gap-4">
      <FeesGatedNotice />
      <InvoiceList {...args} />
    </div>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByText(/Prepared for you to review and send yourself/)).toBeVisible();
  },
};

/** A role that may read but not write: no New, no Activate. */
export const FeesListReadOnly: Story = {
  args: { canWrite: false },
  play: async ({ canvas }) => {
    await expect(canvas.queryByRole('button', { name: 'New fee agreement' })).toBeNull();
    await expect(canvas.queryByRole('button', { name: 'Activate' })).toBeNull();
  },
};

export const FeesListOffline: Story = {
  args: { forceOffline: true },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: 'New fee agreement' })).toBeDisabled();
    await expect(canvas.getByRole('button', { name: 'Activate' })).toBeDisabled();
  },
};

/** The route's skeleton (loading.tsx). */
export const FeesListLoading: Story = {
  render: () => <InvoicesLoading />,
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Loading fees and invoices')).toBeInTheDocument();
  },
};

/** The route's error boundary (error.tsx). */
export const FeesListError: Story = {
  render: () => <InvoicesError error={new Error('boom')} reset={fn()} />,
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Could not load fees and invoices')).toBeVisible();
  },
};

/** A role without access sees the permission-denied page. */
export const FeesListDenied: Story = {
  render: () => <PermissionDeniedPage />,
};

export const FeesNewInvoiceShortcut: Story = {
  play: async () => {
    // `n` navigates; the dialog opens from the button and closes with Esc.
    await userEvent.keyboard('{Escape}');
  },
};

export const FeesAgreementFormOpen: Story = {
  render: (args) => (
    <FeeAgreementForm
      workspaceId={args.workspaceId}
      open
      onOpenChange={fn()}
      create={args.actions.createAgreement}
    />
  ),
  play: async () => {
    await expect(await screen.findByRole('dialog')).toBeVisible();
    await expect(screen.getByLabelText(/Matter ID/)).toBeVisible();
    await userEvent.keyboard('{Escape}');
  },
};

export const FeesProposalCard: Story = {
  render: (args) => (
    <ul>
      <FeeProposalCard agreement={AGREEMENT} canWrite busy={false} onStatus={fn()} />
      <FeeProposalCard
        agreement={{ ...AGREEMENT, id: 'b', status: 'active' }}
        canWrite={args.canWrite}
        busy={false}
        onStatus={fn()}
      />
    </ul>
  ),
  play: async ({ canvas }) => {
    await expect(
      canvas.getByText('A proposal: nothing is agreed until you activate it.'),
    ).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'End agreement' })).toBeVisible();
  },
};

const EDITOR_ACTIONS = actions();
const editor = (isOwner: boolean, forceOffline = false) => (
  <InvoiceEditor
    workspaceId="00000000-0000-4000-8000-000000000001"
    basePath="/w/demo/invoices"
    canWrite
    isOwner={isOwner}
    forceOffline={forceOffline}
    actions={EDITOR_ACTIONS}
    initial={{
      matterId: MATTER,
      personId: PERSON,
      placeOfSupplyStateCode: '29',
      supplierName: 'Synthetic Chambers',
      lines: [
        {
          description: 'Appearance, synthetic matter',
          quantity: 2,
          unitPricePaise: 500000,
          gstTreatment: 'forward_charge',
        },
      ],
    }}
  />
);

/** The owner's path: preview, see the unreviewed-GST banner, acknowledge, then mark final. */
export const FeesEditorOwnerGate: Story = {
  render: () => editor(true),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: 'Mark final' })).toBeDisabled();
    await userEvent.click(canvas.getByRole('button', { name: 'Preview' }));
    await expect(await canvas.findByText(/GST treatment not yet counsel-reviewed/)).toBeVisible();
    await userEvent.click(canvas.getByRole('checkbox'));
    await expect(canvas.getByRole('button', { name: 'Mark final' })).toBeEnabled();
  },
};

/** An advocate cannot mark final while GST is unreviewed. */
export const FeesEditorAdvocate: Story = {
  render: () => editor(false),
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Preview' }));
    await expect(
      await canvas.findByText('Only an owner can mark an invoice final while GST is unreviewed.'),
    ).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'Mark final' })).toBeDisabled();
  },
};

export const FeesEditorOffline: Story = {
  render: () => editor(true, true),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: 'Save draft' })).toBeDisabled();
  },
};

export const FeesEditorSaveShortcut: Story = {
  render: () => editor(true),
  play: async ({ canvas }) => {
    await userEvent.type(canvas.getByLabelText(/Your state code/), '29');
    await userEvent.keyboard('{Control>}s{/Control}');
    await expect(EDITOR_ACTIONS.saveDraft).toHaveBeenCalled();
  },
};

export const FeesPreview: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      <GstReviewBanner />
      <InvoicePreview
        supplierName="Synthetic Chambers"
        matterId={MATTER}
        personId={PERSON}
        lines={PREPARED.invoice.lines}
        totals={PREPARED.invoice}
        gstUnreviewed
      />
    </div>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getAllByText('₹11,800.00').length).toBeGreaterThan(0);
  },
};

export const FeesLedger: Story = {
  render: () => <LedgerTable entries={LEDGER} balancePaise={680000} />,
  play: async ({ canvas }) => {
    await expect(canvas.getByText('The client owes ₹6,800.00')).toBeVisible();
    await expect(canvas.getByText(/cannot start a payment/)).toBeVisible();
  },
};

export const FeesLedgerEmpty: Story = {
  render: () => <LedgerTable entries={[]} balancePaise={0} />,
  play: async ({ canvas }) => {
    await expect(canvas.getByText('No ledger entries')).toBeVisible();
  },
};

/** The client has paid more than they owe: the summary says so in words. */
export const FeesLedgerInCredit: Story = {
  render: () => <LedgerTable entries={LEDGER} balancePaise={-250000} />,
  play: async ({ canvas }) => {
    await expect(canvas.getByText('The client is in credit by ₹2,500.00')).toBeVisible();
  },
};

/** Debits and credits cancel out. */
export const FeesLedgerSettled: Story = {
  render: () => <LedgerTable entries={LEDGER} balancePaise={0} />,
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Nothing is owed')).toBeVisible();
  },
};
