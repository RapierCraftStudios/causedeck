// Server-only loader for the matter workspace (#390, #40 part 3). `getMatterOverview`
// (`@causedeck/core/matter-graph`) runs in the member's workspace scope and applies
// `matterVisibilityPredicate`/`can()`: another workspace's matter, a restricted matter and a
// malformed id all come back as `not-found`, so the route never says whether the matter exists.
// The layout (header) and the Overview page (cards) both need it; React `cache` makes them share
// one read per request. `toOverviewView` turns the read model into what the client cards render,
// with dates already formatted for the locale (court style: weekday first, IST days).
import type {
  ListingDetail,
  MatterDocumentRow,
  MatterOverview,
  NextDateConflictView,
} from '@causedeck/core/matter-graph';
import { formatDate, formatRelativeFrom, type Locale } from '@causedeck/i18n';
import { cache } from 'react';

import { logger } from '../../src/health.ts';
import type { WorkspaceContext } from '../workspace-context.ts';

import { domainErrorCode, graphDeps } from './graph-deps.ts';

export type MatterOverviewLoad =
  | { kind: 'overview'; overview: MatterOverview }
  | { kind: 'not-found' }
  | { kind: 'denied' }
  | { kind: 'error' };

const loadOverview = cache(
  async (workspaceId: string, userId: string, matterId: string): Promise<MatterOverviewLoad> => {
    try {
      // One at a time, not in a Promise.all: concurrent imports race the test mocks.
      const { inWorkspace } = await import('@causedeck/core/runtime');
      const { getMatterOverview } = await import('@causedeck/core/matter-graph');
      const scope = { workspaceId, userId };
      const overview = await inWorkspace(scope, (tx) =>
        getMatterOverview(graphDeps(tx), scope, { matterId }),
      );
      return { kind: 'overview', overview };
    } catch (error) {
      const code = domainErrorCode(error);
      if (code === 'NOT_FOUND' || code === 'VALIDATION') return { kind: 'not-found' };
      if (code === 'FORBIDDEN') return { kind: 'denied' };
      // Only the error object (stack, code) reaches the log, never party data.
      logger.error({ err: error }, 'matter workspace: could not load the matter overview');
      return { kind: 'error' };
    }
  },
);

/** The matter's Overview for the signed-in member, shared by the layout and the page. */
export function loadMatterOverview(
  context: WorkspaceContext,
  matterId: string,
): Promise<MatterOverviewLoad> {
  return loadOverview(context.workspace.id, context.user.id, matterId);
}

/** Where a date came from, as the `ProvenanceChip` needs it (the label is localised client-side). */
export interface SourceView {
  kind: ListingDetail['provenance']['sourceType'];
  state: 'proposed' | 'confirmed' | 'edited';
  sourceRef: string | null;
  confidence: number | null;
}

export interface ListingView {
  listingId: string;
  proceedingId: string;
  date: string;
  /** Court style, weekday first: `Mon, 02 Nov 2026`. */
  text: string;
  relative: string;
  /** Only a `proposed` date still waits for a person. */
  proposed: boolean;
  stage: string | null;
  source: SourceView;
}

export interface ConflictView {
  proceedingId: string;
  current: ListingView;
  proposed: ListingView;
}

type ProceedingState = keyof MatterOverview['proceedings']['byState'];

export interface PersonGroupView {
  kind: MatterOverview['people'][number]['kind'];
  people: { id: string; name: string }[];
}

export interface DocumentView {
  id: string;
  kind: MatterDocumentRow['kind'];
  language: string | null;
  textStatus: MatterDocumentRow['textStatus'];
  added: string;
}

export interface MatterOverviewView {
  id: string;
  title: string;
  status: MatterOverview['header']['status'];
  sensitive: boolean;
  owner: string | null;
  clients: { id: string; name: string }[];
  nextDate: ListingView | null;
  conflicts: ConflictView[];
  proceedings: {
    count: number;
    byState: { state: ProceedingState; count: number }[];
    lead: {
      caseType: string;
      number: string | null;
      year: number | null;
      forum: string;
    } | null;
  };
  openObligations: number;
  recentDocuments: DocumentView[];
  /** Only the role-edge kinds that have people, in `ROLE_EDGE_KINDS` order. */
  people: PersonGroupView[];
  synopsis: string | null;
  synopsisDenied: boolean;
}

function sourceOf(detail: ListingDetail): SourceView {
  const { provenance } = detail;
  const state =
    provenance.confirmationState === 'proposed'
      ? 'proposed'
      : provenance.confirmationState === 'corrected'
        ? 'edited'
        : 'confirmed';
  const confidence = provenance.confidence === null ? null : Number(provenance.confidence);
  return {
    kind: provenance.sourceType,
    state,
    sourceRef: provenance.sourceRef,
    confidence: confidence === null || Number.isNaN(confidence) ? null : confidence,
  };
}

function listingView(detail: ListingDetail, locale: Locale, now: Date): ListingView {
  return {
    listingId: detail.listingId,
    proceedingId: detail.proceedingId,
    date: detail.date,
    text: formatDate(detail.date, { locale, style: 'court' }),
    relative: formatRelativeFrom(detail.date, now, { locale }),
    proposed: detail.confirmationState === 'proposed',
    stage: detail.stage,
    source: sourceOf(detail),
  };
}

function conflictView(conflict: NextDateConflictView, locale: Locale, now: Date): ConflictView {
  return {
    proceedingId: conflict.proceedingId,
    current: listingView(conflict.current, locale, now),
    proposed: listingView(conflict.proposed, locale, now),
  };
}

/** The read model as the Overview cards render it. */
export function toOverviewView(
  overview: MatterOverview,
  { locale, now }: { locale: Locale; now: Date },
): MatterOverviewView {
  const { header, proceedings } = overview;
  const lead = proceedings.lead;
  return {
    id: header.id,
    title: header.title,
    status: header.status,
    sensitive: header.sensitive,
    owner: header.owner?.name ?? null,
    clients: header.clients.map((person) => ({ id: person.id, name: person.name })),
    nextDate: overview.nextDate === null ? null : listingView(overview.nextDate, locale, now),
    conflicts: overview.conflicts.map((conflict) => conflictView(conflict, locale, now)),
    proceedings: {
      count: proceedings.count,
      byState: (Object.keys(proceedings.byState) as ProceedingState[]).map((state) => ({
        state,
        count: proceedings.byState[state] ?? 0,
      })),
      lead:
        lead === null
          ? null
          : {
              caseType: lead.caseType,
              number: lead.number,
              year: lead.year,
              forum:
                lead.forum.seat === null
                  ? lead.forum.court
                  : `${lead.forum.court}, ${lead.forum.seat}`,
            },
    },
    openObligations: overview.openObligations,
    recentDocuments: overview.recentDocuments.map((doc) => ({
      id: doc.id,
      kind: doc.kind,
      language: doc.language,
      textStatus: doc.textStatus,
      added: formatDate(doc.createdAt, { locale }),
    })),
    people: overview.people
      .filter((group) => group.edges.length > 0)
      .map((group) => {
        const seen = new Map<string, { id: string; name: string }>();
        for (const edge of group.edges) {
          seen.set(edge.person.id, { id: edge.person.id, name: edge.person.name });
        }
        return { kind: group.kind, people: [...seen.values()] };
      }),
    synopsis: overview.synopsis?.text ?? null,
    synopsisDenied: overview.synopsisDenied,
  };
}
