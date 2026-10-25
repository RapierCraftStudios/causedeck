// Server-only loader and view for the matter's Timeline tab (#41). `getMatterGraph`,
// `getMatterTimeline` and `getTimelineAnchors` (`@causedeck/core/matter-graph`) run in the member's
// workspace scope with the same visibility rule as the Overview: another workspace's matter, a
// restricted matter and a malformed id are all `not-found`. Only the kinds of event the member's
// role allows are read (`TIMELINE_KIND_PERMISSIONS`), so the client never receives the rest, and
// the anchors behind provenance (quote and page) only with `document.read`.
//
// `toTimelineView` turns the read models into what the client renders: dates formatted for the
// locale, the month each event falls in, past or future, the provenance as the Provenance Chip's
// vocabulary, the "Open source" href into the Documents tab, and the graph's nodes with the case
// number, forum abbreviation and the relations as text. Bench is only ever the court-published
// composition of one event: nothing here counts, ranks or summarises per judge.
import type {
  GraphEdge,
  GraphNode,
  MatterGraph,
  TimelineAnchor,
  TimelineEvent,
} from '@causedeck/core/matter-graph';
import { formatDate, type Locale } from '@causedeck/i18n';
import type { Anchor, ProvenanceSource } from '@causedeck/ui/patterns';

import { logger } from '../../src/health.ts';
import { can, type WorkspaceContext } from '../workspace-context.ts';

import { documentPreviewHref } from './documents-tab.ts';
import { domainErrorCode, graphDeps } from './graph-deps.ts';
import { shortLabel } from './proceedings-view.ts';
import { allowedTimelineKinds, type TimelineKind } from './timeline-tab.ts';

export type TimelineTabLoad =
  | {
      kind: 'timeline';
      events: TimelineEvent[];
      graph: MatterGraph;
      anchors: TimelineAnchor[];
      /** The kinds this member may see. */
      kinds: TimelineKind[];
    }
  | { kind: 'not-found' }
  | { kind: 'denied' }
  | { kind: 'error' };

/** The matter's graph, timeline and provenance anchors, for the signed-in member. */
export async function loadTimelineTab(
  context: WorkspaceContext,
  matterId: string,
): Promise<TimelineTabLoad> {
  try {
    // One at a time, not in a Promise.all: concurrent imports race the test mocks.
    const { inWorkspace } = await import('@causedeck/core/runtime');
    const { getMatterGraph, getMatterTimeline, getTimelineAnchors } =
      await import('@causedeck/core/matter-graph');
    const scope = { workspaceId: context.workspace.id, userId: context.user.id };
    const kinds = allowedTimelineKinds((permission) =>
      can(context.role, permission as Parameters<typeof can>[1]),
    );
    const graph = await inWorkspace(scope, (tx) =>
      getMatterGraph(graphDeps(tx), scope, { matterId }),
    );
    const events = await inWorkspace(scope, (tx) =>
      getMatterTimeline(graphDeps(tx), scope, { matterId, kinds }),
    );
    const anchorIds = [
      ...new Set(events.flatMap((e) => (e.anchorId === null ? [] : [e.anchorId]))),
    ];
    const anchors =
      anchorIds.length > 0 && can(context.role, 'document.read')
        ? await inWorkspace(scope, (tx) =>
            getTimelineAnchors(graphDeps(tx), scope, { matterId, anchorIds }),
          )
        : [];
    return { kind: 'timeline', events, graph, anchors, kinds };
  } catch (error) {
    const code = domainErrorCode(error);
    if (code === 'NOT_FOUND' || code === 'VALIDATION') return { kind: 'not-found' };
    if (code === 'FORBIDDEN') return { kind: 'denied' };
    // Only the error object (stack, code) reaches the log, never party data.
    logger.error({ err: error }, 'matter timeline: could not load the timeline');
    return { kind: 'error' };
  }
}

export interface TimelineEventView {
  id: string;
  kind: TimelineKind;
  /** The court day, `YYYY-MM-DD`. */
  date: string;
  dateText: string;
  /** `YYYY-MM`, the sticky month heading the event falls under. */
  monthKey: string;
  monthText: string;
  /** After today (IST): shown muted, with a dotted connector. */
  future: boolean;
  /** Not yet confirmed: shown with a "To confirm" pill, never as fact. */
  proposed: boolean;
  proceedingId: string | null;
  proceedingLabel: string | null;
  /** Text from the court record or the lawyer (stage, obligation, reason); null when none. */
  subject: string | null;
  /** The kind-specific enum value (order type, document kind, list type). */
  qualifier: string | null;
  /** State change: the states left and entered. */
  fromState: string | null;
  toState: string | null;
  /** For the text search: lower-case summary words. */
  searchText: string;
  source: ProvenanceSource;
  anchor: Anchor | null;
  /** The Documents tab with the preview open at the source page; null without a document. */
  openSourceHref: string | null;
}

export interface GraphNodeView {
  id: string;
  parentId: string | null;
  /** `WP 12345/2026`, else the SR/FR number. */
  label: string;
  caseType: string;
  caseNumber: { number: string; year: number } | null;
  unnumbered: boolean;
  /** The SR or FR number of an unnumbered proceeding. */
  srFrNo: string | null;
  forum: string;
  state: GraphNode['state'];
  /** `appeal from W.P. 678/2026`: the node's links as text, for its accessible description. */
  relations: { kind: GraphEdge['kind']; direction: 'from' | 'to'; label: string }[];
}

export interface TimelineView {
  events: TimelineEventView[];
  nodes: GraphNodeView[];
  edges: GraphEdge[];
  groups: MatterGraph['groups'];
  /** The kinds the member may filter by. */
  kinds: TimelineKind[];
}

