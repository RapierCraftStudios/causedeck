// `/w/[slug]/people/enquiries` (#874, #87 part 2): the inbound enquiry log. The legal-gated
// `intake.enquiry_log` flag is checked first: off, the route is a plain 404. Owners and advocates
// only (`enquiry.read`); any other role sees the permission-denied page. Nothing on this page sends
// anything to the enquirer.
//
// States: loading (skeleton), error (`error.tsx`), empty, offline (banner, read-only) and
// permission-denied. In development `?__state=loading|error|denied|offline` previews them.
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { PermissionDeniedPage } from '../../../../../../components/shell/permission-denied-page.tsx';
import { isDev } from '../../../../../../lib/env.ts';
import { requireWorkspaceFlag } from '../../../../../../lib/flags.ts';
import { loadEnquiries, toEnquiryRowView } from '../../../../../../lib/intake/intake-deps.ts';
import { getWorkspaceContext } from '../../../../../../lib/workspace-loader.ts';

import { EnquiryList } from './_components/enquiry-list.tsx';
import { GatedNotice } from './_components/gated-notice.tsx';
import {
  acceptEnquiryAction,
  closeEnquiryAction,
  logEnquiryAction,
  runConflictCheckAction,
  updateEnquiryAction,
} from './actions.ts';
import EnquiriesLoading from './loading.tsx';

interface EnquiriesPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('enquiry');
  return { title: t('metaTitle') };
}

export default async function EnquiriesPage({ params, searchParams }: EnquiriesPageProps) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const context = await getWorkspaceContext(slug);
  if (!context) notFound();
  await requireWorkspaceFlag('intake.enquiry_log', context);

  const state = isDev() ? query.__state : undefined;
  const preview = Array.isArray(state) ? state[0] : state;
  if (preview === 'loading') return <EnquiriesLoading />;
  if (preview === 'error') throw new Error('Enquiries error state (dev toggle)');
  if (preview === 'denied') return <PermissionDeniedPage />;

  if (context.role !== 'owner' && context.role !== 'advocate') return <PermissionDeniedPage />;
  const load = await loadEnquiries(context);
  if (load.kind === 'denied') return <PermissionDeniedPage />;
  if (load.kind === 'error') throw new Error('Could not load the enquiries');

  const t = await getTranslations('enquiry');
  return (
    <div data-route="enquiries" className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-serif text-2xl font-medium">{t('title')}</h1>
        <p className="text-ink-muted max-w-prose text-sm">{t('description')}</p>
      </header>
      <GatedNotice />
      <EnquiryList
        workspaceId={context.workspace.id}
        enquiries={load.enquiries.map(toEnquiryRowView)}
        actions={{
          log: logEnquiryAction,
          update: updateEnquiryAction,
          check: runConflictCheckAction,
          accept: acceptEnquiryAction,
          close: closeEnquiryAction,
        }}
        forceOffline={preview === 'offline'}
      />
    </div>
  );
}
