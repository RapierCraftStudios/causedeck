// `/w/[slug]/inbox/import/whatsapp` (#527, part 3 of #55): import a WhatsApp chat export. The route
// is 404 while `capture.whatsapp-import` is off and has no nav entry; only owners and advocates may
// import (others get permission-denied). The file is read and filtered in the browser (Web Worker);
// the page only passes the workspace and the member's name. The server re-applies the exclusion
// rules on upload (`POST /api/captures/whatsapp`, #526).
import { PermissionDenied } from '@causedeck/ui/patterns';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { WhatsAppImportFlow } from '../../../../../../../components/inbox/whatsapp-import/whatsapp-import-flow.tsx';
import { can } from '../../../../../../../lib/workspace-context.ts';
import { getWorkspaceContext } from '../../../../../../../lib/workspace-loader.ts';

interface WhatsAppImportPageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('whatsappImport');
  return { title: t('metaTitle') };
}

export default async function WhatsAppImportPage({ params }: WhatsAppImportPageProps) {
  const { slug } = await params;
  const context = await getWorkspaceContext(slug);
  if (!context) notFound();

  const { isEnabled } = await import('@causedeck/flags/server');
  const on = await isEnabled('capture.whatsapp-import', {
    workspaceId: context.workspace.id,
    userId: context.user.id,
  });
  if (!on) notFound();

  const t = await getTranslations('whatsappImport');
  if (!can(context.role, 'workspace.manage')) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="font-serif text-2xl font-medium">{t('title')}</h1>
        <PermissionDenied message={t('states.denied')} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <Link
          href={`/w/${encodeURIComponent(slug)}/inbox`}
          className="text-accent text-sm underline-offset-2 hover:underline"
        >
          {t('back')}
        </Link>
        <h1 className="font-serif text-2xl font-medium">{t('title')}</h1>
      </div>
      <WhatsAppImportFlow
        workspaceId={context.workspace.id}
        slug={slug}
        memberName={context.user.name}
      />
    </div>
  );
}
