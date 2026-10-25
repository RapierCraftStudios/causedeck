/* eslint-disable unicorn/filename-case -- the route segment `[hearingId]` is fixed by the issue's path */
// `/w/[slug]/hearings/[hearingId]/outcome` (#62, PRD EX-3): the hearing outcome confirmation. The
// proposal comes from `getOutcomeProposal` in the member's workspace transaction. Viewers and
// clerks without `matter.write` get the permission-denied state (the service checks again).
// States: processing (no proposal yet), needs you (unanchored fields blank), empty (manual entry),
// loading and error with retry (`loading.tsx`, `error.tsx`). In development `?__state=loading|error|denied`.
import { PermissionDenied } from '@causedeck/ui/patterns';
import type { OutcomeProposal } from '@causedeck/validators/hearing-outcome';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { isDev } from '../../../../../../../lib/env.ts';
import { domainErrorCode } from '../../../../../../../lib/matters/graph-deps.ts';
import { can } from '../../../../../../../lib/workspace-context.ts';
import { getWorkspaceContext } from '../../../../../../../lib/workspace-loader.ts';

import { LiveRefresh } from './_components/live-refresh.tsx';
import { OutcomeForm } from './_components/outcome-form.tsx';
import OutcomeLoading from './loading.tsx';

interface OutcomePageProps {
  params: Promise<{ slug: string; hearingId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('outcome');
  return { title: t('metaTitle') };
}

/** The distinct quotes the proposal cites, in order: the transcript excerpts the drawer marks. */
function excerptsOf(proposal: OutcomeProposal) {
  const quotes = [
    proposal.summary?.quote,
    proposal.adjournmentReason?.quote,
    proposal.nextDate?.quote,
    proposal.stageAfter?.quote,
    ...proposal.obligations.map((o) => o.quote),
    ...proposal.tasks.map((task) => task.quote),
  ];
  return [...new Set(quotes.filter((q): q is string => typeof q === 'string' && q !== ''))];
}

export default async function OutcomePage({ params, searchParams }: OutcomePageProps) {
  const [{ slug, hearingId }, query] = await Promise.all([params, searchParams]);
  const context = await getWorkspaceContext(slug);
  if (!context) notFound();

  const dev = isDev() ? query.__state : undefined;
  if (dev === 'loading') return <OutcomeLoading />;
  if (dev === 'error') throw new Error('Outcome error state (dev toggle)');
  if (dev === 'denied' || !can(context.role, 'matter.write')) return <PermissionDenied />;

  const t = await getTranslations('outcome');
  const [{ inWorkspace, listMembersIn }, { getOutcomeProposal }] = await Promise.all([
    import('@causedeck/core/runtime'),
    import('@causedeck/core/hearings'),
  ]);
  const scope = { workspaceId: context.workspace.id, userId: context.user.id };
  let proposal;
  try {
    proposal = await inWorkspace(scope, (tx) =>
      getOutcomeProposal({ db: tx, events: { emit() {} } }, scope, { hearingId }),
    );
  } catch (error) {
    const code = domainErrorCode(error);
    if (code === 'FORBIDDEN') return <PermissionDenied />;
    if (code === 'NOT_FOUND') notFound();
    throw error;
  }
  const members = await listMembersIn(scope).catch(() => []);
  const owners = members.map((m) => ({ id: m.memberId, name: m.name }));

  return (
    <div className="mx-auto grid w-full max-w-3xl gap-6">
      <header className="grid gap-1">
        <h1 className="font-serif text-2xl font-medium">{t('title')}</h1>
        <p className="text-muted-foreground text-sm">{t('heldOn', { date: proposal.heldOn })}</p>
      </header>
      <LiveRefresh active={!proposal.confirmed} />
      <OutcomeForm
        workspaceId={context.workspace.id}
        proposal={proposal}
        owners={owners}
        excerpts={excerptsOf(proposal)}
        canWrite
      />
    </div>
  );
}
