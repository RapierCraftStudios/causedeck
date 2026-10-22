// The matter graph's layout (#41): a pure function from the matter's proceedings, links and
// collapsed groups to boxes and connector paths. No React, no DOM, no random or clock: the same
// data always gives the same layout (graph-layout.test.ts), so the view, the stories and the
// visual baselines agree.
//
// - Rows follow the `parent_of` tree in reading order (`d3-hierarchy`), a child indented under its
//   parent. A parent's miscellaneous children sit behind one group item unless it is expanded.
// - Columns follow appeals: a proceeding that is `appeal_from` (or `lower_court` of) another sits
//   one column to its right, so chains read left to right from the lower court to the higher
//   (O.S. -> A.S. -> S.A.). The link's `from` is the higher one, `to` the lower. Children stay in
//   their parent's column.
// - Connectors are plain SVG path strings from `d3-shape` (`line`, `linkHorizontal`); nothing else
//   from d3 and no graph library, to keep the route inside its JS budget.
import { hierarchy } from 'd3-hierarchy';
import { line, linkHorizontal } from 'd3-shape';

export type LayoutEdgeKind = 'parent_of' | 'appeal_from' | 'connected' | 'lower_court';

export interface LayoutNodeInput {
  id: string;
  parentId: string | null;
}

export interface LayoutGroupInput {
  /** `group:<parent id>`. */
  id: string;
  parentId: string;
  memberIds: readonly string[];
}

export interface LayoutEdgeInput {
  id: string;
  from: string;
  to: string;
  kind: LayoutEdgeKind;
}

export interface LayoutInput {
  nodes: readonly LayoutNodeInput[];
  edges: readonly LayoutEdgeInput[];
  groups: readonly LayoutGroupInput[];
  /** Ids of the groups showing their members. */
  expanded?: ReadonlySet<string>;
}

export interface LayoutItem {
  id: string;
  type: 'node' | 'group';
  x: number;
  y: number;
  width: number;
  height: number;
  /** Indent level under the roots. */
  depth: number;
  /** Appeal column, from 0. */
  column: number;
  /** The expanded group a member belongs to. */
  groupId: string | null;
}

export interface LayoutEdge {
  id: string;
  kind: LayoutEdgeKind;
  /** The item ids the path joins, in drawing order (appeals: lower court first). */
  source: string;
  target: string;
  path: string;
  /** Where the text label sits (`appeal`), at the path's midpoint. */
  label: { x: number; y: number };
}

export interface Layout {
  items: LayoutItem[];
  edges: LayoutEdge[];
  width: number;
  height: number;
}

export const NODE_WIDTH = 220;
export const NODE_HEIGHT = 56;
export const GROUP_HEIGHT = 44;
export const ROW_GAP = 12;
export const COLUMN_GAP = 56;
export const INDENT = 16;

interface Row {
  id: string;
  type: 'node' | 'group';
  depth: number;
  groupId: string | null;
  children: Row[];
}

const ROOT = '__root';

/** The rows of the tree in reading order, groups folded unless expanded. */
function rowsOf(input: LayoutInput): Row[] {
  const expanded = input.expanded ?? new Set<string>();
  const known = new Set(input.nodes.map((n) => n.id));
  const groupOf = new Map<string, LayoutGroupInput>();
  for (const group of input.groups)
    for (const member of group.memberIds) groupOf.set(member, group);
  const kids = new Map<string | null, LayoutNodeInput[]>();
  for (const node of input.nodes) {
    const parent = node.parentId !== null && known.has(node.parentId) ? node.parentId : null;
    kids.set(parent, [...(kids.get(parent) ?? []), node]);
  }
  const build = (parent: string | null, depth: number): Row[] => {
    const rows: Row[] = [];
    const placed = new Set<string>();
    for (const node of kids.get(parent) ?? []) {
      const group = groupOf.get(node.id);
      if (group !== undefined && group.parentId === parent) {
        if (placed.has(group.id)) continue;
        placed.add(group.id);
        const members = (kids.get(parent) ?? []).filter((k) => group.memberIds.includes(k.id));
        rows.push({
          id: group.id,
          type: 'group',
          depth,
          groupId: null,
          children: expanded.has(group.id)
            ? members.map((m) => ({
                id: m.id,
                type: 'node' as const,
                depth: depth + 1,
                groupId: group.id,
                children: build(m.id, depth + 2),
              }))
            : [],
        });
        continue;
      }
      rows.push({
        id: node.id,
        type: 'node',
        depth,
        groupId: null,
        children: build(node.id, depth + 1),
      });
    }
    return rows;
  };
  return build(null, 0);
}