export type SourceLabels = Readonly<Record<ProvenanceSource['kind'], string>>;

const COURT_HEADINGS: ReadonlyArray<[RegExp, string]> = [
  [/\bhigh court\b/i, 'HC'],
  [/\bsupreme court\b/i, 'SC'],
  [/\bdistrict court\b/i, 'DC'],
  [/\bcourt\b/i, 'Court'],
];

/** `Madras High Court` -> `Madras HC`; the seat is left out. */
export function forumAbbreviation(court: string): string {
  let short = court;
  for (const [pattern, replacement] of COURT_HEADINGS) {
    if (pattern.test(short)) {
      short = short.replace(pattern, replacement);
      break;
    }
  }
  return short.trim();
}

function confirmation(state: TimelineEvent['provenance']['confirmationState']) {
  if (state === 'corrected') return 'edited' as const;
  if (state === 'proposed') return 'proposed' as const;
  return 'confirmed' as const;
}

function confidenceOf(value: string | null): number | undefined {
  if (value === null) return undefined;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : undefined;
}

/** The IST day `YYYY-MM-DD` of `now`. */
export function istDay(now: Date): string {
  return new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}

function subjectOf(event: TimelineEvent): string | null {
  switch (event.kind) {
    case 'listing':
      return event.stageRaw;
    case 'hearing':
      return event.outcome ?? event.adjournmentReason;
    case 'obligation_due':
    case 'obligation_closed':
      return event.description;
    case 'state_change':
      return event.reason;
    default:
      return null;
  }
}

function qualifierOf(event: TimelineEvent): string | null {
  switch (event.kind) {
    case 'listing':
      return event.listType;
    case 'order':
      return event.orderType;
    case 'document_added':
      return event.documentKind;
    default:
      return null;
  }
}

/** The client's view of a loaded timeline tab. */
export function toTimelineView(
  load: Extract<TimelineTabLoad, { kind: 'timeline' }>,
  options: {
    locale: Locale;
    now: Date;
    slug: string;
    matterId: string;
    sourceLabels: SourceLabels;
    documentTitle: (kind: string) => string;
  },
): TimelineView {
  const { locale, now, slug, matterId, sourceLabels, documentTitle } = options;
  const labels = new Map(load.graph.nodes.map((node) => [node.id, shortLabel(node)]));
  const anchors = new Map(load.anchors.map((a) => [a.id, a]));
  const today = istDay(now);

  const events = load.events.map((event): TimelineEventView => {
    const found = event.anchorId === null ? undefined : anchors.get(event.anchorId);
    const sourceKind = event.provenance.sourceType;
    const source: ProvenanceSource = {
      kind: sourceKind,
      label: sourceLabels[sourceKind],
      state: confirmation(event.provenance.confirmationState),
      ...(found === undefined
        ? {}
        : { anchorId: found.id, quote: found.quote, page: found.pageNo }),
      ...(confidenceOf(event.provenance.confidence) === undefined
        ? {}
        : { confidence: confidenceOf(event.provenance.confidence) as number }),
    };
    const anchor: Anchor | null =
      found === undefined
        ? null
        : {
            id: found.id,
            documentTitle: documentTitle(found.documentKind),
            quote: found.quote,
            page: found.pageNo,
          };
    const proceedingLabel =
      event.proceedingId === null ? null : (labels.get(event.proceedingId) ?? null);
    const subject = subjectOf(event);
    const dateText = formatDate(`${event.date}T00:00:00+05:30`, { locale });
    const monthText = dateText.split(' ').slice(1).join(' ');
    return {
      id: `${event.kind}:${event.id}`,
      kind: event.kind,
      date: event.date,
      dateText,
      monthKey: event.date.slice(0, 7),
      monthText,
      future: event.date > today,
      proposed: event.provenance.confirmationState === 'proposed',
      proceedingId: event.proceedingId,
      proceedingLabel,
      subject,
      qualifier: qualifierOf(event),
      fromState: event.kind === 'state_change' ? event.from : null,
      toState: event.kind === 'state_change' ? event.to : null,
      searchText: [proceedingLabel, subject, qualifierOf(event)]
        .filter((part): part is string => part !== null)
        .join(' ')
        .toLowerCase(),
      source,
      anchor,
      openSourceHref:
        found === undefined
          ? null
          : documentPreviewHref(slug, matterId, found.documentId, found.pageNo),
    };
  });

  const nodes = load.graph.nodes.map((node): GraphNodeView => {
    const relations: GraphNodeView['relations'] = [];
    for (const edge of load.graph.edges) {
      if (edge.kind === 'parent_of') continue;
      if (edge.from === node.id) {
        relations.push({ kind: edge.kind, direction: 'from', label: labels.get(edge.to) ?? '' });
      } else if (edge.to === node.id) {
        relations.push({ kind: edge.kind, direction: 'to', label: labels.get(edge.from) ?? '' });
      }
    }
    return {
      id: node.id,
      parentId: node.parentId,
      label: labels.get(node.id) ?? node.caseType,
      caseType: node.caseType,
      caseNumber:
        node.number !== null && node.year !== null
          ? { number: node.number, year: node.year }
          : null,
      unnumbered: node.unnumbered,
      srFrNo: node.unnumbered ? (node.srNo ?? node.frNo) : null,
      forum: forumAbbreviation(node.forum.court),
      state: node.state,
      relations,
    };
  });

  return { events, nodes, edges: load.graph.edges, groups: load.graph.groups, kinds: load.kinds };
}
