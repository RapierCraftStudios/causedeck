// The matter graph read model (#41, UI of #33): the nodes, edges and collapsed groups the Timeline
// tab's graph view draws, and the anchors behind the provenance of timeline events. Derived views
// only (docs/product/10 §2): nothing is stored, nothing is written, no events are emitted.
//
// - `getMatterGraph` is `listMatterProceedingsTree` flattened: one node per proceeding with its
//   parent, one edge per link between proceedings of this matter plus a `parent_of` edge for every
//   parent that has no `parent_of` link, and a group for every parent with more than
//   `GRAPH_GROUP_THRESHOLD` miscellaneous children (they are collapsed behind one chip).
//   Links to another matter's proceedings are left out: this view is about one matter.
// - `getTimelineAnchors` reads the quote and page behind the `anchorId`s of timeline events, of a
//   matter whose documents the actor may read. An id that is not an anchor of one of the matter's
//   documents is absent from the result (it never says whether the anchor exists elsewhere).
import { isUuid, schema } from '@causedeck/db';
import { and, eq, inArray } from 'drizzle-orm';

import { invalid } from '../shared/errors.ts';

import { inGraphScope, requireMatter, type GraphActor, type MatterGraphDeps } from './context.ts';
import {
  listMatterProceedingsTree,
  type ForumSummary,
  type ProceedingLinkView,
  type ProceedingNode,
} from './read-models.ts';

const { anchor, document } = schema;

/** A parent with more miscellaneous children than this shows them behind one group chip. */
export const GRAPH_GROUP_THRESHOLD = 3;

/** The most anchors one `getTimelineAnchors` call resolves. */
export const TIMELINE_ANCHORS_MAX = 1000;

export interface GraphNode {
  id: string;
  /** The parent proceeding, null for a root. */
  parentId: string | null;
  kind: ProceedingNode['kind'];
  state: ProceedingNode['state'];
  caseType: string;
  caseTypeCode: string;
  number: string | null;
  year: number | null;
  srNo: string | null;
  frNo: string | null;
  /** Not yet numbered (SR/FR stage). */
  unnumbered: boolean;
  petitioner: string | null;
  respondent: string | null;
  forum: ForumSummary;
}

export type GraphEdgeKind = ProceedingLinkView['kind'];

export interface GraphEdge {
  /** The link's id, or `parent:<child id>` for an edge implied by the tree. */
  id: string;
  from: string;
  to: string;
  kind: GraphEdgeKind;
}

export interface CollapsedGroup {
  /** `group:<parent id>`. */
  id: string;
  parentId: string;
  /** The first member's case type (`W.M.P.`): the chip reads `W.M.P. × 12`. */
  caseType: string;
  memberIds: string[];
}

export interface MatterGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  groups: CollapsedGroup[];
}

/** The matter's proceedings as a graph. Needs `matter.read`; NOT_FOUND like the Overview. */
export async function getMatterGraph(
  deps: MatterGraphDeps,
  actor: GraphActor,
  input: { matterId: string },
): Promise<MatterGraph> {
  const roots = await listMatterProceedingsTree(deps, actor, { matterId: input.matterId });
  return graphOf(roots);
}

/** The graph of a proceedings forest (pure; exported for the unit test). */
export function graphOf(roots: readonly ProceedingNode[]): MatterGraph {
  const nodes: GraphNode[] = [];
  const children = new Map<string, ProceedingNode[]>();
  const walk = (node: ProceedingNode, parentId: string | null) => {
    nodes.push({
      id: node.id,
      parentId,
      kind: node.kind,
      state: node.state,
      caseType: node.caseType,
      caseTypeCode: node.caseTypeCode,
      number: node.number,
      year: node.year,
      srNo: node.srNo,
      frNo: node.frNo,
      unnumbered: node.unnumbered,
      petitioner: node.petitioner,
      respondent: node.respondent,
      forum: node.forum,
    });
    children.set(node.id, node.children);
    for (const child of node.children) walk(child, node.id);
  };
  for (const root of roots) walk(root, null);

  const inMatter = new Set(nodes.map((n) => n.id));
  const edges = new Map<string, GraphEdge>();
  const parentLinked = new Set<string>();
  for (const root of roots) collectLinks(root, inMatter, edges, parentLinked);
  for (const node of nodes) {
    if (node.parentId !== null && !parentLinked.has(node.id)) {
      edges.set(`parent:${node.id}`, {
        id: `parent:${node.id}`,
        from: node.parentId,
        to: node.id,
        kind: 'parent_of',
      });
    }
  }

  const groups: CollapsedGroup[] = [];
  for (const [parentId, kids] of children) {
    const misc = kids.filter((k) => k.kind === 'misc');
    const first = misc[0];
    if (misc.length <= GRAPH_GROUP_THRESHOLD || first === undefined) continue;
    groups.push({
      id: `group:${parentId}`,
      parentId,
      caseType: first.caseType,
      memberIds: misc.map((m) => m.id),
    });
  }
  return { nodes, edges: [...edges.values()], groups };
}

function collectLinks(
  node: ProceedingNode,
  inMatter: ReadonlySet<string>,
  edges: Map<string, GraphEdge>,
  parentLinked: Set<string>,
): void {
  for (const link of node.links) {
    // Each link is listed at both ends; the `from` end owns the edge.
    if (link.direction !== 'from' || !inMatter.has(link.otherProceedingId)) continue;
    edges.set(link.linkId, {
      id: link.linkId,
      from: node.id,
      to: link.otherProceedingId,
      kind: link.kind,
    });
    if (link.kind === 'parent_of') parentLinked.add(link.otherProceedingId);
  }
  for (const child of node.children) collectLinks(child, inMatter, edges, parentLinked);
}

/** The text behind a timeline event's provenance. */
export interface TimelineAnchor {
  id: string;
  documentId: string;
  documentKind: typeof document.$inferSelect.kind;
  pageNo: number;
  quote: string;
}

/**
 * The anchors among `anchorIds` that belong to a document of the matter. Needs `document.read` on
 * a matter the actor may read (NOT_FOUND / FORBIDDEN as `listMatterDocuments`).
 */
export async function getTimelineAnchors(
  deps: MatterGraphDeps,
  actor: GraphActor,
  input: { matterId: string; anchorIds: readonly string[] },
): Promise<TimelineAnchor[]> {
  const ids = [...new Set(input.anchorIds)];
  if (ids.length > TIMELINE_ANCHORS_MAX) throw invalid('Too many anchors');
  if (!isUuid(input.matterId) || !ids.every((id) => isUuid(id))) throw invalid('Invalid id');
  return inGraphScope(deps, actor, async (scope) => {
    const { workspaceId } = scope.actor;
    const owning = await requireMatter(scope, input.matterId, 'document.read');
    if (ids.length === 0) return [];
    const rows = await scope.tx
      .select({
        id: anchor.id,
        documentId: anchor.documentId,
        documentKind: document.kind,
        pageNo: anchor.pageNo,
        quote: anchor.quote,
      })
      .from(anchor)
      .innerJoin(
        document,
        and(eq(document.workspaceId, anchor.workspaceId), eq(document.id, anchor.documentId)),
      )
      .where(
        and(
          eq(anchor.workspaceId, workspaceId),
          eq(document.matterId, owning.id),
          inArray(anchor.id, ids),
        ),
      );
    return rows;
  });
}