/** Appeal column of every node: one right of the proceeding it appeals from, else its parent's. */
function columnsOf(input: LayoutInput): Map<string, number> {
  const parentOf = new Map(input.nodes.map((n) => [n.id, n.parentId]));
  const lowerOf = new Map<string, string>();
  for (const edge of [...input.edges].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if ((edge.kind === 'appeal_from' || edge.kind === 'lower_court') && !lowerOf.has(edge.from)) {
      lowerOf.set(edge.from, edge.to);
    }
  }
  const columns = new Map<string, number>();
  const column = (id: string, seen: Set<string>): number => {
    const known = columns.get(id);
    if (known !== undefined) return known;
    if (seen.has(id)) return 0;
    seen.add(id);
    const lower = lowerOf.get(id);
    const parent = parentOf.get(id) ?? null;
    let value = 0;
    if (lower !== undefined && parentOf.has(lower)) value = column(lower, seen) + 1;
    else if (parent !== null && parentOf.has(parent)) value = column(parent, seen);
    columns.set(id, value);
    return value;
  };
  for (const node of input.nodes) column(node.id, new Set());
  return columns;
}

const elbow = line();
const bezier = linkHorizontal<
  { source: [number, number]; target: [number, number] },
  [number, number]
>()
  .source((d) => d.source)
  .target((d) => d.target);

/** Lay the graph out. */
export function layoutGraph(input: LayoutInput): Layout {
  const root = hierarchy<Row>({
    id: ROOT,
    type: 'node',
    depth: -1,
    groupId: null,
    children: rowsOf(input),
  });
  const columns = columnsOf(input);
  const items: LayoutItem[] = [];
  let y = 0;
  root.eachBefore((entry) => {
    if (entry.data.id === ROOT) return;
    const { id, type, depth, groupId } = entry.data;
    const column = columns.get(type === 'group' ? parentOfGroup(input, id) : id) ?? 0;
    const height = type === 'group' ? GROUP_HEIGHT : NODE_HEIGHT;
    items.push({
      id,
      type,
      x: column * (NODE_WIDTH + COLUMN_GAP) + depth * INDENT,
      y,
      width: NODE_WIDTH - depth * INDENT,
      height,
      depth,
      column,
      groupId,
    });
    y += height + ROW_GAP;
  });

  const byId = new Map(items.map((item) => [item.id, item]));
  // A member behind a folded group is reached through the group's item.
  const folded = new Map<string, string>();
  for (const group of input.groups) {
    if (!(input.expanded ?? new Set<string>()).has(group.id)) {
      for (const member of group.memberIds) folded.set(member, group.id);
    }
  }
  const find = (id: string) => byId.get(id) ?? byId.get(folded.get(id) ?? '');

  const edges: LayoutEdge[] = [];
  const drawn = new Set<string>();
  for (const edge of [...input.edges].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    const appeal = edge.kind === 'appeal_from' || edge.kind === 'lower_court';
    // Appeals are drawn from the lower court (`to`) to the higher (`from`).
    const a = find(appeal ? edge.to : edge.from);
    const b = find(appeal ? edge.from : edge.to);
    if (a === undefined || b === undefined || a.id === b.id) continue;
    const key = `${edge.kind}:${a.id}:${b.id}`;
    if (drawn.has(key)) continue;
    drawn.add(key);
    edges.push(connector(edge, a, b));
  }
  const width = Math.max(0, ...items.map((i) => i.x + i.width));
  return { items, edges, width, height: Math.max(0, y - ROW_GAP) };
}

function parentOfGroup(input: LayoutInput, groupId: string): string {
  return input.groups.find((g) => g.id === groupId)?.parentId ?? '';
}

function connector(edge: LayoutEdgeInput, a: LayoutItem, b: LayoutItem): LayoutEdge {
  const ay = a.y + a.height / 2;
  const by = b.y + b.height / 2;
  let path: string;
  let label: { x: number; y: number };
  if (edge.kind === 'parent_of') {
    const x = a.x + INDENT / 2;
    path =
      elbow([
        [x, a.y + a.height],
        [x, by],
        [b.x, by],
      ]) ?? '';
    label = { x, y: by };
  } else if (b.x >= a.x + a.width + COLUMN_GAP / 2) {
    const start: [number, number] = [a.x + a.width, ay];
    const end: [number, number] = [b.x, by];
    path = bezier({ source: start, target: end }) ?? '';
    label = { x: (start[0] + end[0]) / 2, y: (start[1] + end[1]) / 2 };
  } else {
    // Same column: leave by the right edge, run down the gutter and come back in.
    const gutter = Math.max(a.x + a.width, b.x + b.width) + COLUMN_GAP / 3;
    path =
      elbow([
        [a.x + a.width, ay],
        [gutter, ay],
        [gutter, by],
        [b.x + b.width, by],
      ]) ?? '';
    label = { x: gutter, y: (ay + by) / 2 };
  }
  return { id: edge.id, kind: edge.kind, source: a.id, target: b.id, path, label };
}
