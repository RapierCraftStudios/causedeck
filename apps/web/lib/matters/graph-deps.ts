// Server-only seam between the matters screens and the matter-graph services (#388). The services
// take `MatterGraphDeps` and open the actor's workspace scope themselves (`withWorkspace`); the app
// gives them the transaction it already holds (`inWorkspace` here, `ctx.tx` in server actions):
// a scope nested in the same workspace is allowed, and apps never import `db` (#298).
//
// The events port is a no-op for now: no subscriber consumes matter-graph events in production yet.
// Audit, notifications and AI work attach to the port in later issues (core/matter-graph/events.ts).
import type { MatterGraphDeps, MatterListPage, MatterListRow } from '@causedeck/core/matter-graph';
import type { Transaction } from '@causedeck/core/runtime';
import { formatDate, formatRelativeFrom, type Locale } from '@causedeck/i18n';
import type { SearchMattersInput } from '@causedeck/validators/matter-graph-inputs';

import { logger } from '../../src/health.ts';
import type { WorkspaceContext } from '../workspace-context.ts';

import { matterHref } from './list-params.ts';

const NO_EVENTS: MatterGraphDeps['events'] = {
  emit() {
    // No subscribers yet (see the header).
  },
};

/** The matter-graph deps for a transaction the caller already opened. */
export function graphDeps(tx: Transaction): MatterGraphDeps {
  return { db: tx, events: NO_EVENTS };
}

/** The code of a domain error (`WorkspaceError`), if `error` is one. */
export function domainErrorCode(error: unknown): string | undefined {
  if (error instanceof Error && 'code' in error && typeof error.code === 'string') {
    return /Error$/.test(error.name) ? error.code : undefined;
  }
  return undefined;
}

export type MatterListLoad =
  | { kind: 'page'; page: MatterListPage }
  | { kind: 'denied' }
  | { kind: 'invalid' }
  | { kind: 'error' };

/** One page of the list for the signed-in member, in their workspace scope. */
export async function loadMatterList(
  context: WorkspaceContext,
  input: SearchMattersInput,
): Promise<MatterListLoad> {
  try {
    // One at a time, not in a Promise.all: concurrent imports race the test mocks.
    const { inWorkspace } = await import('@causedeck/core/runtime');
    const { searchMatters } = await import('@causedeck/core/matter-graph');
    const scope = { workspaceId: context.workspace.id, userId: context.user.id };
    const page = await inWorkspace(scope, (tx) => searchMatters(graphDeps(tx), scope, input));
    return { kind: 'page', page };
  } catch (error) {
    const code = domainErrorCode(error);
    if (code === 'FORBIDDEN') return { kind: 'denied' };
    if (code === 'VALIDATION') return { kind: 'invalid' };
    // The error never carries party data into the log: only the error object (stack, code).
    logger.error({ err: error }, 'matters page: could not load the matters list');
    return { kind: 'error' };
  }
}

export interface FilterOption {
  id: string;
  name: string;
}

export interface MatterFilterOptions {
  owners: FilterOption[];
  forums: FilterOption[];
}

/**
 * Owners (the workspace's members) and forums (the courts index) for the filters. A failure only
 * leaves the options empty: the list itself still renders.
 */
export async function loadMatterFilterOptions(
  context: WorkspaceContext,
): Promise<MatterFilterOptions> {
  try {
    const { inWorkspace, listMembersIn } = await import('@causedeck/core/runtime');
    const { getCourtsIndex } = await import('@causedeck/core/court');
    const workspaceId = context.workspace.id;
    const scope = { workspaceId, userId: context.user.id };
    const [members, index] = await Promise.all([
      listMembersIn(scope),
      inWorkspace(scope, (tx) => getCourtsIndex(tx, workspaceId)),
    ]);
    const forums = index.cities.flatMap((city) =>
      city.courts.flatMap((court) =>
        court.forums.map((forum) => ({
          id: forum.id,
          name: forum.seat === null ? forum.court : `${forum.court}, ${forum.seat}`,
        })),
      ),
    );
    return {
      owners: members.map((entry) => ({ id: entry.memberId, name: entry.name })),
      forums,
    };
  } catch (error) {
    logger.error({ err: error }, 'matters page: could not load the filter options');
    return { owners: [], forums: [] };
  }
}

/** One list row as the table and the cards show it, dates already formatted for the locale. */
export interface MatterRowView {
  id: string;
  href: string;
  title: string;
  sensitive: boolean;
  petitioner: string | null;
  respondent: string | null;
  forum: string | null;
  /** The stage printed on the next-date listing; a `StageBadge` when it is a known stage. */
  stage: string | null;
  proceedingCount: number;
  nextDate: { text: string; relative: string; confirmed: boolean } | null;
  owner: string | null;
  updated: string;
  updatedAt: string;
}

/** A `searchMatters` row as a view: court-style next date (weekday first) and IST days. */
export function toMatterRowView(
  row: MatterListRow,
  { slug, locale, now }: { slug: string; locale: Locale; now: Date },
): MatterRowView {
  return {
    id: row.id,
    href: matterHref(slug, row.id),
    title: row.title,
    sensitive: row.sensitive,
    petitioner: row.petitioner,
    respondent: row.respondent,
    forum: row.forum?.court ?? null,
    stage: row.stage,
    proceedingCount: row.proceedingCount,
    nextDate:
      row.nextDate === null
        ? null
        : {
            text: formatDate(row.nextDate.date, { locale, style: 'court' }),
            relative: formatRelativeFrom(row.nextDate.date, now, { locale }),
            // Only a `proposed` date still waits for a person; the rest were confirmed or corrected.
            confirmed: row.nextDate.confirmationState !== 'proposed',
          },
    owner: row.owner?.name ?? null,
    updated: formatDate(row.updatedAt, { locale }),
    updatedAt: new Date(row.updatedAt).toISOString(),
  };
}
