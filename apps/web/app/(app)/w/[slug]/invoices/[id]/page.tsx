// `/w/[slug]/invoices/[id]` (#871, #83): one invoice. A draft opens in the editor; a final invoice
// is immutable, so it shows the invoice as stored and the client's ledger, with a note that a
// correction is a credit note. Flag off is a 404; a role below advocate sees the permission page.
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { PermissionDeniedPage } from '../../../../../../components/shell/permission-denied-page.tsx';
import { loadInvoice } from '../../../../../../lib/fees/fees-deps.ts';
import { requireWorkspaceFlag } from '../../../../../../lib/flags.ts';
import { can } from '../../../../../../lib/workspace-context.ts';
import { getWorkspaceContext } from '../../../../../../lib/workspace-loader.ts';
import { FeesGatedNotice } from '../_components/gated-notice.tsx';
import { InvoiceEditor } from '../_components/invoice-editor.tsx';
import { InvoicePreview } from '../_components/invoice-preview.tsx';
import { LedgerTable } from '../_components/ledger-table.tsx';
import {
  discardInvoiceDraftAction,
  issueInvoiceAction,
  previewInvoiceAction,
  saveInvoiceDraftAction,
} from '../actions.ts';

interface InvoicePageProps {
  params: Promise<{ slug: string; id: string }>;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('fees');
  return { title: t('invoices.title') };
}

export default async function InvoicePage({ params }: InvoicePageProps) {
  const { slug, id } = await params;
  const context = await getWorkspaceContext(slug);
  if (!context) notFound();
  await requireWorkspaceFlag('invoices.enabled', context);
  if (!can(context.role, 'fee.read')) return <PermissionDeniedPage />;

  const load = await loadInvoice(context, id);
  if (load.kind === 'denied') return <PermissionDeniedPage />;
  if (load.kind === 'notFound') notFound();
  if (load.kind === 'error') throw new Error('Could not load the invoice');

  const t = await getTranslations('fees');
  const { invoice, ledger, balancePaise } = load;
  const isDraft = invoice.status === 'draft';
  return (
    <div data-route="invoice" className="flex flex-col gap-6">
      <h1 className="font-serif text-2xl font-medium">
        {invoice.number ?? t('editor.titleDraft')}
      </h1>
      <FeesGatedNotice />
      {isDraft ? (
        <InvoiceEditor
          workspaceId={context.workspace.id}
          basePath={`/w/${slug}/invoices`}
          initial={{
            invoiceId: invoice.id,
            matterId: invoice.matterId,
            personId: invoice.personId,
            feeAgreementId: invoice.feeAgreementId,
            placeOfSupplyStateCode: invoice.placeOfSupplyStateCode,
            recipientGstin: invoice.recipientGstin,
            dueDate: invoice.dueDate,
            lines: invoice.lines,
            supplierName: context.workspace.name,
          }}
          canWrite={can(context.role, 'fee.write')}
          isOwner={context.role === 'owner'}
          actions={{
            preview: previewInvoiceAction,
            saveDraft: saveInvoiceDraftAction,
            discardDraft: discardInvoiceDraftAction,
            issue: issueInvoiceAction,
          }}
        />
      ) : (
        <>
          <p className="text-ink-muted text-sm">{t('editor.final')}</p>
          <InvoicePreview
            supplierName={context.workspace.name}
            matterId={invoice.matterId}
            personId={invoice.personId}
            number={invoice.number}
            lines={invoice.lines}
            totals={{
              taxablePaise: invoice.taxablePaise,
              taxPaise: invoice.taxPaise,
              totalPaise: invoice.totalPaise,
            }}
            gstUnreviewed={false}
          />
        </>
      )}
      <LedgerTable entries={ledger} balancePaise={balancePaise} />
    </div>
  );
}
