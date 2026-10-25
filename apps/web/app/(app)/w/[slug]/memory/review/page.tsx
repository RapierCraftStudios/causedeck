// `/w/[slug]/memory/review` (#73): the monthly review. A stepper through the active items not
// confirmed, edited or used in 60 days, with Keep, Edit and Delete; finishing records the review
// date (`M1.last_memory_review`) and shows a summary. Needs `memory.write`.
import { PermissionDenied } from '@causedeck/ui/patterns';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { toCardView } from '../../../../../../lib/memory/memory-state.ts';
import { can } from '../../../../../../lib/workspace-context.ts';
import { getWorkspaceContext } from '../../../../../../lib/workspace-loader.ts';

import { ReviewStepper } from './_components/review-stepper.tsx';

interface ReviewPageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('memory.review');
  return { title: t('metaTitle') };
}

export default async function MemoryReviewPage({ params }: ReviewPageProps) {
  const { slug } = await params;
  const context = await getWorkspaceContext(slug);
  if (!context) notFound();
  const t = await getTranslations('memory');
  if (!can(context.role, 'memory.write')) return <PermissionDenied message={t('denied')} />;

  const scope = { workspaceId: context.workspace.id, userId: context.user.id };
  const runtime = await import('@causedeck/core/runtime');
  const memory = await import('@causedeck/core/memory');
  const candidates = await runtime.inWorkspace(scope, (tx) =>
    memory.listReviewCandidates({ db: tx }, scope),
  );
  return (
    <ReviewStepper
      workspaceId={context.workspace.id}
      slug={slug}
      isOwner={context.role === 'owner'}
      cards={candidates.map(toCardView)}
    />
  );
}
