import { describe, expect, it } from 'vitest';

import {
  COLUMN_GAP,
  INDENT,
  NODE_WIDTH,
  layoutGraph,
  type LayoutEdgeInput,
  type LayoutInput,
} from '../components/matters/graph/graph-layout.ts';

const APPEAL_CHAIN: LayoutInput = {
  nodes: [
    { id: 'sa', parentId: null },
    { id: 'os', parentId: null },
    { id: 'as', parentId: null },
  ],
  edges: [
    { id: 'l2', from: 'sa', to: 'as', kind: 'appeal_from' },
    { id: 'l1', from: 'as', to: 'os', kind: 'appeal_from' },
  ],
  groups: [],
};

const WITH_GROUP: LayoutInput = {
  nodes: [
    { id: 'main', parentId: null },
    ...['w1', 'w2', 'w3', 'w4'].map((id) => ({ id, parentId: 'main' })),
    { id: 'aside', parentId: 'main' },
  ],
  edges: [
    ...['w1', 'w2', 'w3', 'w4', 'aside'].map((id): LayoutEdgeInput => ({
      id: `parent:${id}`,
      from: 'main',
      to: id,
      kind: 'parent_of',
    })),
  ],
  groups: [{ id: 'group:main', parentId: 'main', memberIds: ['w1', 'w2', 'w3', 'w4'] }],
};

function column(layout: ReturnType<typeof layoutGraph>, id: string) {
  const item = layout.items.find((i) => i.id === id);
  if (item === undefined) throw new Error(`no item ${id}`);
  return item;
}

describe('layoutGraph', () => {
  it('is deterministic: the same data, in any edge order, gives the same layout', () => {
    const first = layoutGraph(APPEAL_CHAIN);
    const again = layoutGraph(APPEAL_CHAIN);
    const reversed = layoutGraph({ ...APPEAL_CHAIN, edges: [...APPEAL_CHAIN.edges].reverse() });
    expect(JSON.stringify(again)).toBe(JSON.stringify(first));
    expect(JSON.stringify(reversed)).toBe(JSON.stringify(first));
  });

  it('reads an appeal chain left to right, lower court first, whatever the input order', () => {
    const layout = layoutGraph(APPEAL_CHAIN);
    expect(column(layout, 'os').column).toBe(0);
    expect(column(layout, 'as').column).toBe(1);
    expect(column(layout, 'sa').column).toBe(2);
    expect(column(layout, 'as').x).toBe(NODE_WIDTH + COLUMN_GAP);
    const appeal = layout.edges.find((e) => e.id === 'l1');
    expect(appeal).toMatchObject({ source: 'os', target: 'as', kind: 'appeal_from' });
  });

  it('indents children and keeps them in the parent column', () => {
    const layout = layoutGraph({
      nodes: [
        { id: 'p', parentId: null },
        { id: 'c', parentId: 'p' },
      ],
      edges: [{ id: 'parent:c', from: 'p', to: 'c', kind: 'parent_of' }],
      groups: [],
    });
    expect(column(layout, 'c').x - column(layout, 'p').x).toBe(INDENT);
    expect(column(layout, 'c').column).toBe(0);
    expect(column(layout, 'c').y).toBeGreaterThan(column(layout, 'p').y);
  });

  it('folds a group behind one item and joins its members through the group', () => {
    const folded = layoutGraph(WITH_GROUP);
    expect(folded.items.map((i) => i.id)).toEqual(['main', 'group:main', 'aside']);
    const parentEdges = folded.edges.filter((e) => e.kind === 'parent_of');
    expect(parentEdges.map((e) => e.target)).toEqual(['aside', 'group:main']);
  });

  it('shows the members of an expanded group below it', () => {
    const open = layoutGraph({ ...WITH_GROUP, expanded: new Set(['group:main']) });
    expect(open.items.map((i) => i.id)).toEqual([
      'main',
      'group:main',
      'w1',
      'w2',
      'w3',
      'w4',
      'aside',
    ]);
    expect(column(open, 'w1').groupId).toBe('group:main');
    expect(open.height).toBeGreaterThan(layoutGraph(WITH_GROUP).height);
  });

  it('survives a cycle of appeals', () => {
    const layout = layoutGraph({
      nodes: [
        { id: 'a', parentId: null },
        { id: 'b', parentId: null },
      ],
      edges: [
        { id: '1', from: 'a', to: 'b', kind: 'appeal_from' },
        { id: '2', from: 'b', to: 'a', kind: 'appeal_from' },
      ],
      groups: [],
    });
    expect(layout.items).toHaveLength(2);
  });
});
