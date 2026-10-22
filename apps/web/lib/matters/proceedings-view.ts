// Server-only loader and view for the matter's Proceedings tab (#392, #40 part 4).
// `listMatterProceedingsTree` (`@causedeck/core/matter-graph`) runs in the member's workspace
// scope with the same visibility rule as the Overview: another workspace's matter, a restricted
// matter and a malformed id are all `not-found`. The forum catalogue (`getCourtsIndex`) feeds the
// proceeding form's forum select, each forum with its adapter's case types (case-types.ts).
//
// `toProceedingTreeView` turns the read model into what the client tree renders: the case number
// parts, the `Unnumbered` flag for SR/FR-stage rows, chips, the next date formatted for the locale
// and the links with the other end's label. The legal state transitions of each row
// (`PROCEEDING_TRANSITIONS`, ADR 0016) are worked out here, and only for members who may write,
// so the client never imports core and never renders an illegal transition.
import type { ProceedingLinkView, ProceedingNode } from '@causedeck/core/matter-graph';
import { formatDate, formatRelativeFrom, type Locale } from '@causedeck/i18n';

import { logger } from '../../src/health.ts';
import type { WorkspaceContext } from '../workspace-context.ts';

import { caseTypeOptions, type CaseTypeOption } from './case-types.ts';
import { domainErrorCode, graphDeps } from './graph-deps.ts';

export type ProceedingState = ProceedingNode['state'];
export type ProceedingLinkKind = ProceedingLinkView['kind'];
export type TransitionTable = Readonly<Record<ProceedingState, readonly ProceedingState[]>>;

export interface ForumOption {
  id: string;
  name: string;
  code: string;
  caseTypes: CaseTypeOption[];
}

export type ProceedingsTabLoad =
  | {
      kind: 'tree';
      nodes: ProceedingNode[];
      forums: ForumOption[];
      transitions: TransitionTable;
    }
  | { kind: 'not-found' }
  | { kind: 'denied' }
  | { kind: 'error' };

/** The matter's proceedings tree and the forum catalogue, for the signed-in member. */
export async function loadProceedingsTab(
  context: WorkspaceContext,
  matterId: string,
): Promise<ProceedingsTabLoad> {
  try {
    // One at a time, not in a Promise.all: concurrent imports race the test mocks.
    const { inWorkspace } = await import('@causedeck/core/runtime');
    const { listMatterProceedingsTree, PROCEEDING_TRANSITIONS } =
      await import('@causedeck/core/matter-graph');
    const { getCourtsIndex } = await import('@causedeck/core/court');
    const workspaceId = context.workspace.id;
    const scope = { workspaceId, userId: context.user.id };
    const nodes = await inWorkspace(scope, (tx) =>
      listMatterProceedingsTree(graphDeps(tx), scope, { matterId }),
    );
    const index = await inWorkspace(scope, (tx) => getCourtsIndex(tx, workspaceId));
    const forums = index.cities.flatMap((city) =>
      city.courts.flatMap((court) =>
        court.forums.map((forum) => ({
          id: forum.id,
          name: forum.seat === null ? forum.court : `${forum.court}, ${forum.seat}`,
          code: forum.code,
          caseTypes: caseTypeOptions(forum.code),
        })),
      ),
    );
    return { kind: 'tree', nodes, forums, transitions: PROCEEDING_TRANSITIONS };
  } catch (error) {
    const code = domainErrorCode(error);
    if (code === 'NOT_FOUND' || code === 'VALIDATION') return { kind: 'not-found' };
    if (code === 'FORBIDDEN') return { kind: 'denied' };
    // Only the error object (stack, code) reaches the log, never party data.
    logger.error({ err: error }, 'matter proceedings: could not load the proceedings tree');
    return { kind: 'error' };
  }
}

/** The parts of `W.P. No. 12345 of 2026` (message `matters.workspace.proceedings.caseNumber`). */
export interface CaseNumberView {
  type: string;
  number: string;
  year: number;
}

export interface ProceedingLinkRowView {
  linkId: string;
  kind: ProceedingLinkKind;
  direction: 'from' | 'to';
  /** The other end's short label (`WP 12345/2026`) when it is in this matter. */
  otherLabel: string | null;
  /** The other end's matter when it is another matter the member may read. */
  otherMatterId: string | null;
}

