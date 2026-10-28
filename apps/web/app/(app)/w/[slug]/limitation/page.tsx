// `/w/[slug]/limitation` (#941, #84 part 3): the limitation tracker. The legal-gated
// `limitation.enabled` flag is checked first: off, the route is a plain 404 (and the nav entry is
// hidden). Dates come only from a counsel-reviewed rule table and stay proposals until an owner or
// advocate confirms them; a clerk or viewer sees due dates only.
//
// States: loading (skeleton), error (`error.tsx`), empty, no reviewed rules, offline (banner,
// read-only) and permission-denied. In development `?__state=loading|error|denied|offline` previews
// them.
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { PermissionDeniedPage } from '../../../../../components/shell/permission-denied-page.tsx';
import { isDev } from '../../../../../lib/env.ts';
import { requireWorkspaceFlag } from '../../../../../lib/flags.ts';
import { loadLimitations } from '../../../../../lib/limitation/limitation-deps.ts';
import { can } from '../../../../../lib/workspace-context.ts';
import { getWorkspaceContext } from '../../../../../lib/workspace-loader.ts';

import { LimitationGatedNotice } from './_components/gated-notice.tsx';
import { LimitationList } from './_components/limitation-list.tsx';
import { NoRulesNotice } from './_components/no-rules-notice.tsx';
import { computeLimitationAction, confirmLimitationAction } from './actions.ts';
import LimitationLoading from './loading.tsx';

interface LimitationPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('limitation');
  return { title: t('metaTitle') };
}

export default async function LimitationPage({ params, searchParams }: LimitationPageProps) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const context = await getWorkspaceContext(slug);
  if (!context) notFound();
  await requireWorkspaceFlag('limitation.enabled', context);

  const state = isDev() ? query.__state : undefined;
  const preview = Array.isArray(state) ? state[0] : state;
  if (preview === 'loading') return <LimitationLoading />;
  if (preview === 'error') throw new Error('Limitation error state (dev toggle)');
  if (preview === 'denied') return <PermissionDeniedPage />;

  const load = await loadLimitations(context);
  if (load.kind === 'denied') return <PermissionDeniedPage />;
  if (load.kind === 'error') throw new Error('Could not load the limitation dates');

  const t = await getTranslations('limitation');
  const canSeeRules = can(context.role, 'limitation.read');
  const noReviewedRule = canSeeRules && !load.rules.some((r) => r.reviewed);
  return (
    <div data-route="limitation" className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-serif text-2xl font-medium">{t('title')}</h1>
        <p className="text-ink-muted max-w-prose text-sm">{t('description')}</p>
      </header>
      <LimitationGatedNotice />
      {noReviewedRule ? <NoRulesNotice /> : null}
      <LimitationList
        workspaceId={context.workspace.id}
        computations={load.computations}
        rules={load.rules}
        canWrite={can(context.role, 'limitation.write')}
        actions={{ compute: computeLimitationAction, confirm: confirmLimitationAction }}
        forceOffline={preview === 'offline'}
      />
    </div>
  );
}
