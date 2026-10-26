// `/w/[slug]/matters/[id]` Overview (#390, #40 part 3): the next date with its provenance and
// `Confirm` when proposed, a Conflict card per unresolved date conflict (Choose A / Choose B /
// Enter manually, never auto-resolved), the proceedings summary, open obligations, recent
// documents, people and the lawyer's synopsis. The read model (`getMatterOverview`) is shared with
// the layout; it leaves the synopsis out for roles without `strategy.read` (`synopsisDenied`).
// Write controls are passed only to roles with `matter.write`, so viewers and clerks get none in
// the page at all; the server actions check again.
//
// States: loading (skeleton), error (`Couldn't load this matter.` with `Retry` and a reference),
// empty cards, offline (banner, mutations off), permission-denied, and not-found (another
// workspace, a restricted matter or an unknown id). In development
// `?__state=loading|error|denied|offline|empty` previews them.
import type { SnoozeRecord } from '@causedeck/validators/attention';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';

import { type BenchNoticeAlertView } from '../../../../../../components/courts/bench-notice-alerts.tsx';
import {
  toNoticeView,
  type NoticeView,
} from '../../../../../../components/notices/notice-list.tsx';
import { ReportError } from '../../../../../../components/matters/report-error.tsx';
import { MatterOverview } from '../../../../../../components/matters/matter-overview.tsx';
import { MattersPermissionDenied } from '../../../../../../components/matters/matters-list.tsx';
import {
  BriefSharePanel,
  type ShareLinkView,
} from '../../../../../../components/shares/brief-share-panel.tsx';
import { isDev } from '../../../../../../lib/env.ts';
import type { SearchParams } from '../../../../../../lib/matters/list-params.ts';
import {
  loadMatterOverview,
  loadReviewCorrections,
  toOverviewView,
  type MatterOverviewView,
} from '../../../../../../lib/matters/workspace.ts';
import { can, type WorkspaceContext } from '../../../../../../lib/workspace-context.ts';
import { getWorkspaceContext } from '../../../../../../lib/workspace-loader.ts';
import { logger } from '../../../../../../src/health.ts';

import {
  chooseNextDateSourceAction,
  confirmNextDateAction,
  reportRecordErrorAction,
  updateMatterAction,
} from './actions.ts';
import { AttentionSnoozes } from '../_components/attention-snoozes.tsx';
import { createBriefShareAction, revokeBriefShareAction } from '../../briefs/actions.ts';
import { HandoverSheet } from './_continuity/handover-sheet.tsx';
import { WhatChangedCard } from './_continuity/what-changed-card.tsx';
import MatterLoading from './loading.tsx';

interface MatterPageProps {
  params: Promise<{ slug: string; id: string }>;
  searchParams: Promise<SearchParams>;
}

/** `?__state=…` previews a state in development. Ignored in production. */
function devState(searchParams: SearchParams): string | undefined {
  if (!isDev()) return undefined;
  const value = searchParams.__state;
  return Array.isArray(value) ? value[0] : value;
}

export async function generateMetadata({
  params,
}: Pick<MatterPageProps, 'params'>): Promise<Metadata> {
  const { slug, id } = await params;
  const t = await getTranslations('matters.workspace');
  const context = await getWorkspaceContext(slug);
  if (!context || !can(context.role, 'matter.read')) return { title: t('metaTitle') };
  const loaded = await loadMatterOverview(context, id);
  return { title: loaded.kind === 'overview' ? loaded.overview.header.title : t('metaTitle') };
}

async function pageLocale() {
  const { isLocale, DEFAULT_LOCALE } = await import('@causedeck/i18n');
  const requested = await getLocale();
  return isLocale(requested) ? requested : DEFAULT_LOCALE;
}

/** The `empty` dev preview: the same matter with nothing recorded yet. */
function emptied(view: MatterOverviewView): MatterOverviewView {
  return {
    ...view,
    nextDate: null,
    conflicts: [],
    proceedings: { count: 0, byState: [], lead: null },
    openObligations: 0,
    recentDocuments: [],
    people: [],
    synopsis: null,
  };
}

/** The notices affecting the matter (#588). A failed read leaves the card empty, never the page. */
async function loadMatterNotices(
  context: WorkspaceContext,
  matterId: string,
): Promise<NoticeView[]> {
  try {
    const { inWorkspace } = await import('@causedeck/core/runtime');
    const { listMatterNotices } = await import('@causedeck/core/notices');
    const actor = { workspaceId: context.workspace.id, userId: context.user.id };
    const rows = await inWorkspace(actor, (tx) => listMatterNotices(tx, actor, matterId));
    return rows.map(toNoticeView);
  } catch (error) {
    logger.error(
      { err: error },
      'matter overview: could not load the notices affecting the matter',
    );
    return [];
  }
}

/** The bench-notice alerts affecting the matter (#496). A failed read renders no card, never breaks the page. */
async function loadBenchNotices(
  context: WorkspaceContext,
  matterId: string,
): Promise<BenchNoticeAlertView[]> {
  try {
    const { inWorkspace } = await import('@causedeck/core/runtime');
    const { listBenchNoticeAlerts } = await import('@causedeck/core/court');
    const actor = { workspaceId: context.workspace.id, userId: context.user.id };
    return await inWorkspace(actor, (tx) => listBenchNoticeAlerts(tx, actor, { matterId }));
  } catch (error) {
    logger.error({ err: error }, 'matter overview: could not load the bench-notice alerts');
    return [];
  }
}

