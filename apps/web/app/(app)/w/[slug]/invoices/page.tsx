// `/w/[slug]/invoices` (#871, #83 part 4): fee agreements, invoices and the client ledger. The
// legal-gated `invoices.enabled` flag is checked first: off, the route is a plain 404 (and the nav
// entry is hidden). Records money only: invoices are prepared for the lawyer to review and send
// themselves, and nothing is sent, charged or transferred. Owners and advocates only.
//
// States: loading (skeleton), error (`error.tsx`), empty, offline (banner, read-only) and
// permission-denied. In development `?__state=loading|error|denied|offline` previews them.
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { PermissionDeniedPage } from '../../../../../components/shell/permission-denied-page.tsx';
import { isDev } from '../../../../../lib/env.ts';
import { loadFeePickers, loadFees } from '../../../../../lib/fees/fees-deps.ts';
import { requireWorkspaceFlag } from '../../../../../lib/flags.ts';
import { can } from '../../../../../lib/workspace-context.ts';
import { getWorkspaceContext } from '../../../../../lib/workspace-loader.ts';

import { FeesGatedNotice } from './_components/gated-notice.tsx';
import { InvoiceList } from './_components/invoice-list.tsx';
import { createFeeAgreementAction, setFeeAgreementStatusAction } from './actions.ts';
import InvoicesLoading from './loading.tsx';

interface InvoicesPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('fees');
  return { title: t('metaTitle') };
}

export default async function InvoicesPage({ params, searchParams }: InvoicesPageProps) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const context = await getWorkspaceContext(slug);
  if (!context) notFound();
  await requireWorkspaceFlag('invoices.enabled', context);

  const state = isDev() ? query.__state : undefined;
  const preview = Array.isArray(state) ? state[0] : state;
  if (preview === 'loading') return <InvoicesLoading />;
  if (preview === 'error') throw new Error('Fees error state (dev toggle)');
  if (preview === 'denied' || !can(context.role, 'fee.read')) return <PermissionDeniedPage />;

  const load = await loadFees(context);
  if (load.kind === 'denied') return <PermissionDeniedPage />;
  if (load.kind === 'error') throw new Error('Could not load the fee records');

  const pickers = await loadFeePickers(context);
  const t = await getTranslations('fees');
  return (
    <div data-route="invoices" className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-serif text-2xl font-medium">{t('title')}</h1>
        <p className="text-ink-muted max-w-prose text-sm">{t('description')}</p>
      </header>
      <FeesGatedNotice />
      <InvoiceList
        workspaceId={context.workspace.id}
        basePath={`/w/${slug}/invoices`}
        agreements={load.agreements}
        invoices={load.invoices}
        canWrite={can(context.role, 'fee.write')}
        matters={pickers.matters}
        clients={pickers.clients}
        actions={{
          createAgreement: createFeeAgreementAction,
          setAgreementStatus: setFeeAgreementStatusAction,
        }}
        forceOffline={preview === 'offline'}
      />
    </div>
  );
}
