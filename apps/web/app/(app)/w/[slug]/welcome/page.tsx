import { Button } from '@causedeck/ui/button';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { LocaleSwitcher } from '../../../../../components/locale-switcher.tsx';
import type { WorkspacePageProps } from '../../../../../components/shell/placeholder-page.tsx';
import { can } from '../../../../../lib/workspace-context.ts';
import { getWorkspaceContext } from '../../../../../lib/workspace-loader.ts';

import { approveClerkSetupAction, requestClerkSetupApprovalAction } from './actions.ts';
import { ApprovalButton } from './approval-buttons.tsx';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('workspace.welcome');
  return { title: t('metaTitle') };
}

const card = 'bg-surface border-line flex flex-col gap-3 rounded-lg border p-4 md:p-6';

/**
 * `/w/[slug]/welcome` (#505): clerk-led onboarding, mobile-first and in the member's language
 * (Tamil, Kannada or English, switched here). The clerk the senior invited sees three steps (language,
 * import and confirm the listings, the court day) and asks for approval; a member with
 * `workspace.manage` sees the clerk setups waiting and approves each with one tap. Other roles get
 * a short notice. Nothing here widens a clerk's permissions: the links lead to pages whose own
 * guards decide, and strategy notes stay hidden by the matrix.
 */
export default async function WelcomePage({ params }: WorkspacePageProps) {
  const { slug } = await params;
  const context = await getWorkspaceContext(slug);
  if (!context) notFound();
  const t = await getTranslations('workspace.welcome');
  const base = `/w/${encodeURIComponent(slug)}`;
  const { workspace, role, user } = context;

  const isClerk = role === 'clerk';
  const isSenior = can(role, 'workspace.manage');
  let clerks: Awaited<ReturnType<typeof loadClerks>> = [];
  if (isClerk || isSenior) clerks = await loadClerks(workspace.id, user.id);
  const own = clerks.find((c) => c.userId === user.id);
  const waiting = clerks.filter((c) => c.status === 'pending');

  return (
    <main
      id="main"
      tabIndex={-1}
      data-clerk-welcome={isClerk ? 'clerk' : isSenior ? 'senior' : 'other'}
      className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-6 outline-none md:py-10"
    >
      <header className="flex flex-col gap-1.5">
        <h1 className="font-serif text-2xl font-medium">{t('title', { workspace: workspace.name })}</h1>
        {isClerk ? <p className="text-ink-muted text-sm">{t('clerkIntro')}</p> : null}
      </header>

      {isClerk ? (
        <>
          <section aria-labelledby="step-language" className={card}>
            <h2 id="step-language" className="text-base font-medium">
              {t('steps.language.title')}
            </h2>
            <p className="text-ink-muted text-sm">{t('steps.language.body')}</p>
            <LocaleSwitcher variant="list" />
          </section>
          <section aria-labelledby="step-import" className={card}>
            <h2 id="step-import" className="text-base font-medium">
              {t('steps.import.title')}
            </h2>
            <p className="text-ink-muted text-sm">{t('steps.import.body')}</p>
            <Button asChild size="lg" variant="secondary" className="w-full">
              <Link href={`${base}/import`}>{t('steps.import.action')}</Link>
            </Button>
          </section>
          <section aria-labelledby="step-today" className={card}>
            <h2 id="step-today" className="text-base font-medium">
              {t('steps.today.title')}
            </h2>
            <p className="text-ink-muted text-sm">{t('steps.today.body')}</p>
            <Button asChild size="lg" variant="secondary" className="w-full">
              <Link href={`${base}/today`}>{t('steps.today.action')}</Link>
            </Button>
          </section>
          <section aria-labelledby="step-approval" className={card} data-clerk-setup-status={own?.status ?? 'none'}>
            <h2 id="step-approval" className="text-base font-medium">
              {t('approval.title')}
            </h2>
            {own?.status === 'approved' ? (
              <p className="text-sm">{t('approval.approved')}</p>
            ) : own?.status === 'pending' ? (
              <p className="text-sm">{t('approval.pending', { path: `${base}/welcome` })}</p>
            ) : (
              <>
                <p className="text-ink-muted text-sm">{t('approval.body')}</p>
                <ApprovalButton
                  kind="request"
                  action={requestClerkSetupApprovalAction}
                  input={{ workspaceId: workspace.id }}
                />
              </>
            )}
          </section>
        </>
      ) : null}

      {!isClerk && isSenior ? (
        <section aria-labelledby="senior-title" className={card}>
          <h2 id="senior-title" className="text-base font-medium">
            {t('senior.title')}
          </h2>
          {waiting.length === 0 ? (
            <p className="text-ink-muted text-sm">{t('senior.empty')}</p>
          ) : (
            <ul className="flex flex-col gap-4">
              {waiting.map((clerk) => (
                <li key={clerk.memberId} className="flex flex-col gap-2">
                  <p className="text-sm">{t('senior.item', { name: clerk.name })}</p>
                  <ApprovalButton
                    kind="approve"
                    action={approveClerkSetupAction}
                    input={{ workspaceId: workspace.id, memberId: clerk.memberId }}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {!isClerk && !isSenior ? <p className="text-ink-muted text-sm">{t('notForRole')}</p> : null}
    </main>
  );
}

async function loadClerks(workspaceId: string, userId: string) {
  const { inWorkspace } = await import('@causedeck/core/runtime');
  const { getClerkSetup } = await import('@causedeck/core/workspaces');
  return inWorkspace({ workspaceId, userId }, (tx) => getClerkSetup(tx, workspaceId));
}