/** The snoozes and dismissals on the matter (#70). A failed read hides the card, never breaks the page. */
async function loadMatterSnoozes(
  context: WorkspaceContext,
  matterId: string,
): Promise<SnoozeRecord[] | null> {
  try {
    const { inWorkspace } = await import('@causedeck/core/runtime');
    const { listSnoozes } = await import('@causedeck/core/attention');
    const actor = { workspaceId: context.workspace.id, userId: context.user.id };
    return await inWorkspace(actor, (tx) => listSnoozes({ db: tx }, actor, matterId));
  } catch (error) {
    logger.error({ err: error }, 'matter overview: could not load the attention snoozes');
    return null;
  }
}

/** The owner's brief-sharing panel data (#507). A failed read hides the panel, never breaks the page. */
async function loadBriefSharing(
  context: WorkspaceContext,
  matterId: string,
): Promise<{ listingId: string | null; shares: ShareLinkView[] } | null> {
  if (!can(context.role, 'export.run')) return null;
  try {
    const { db } = await import('@causedeck/core/runtime');
    const { listBriefShares, shareableListingId } = await import('@causedeck/core/shares');
    const actor = { workspaceId: context.workspace.id, userId: context.user.id };
    const [listingId, rows] = await Promise.all([
      shareableListingId({ db }, actor, matterId),
      listBriefShares({ db }, actor),
    ]);
    return {
      listingId,
      shares: rows.map((row) => ({
        id: row.id,
        matterTitle: row.matterTitle,
        createdAt: row.createdAt.toISOString(),
        expiresAt: row.expiresAt.toISOString(),
        canRevoke: true,
      })),
    };
  } catch (error) {
    logger.error({ err: error }, 'matter overview: could not load the brief shares');
    return null;
  }
}

/** Member names by member id and the viewer's own member id, for the handover sheet and card (#71). */
async function loadContinuityMembers(
  context: WorkspaceContext,
): Promise<{ members: Record<string, string>; myMemberId: string | null }> {
  try {
    const { listMembersIn } = await import('@causedeck/core/runtime');
    const rows = await listMembersIn({
      workspaceId: context.workspace.id,
      userId: context.user.id,
    });
    return {
      members: Object.fromEntries(rows.map((m) => [m.memberId, m.name])),
      myMemberId: rows.find((m) => m.userId === context.user.id)?.memberId ?? null,
    };
  } catch (error) {
    logger.error({ err: error }, 'matter overview: could not load members for the handover');
    return { members: {}, myMemberId: null };
  }
}

export default async function MatterOverviewPage({ params, searchParams }: MatterPageProps) {
  const [{ slug, id }, query] = await Promise.all([params, searchParams]);
  const context = await getWorkspaceContext(slug);
  if (!context) notFound();

  const dev = devState(query);
  if (dev === 'loading') return <MatterLoading />;
  if (dev === 'error') throw new Error('Matter error state (dev toggle)');
  if (dev === 'denied' || !can(context.role, 'matter.read')) return <MattersPermissionDenied />;

  const loaded = await loadMatterOverview(context, id);
  if (loaded.kind === 'not-found') notFound();
  if (loaded.kind === 'denied') return <MattersPermissionDenied />;
  if (loaded.kind === 'error') throw new Error('Matter could not be loaded');

  const notices = dev === 'empty' ? [] : await loadMatterNotices(context, id);
  const locale = await pageLocale();
  const benchNotices = dev === 'empty' ? [] : await loadBenchNotices(context, id);
  const sharing = dev === 'empty' ? null : await loadBriefSharing(context, id);
  const snoozes = dev === 'empty' ? null : await loadMatterSnoozes(context, id);
  const view = toOverviewView(loaded.overview, { locale, now: new Date() });
  const proceedingId = view.nextDate?.proceedingId;
  const corrections =
    proceedingId === undefined || dev === 'empty'
      ? []
      : await loadReviewCorrections(context, proceedingId, locale);
  const continuity = await loadContinuityMembers(context);
  return (
    <>
      <div className="grid gap-3">
        <div className="flex justify-end">
          <HandoverSheet
            workspaceId={context.workspace.id}
            matterId={id}
            members={continuity.members}
            myMemberId={continuity.myMemberId}
            canWrite={can(context.role, 'task.write')}
          />
        </div>
        {dev === 'empty' ? null : (
          <WhatChangedCard
            workspaceId={context.workspace.id}
            matterId={id}
            members={continuity.members}
          />
        )}
      </div>
      <MatterOverview
        matter={dev === 'empty' ? emptied(view) : view}
        workspaceId={context.workspace.id}
        slug={slug}
        canWrite={can(context.role, 'matter.write')}
        forcedOffline={dev === 'offline'}
        notices={notices}
        benchNotices={benchNotices}
        actions={{
          confirmNextDate: confirmNextDateAction,
          chooseNextDateSource: chooseNextDateSourceAction,
          updateMatter: updateMatterAction,
        }}
      />
      {snoozes === null ? null : (
        <AttentionSnoozes
          workspaceId={context.workspace.id}
          snoozes={snoozes}
          canWrite={can(context.role, 'matter.write')}
        />
      )}
      {sharing === null ? null : (
        <BriefSharePanel
          workspaceId={context.workspace.id}
          listingId={sharing.listingId}
          canShare
          shares={sharing.shares}
          actions={{ create: createBriefShareAction, revoke: revokeBriefShareAction }}
        />
      )}
      {proceedingId === undefined ? null : (
        <ReportError
          workspaceId={context.workspace.id}
          proceedingId={proceedingId}
          corrections={corrections}
          report={reportRecordErrorAction}
        />
      )}
    </>
  );
}
