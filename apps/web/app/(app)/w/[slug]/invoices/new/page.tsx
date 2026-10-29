// `/w/[slug]/invoices/new` (#871, #83): a blank invoice editor. Same flag and role gate as the
// list: flag off is a 404, a role below advocate sees the permission page.
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { PermissionDeniedPage } from '../../../../../../components/shell/permission-denied-page.tsx';
import { requireWorkspaceFlag } from '../../../../../../lib/flags.ts';
import { can } from '../../../../../../lib/workspace-context.ts';
import { getWorkspaceContext } from '../../../../../../lib/workspace-loader.ts';
import { FeesGatedNotice } from '../_components/gated-notice.tsx';
import { InvoiceEditor } from '../_components/invoice-editor.tsx';
import {
  discardInvoiceDraftAction,
  issueInvoiceAction,
  previewInvoiceAction,
  saveInvoiceDraftAction,
} from '../actions.ts';

interface NewInvoicePageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('fees');
  return { title: t('editor.titleNew') };
}

export default async function NewInvoicePage({ params }: NewInvoicePageProps) {
  const { slug } = await params;
  const context = await getWorkspaceContext(slug);
  if (!context) notFound();
  await requireWorkspaceFlag('invoices.enabled', context);
  if (!can(context.role, 'fee.write')) return <PermissionDeniedPage />;

  const t = await getTranslations('fees');
  return (
    <div data-route="invoices-new" className="flex flex-col gap-6">
      <h1 className="font-serif text-2xl font-medium">{t('editor.titleNew')}</h1>
      <FeesGatedNotice />
      <InvoiceEditor
        workspaceId={context.workspace.id}
        basePath={`/w/${slug}/invoices`}
        initial={{
          matterId: '',
          personId: '',
          placeOfSupplyStateCode: '',
          lines: [],
          supplierName: context.workspace.name,
        }}
        canWrite
        isOwner={context.role === 'owner'}
        actions={{
          preview: previewInvoiceAction,
          saveDraft: saveInvoiceDraftAction,
          discardDraft: discardInvoiceDraftAction,
          issue: issueInvoiceAction,
        }}
      />
    </div>
  );
}
