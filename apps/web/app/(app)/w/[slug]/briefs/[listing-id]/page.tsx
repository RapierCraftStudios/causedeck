// `/w/[slug]/briefs/[listing-id]` (#61, PRD PR-1): the Brief Sheet. The brief is derived on the server
// (`assembleBrief`, `computeReadiness`) in the member's workspace transaction; the payload is the
// service's, so a clerk never receives court notes (they are null without `memory.read`). A refresh
// first clears a stale prepared mark. States: loading (`loading.tsx`), error with retry
// (`error.tsx`), not found / restricted (`not-found.tsx`), permission denied, empty, viewer.
import { PermissionDenied } from '@causedeck/ui/patterns';
import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { domainErrorCode } from '../../../../../../lib/matters/graph-deps.ts';
import { loadMatterOverview } from '../../../../../../lib/matters/workspace.ts';
import { can } from '../../../../../../lib/workspace-context.ts';
import { getWorkspaceContext } from '../../../../../../lib/workspace-loader.ts';

import { BriefSheet } from './_sheet/brief-sheet.tsx';
import type { SheetMasthead, SheetViewModel } from './_sheet/model.ts';

interface BriefPageProps {
  params: Promise<{ slug: string; 'listing-id': string }>;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('brief');
  return { title: t('metaTitle') };
}

export default async function BriefPage({ params }: BriefPageProps) {
  const { slug, 'listing-id': listingId } = await params;
  const context = await getWorkspaceContext(slug);
  if (!context) notFound();
  if (!can(context.role, 'listing.read')) return <PermissionDenied />;

  const [{ db, inWorkspace, listMembersIn }, { assembleBrief, computeReadiness, refreshBrief }] =
    await Promise.all([import('@causedeck/core/runtime'), import('@causedeck/core/briefs')]);
  const scope = { workspaceId: context.workspace.id, userId: context.user.id };
  let brief;
  let staleCleared = false;
  try {
    // A material change since the mark was made clears it before the sheet is read.
    const refreshed = await refreshBrief({ db }, { workspaceId: scope.workspaceId, listingId });
    staleCleared = refreshed.stale !== null;
    brief = await inWorkspace(scope, (tx) => assembleBrief({ db: tx }, scope, listingId));
  } catch (error) {
    const code = domainErrorCode(error);
    if (code === 'FORBIDDEN') return <PermissionDenied />;
    if (code === 'NOT_FOUND' || code === 'VALIDATION') notFound();
    throw error;
  }
  const readiness = computeReadiness(brief);

  const [members, overview, jar, t] = await Promise.all([
    listMembersIn(scope).catch(() => []),
    loadMatterOverview(context, brief.matter_id),
    cookies(),
    getTranslations('brief'),
  ]);
  const header = overview.kind === 'overview' ? overview.overview.header : null;
  const lead = overview.kind === 'overview' ? overview.overview.proceedings.lead : null;
  const masthead: SheetMasthead = {
    matterTitle: header?.title ?? t('metaTitle'),
    caseNo:
      lead && lead.number
        ? `${lead.caseType} ${lead.number}${lead.year ? `/${String(lead.year)}` : ''}`
        : null,
    matterHref: `/w/${slug}/matters/${brief.matter_id}`,
    listDate: overview.kind === 'overview' ? (overview.overview.nextDate?.date ?? null) : null,
  };
  const view: SheetViewModel = {
    workspaceId: context.workspace.id,
    slug,
    brief,
    readiness,
    masthead,
    // Keyed by member id (owners) and by user id (`prepared_by` is the marking user's id).
    members: Object.fromEntries(
      members.flatMap((m) => [
        [m.memberId, m.name],
        [m.userId, m.name],
      ]),
    ),
    canWrite: can(context.role, 'matter.write'),
    printNotes: jar.get(`brief-print-notes-${context.user.id}`)?.value === '1',
    staleCleared,
    assembledAt: brief.assembled_at,
  };
  return <BriefSheet view={view} />;
}