export interface ProceedingRowView {
  id: string;
  depth: number;
  kind: ProceedingNode['kind'];
  state: ProceedingState;
  caseType: string;
  caseNumber: CaseNumberView | null;
  /** Short form for prompts and link chips: `WP 12345/2026`, else the SR/FR number. */
  label: string;
  unnumbered: boolean;
  forum: string;
  forumId: string;
  srNo: string | null;
  frNo: string | null;
  diaryNo: string | null;
  filingNo: string | null;
  cnr: string | null;
  stage: string | null;
  nextDate: { text: string; relative: string } | null;
  links: ProceedingLinkRowView[];
  /** The states this row may move to; empty for members who may not write. */
  transitions: ProceedingState[];
  children: ProceedingRowView[];
}

/** `WP 12345/2026`, else `WP SR 123`, else the case type alone. */
export function shortLabel(node: {
  caseType: string;
  number: string | null;
  year: number | null;
  srNo: string | null;
  frNo: string | null;
}): string {
  if (node.number !== null && node.year !== null) {
    return `${node.caseType} ${node.number}/${String(node.year)}`;
  }
  const unnumbered = node.srNo ?? node.frNo;
  return unnumbered === null ? node.caseType : `${node.caseType} SR ${unnumbered}`;
}

function forumName(forum: ProceedingNode['forum']): string {
  return forum.seat === null ? forum.court : `${forum.court}, ${forum.seat}`;
}

function flatten(nodes: ProceedingNode[]): ProceedingNode[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children)]);
}

/**
 * Siblings with appeals after the proceeding they appeal from (O.S. -> A.S. -> S.A.), else in the
 * read model's order (earliest first).
 */
function appealOrder(nodes: ProceedingNode[]): ProceedingNode[] {
  const ids = new Set(nodes.map((n) => n.id));
  const appealOf = new Map<string, string>();
  for (const node of nodes) {
    for (const link of node.links) {
      // `from` appeal_from `to`: this proceeding appeals from the other.
      if (
        link.kind === 'appeal_from' &&
        link.direction === 'from' &&
        ids.has(link.otherProceedingId)
      ) {
        appealOf.set(node.id, link.otherProceedingId);
      }
    }
  }
  const out: ProceedingNode[] = [];
  const placed = new Set<string>();
  const place = (node: ProceedingNode, seen: Set<string>) => {
    if (placed.has(node.id) || seen.has(node.id)) return;
    seen.add(node.id);
    placed.add(node.id);
    out.push(node);
    for (const next of nodes) {
      if (appealOf.get(next.id) === node.id) place(next, seen);
    }
  };
  for (const node of nodes) {
    const source = appealOf.get(node.id);
    if (source === undefined || placed.has(source)) place(node, new Set());
  }
  for (const node of nodes) place(node, new Set());
  return out;
}

/** The proceedings tree as the tab renders it. */
export function toProceedingTreeView(
  nodes: ProceedingNode[],
  {
    locale,
    now,
    canWrite,
    transitions,
  }: { locale: Locale; now: Date; canWrite: boolean; transitions: TransitionTable },
): ProceedingRowView[] {
  const labels = new Map(flatten(nodes).map((node) => [node.id, shortLabel(node)]));
  const view = (node: ProceedingNode, depth: number): ProceedingRowView => ({
    id: node.id,
    depth,
    kind: node.kind,
    state: node.state,
    caseType: node.caseType,
    caseNumber:
      node.number !== null && node.year !== null
        ? { type: node.caseType, number: node.number, year: node.year }
        : null,
    label: labels.get(node.id) ?? node.caseType,
    unnumbered: node.unnumbered,
    forum: forumName(node.forum),
    forumId: node.forum.id,
    srNo: node.srNo,
    frNo: node.frNo,
    diaryNo: node.diaryNo,
    filingNo: node.filingNo,
    cnr: node.cnr,
    stage: node.nextDate?.stage ?? null,
    nextDate:
      node.nextDate === null
        ? null
        : {
            text: formatDate(node.nextDate.date, { locale, style: 'court' }),
            relative: formatRelativeFrom(node.nextDate.date, now, { locale }),
          },
    links: node.links
      // A parent pair is already the tree's indentation.
      .filter((link) => link.kind !== 'parent_of')
      .map((link) => ({
        linkId: link.linkId,
        kind: link.kind,
        direction: link.direction,
        otherLabel: labels.get(link.otherProceedingId) ?? null,
        otherMatterId: link.otherMatterId,
      })),
    transitions: canWrite ? [...transitions[node.state]] : [],
    children: appealOrder(node.children).map((child) => view(child, depth + 1)),
  });
  return appealOrder(nodes).map((node) => view(node, 1));
}

/** Every row of the tree, depth first (for pickers and the split selection). */
export function flattenRows(rows: ProceedingRowView[]): ProceedingRowView[] {
  return rows.flatMap((row) => [row, ...flattenRows(row.children)]);
}
