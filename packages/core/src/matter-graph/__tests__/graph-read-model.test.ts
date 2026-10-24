import { describe, expect, it } from 'vitest';

import { graphOf, GRAPH_GROUP_THRESHOLD } from '../graph-read-model.ts';
import type { ProceedingLinkView, ProceedingNode } from '../read-models.ts';

const FORUM = { id: 'f1', court: 'Madras High Court', establishment: null, seat: null };

function node(id: string, over: Partial<ProceedingNode> = {}): ProceedingNode {
  return {
    id,
    kind: 'main',
    state: 'numbered',
    caseType: 'W.P.',
    caseTypeCode: 'wp',
    number: '1',
    year: 2026,
    srNo: null,
    frNo: null,
    diaryNo: null,
    filingNo: null,
    cnr: null,
    unnumbered: false,
    petitioner: null,
    respondent: null,
    forum: FORUM,
    nextDate: null,
    links: [],
    children: [],
    ...over,
  };
}

function link(
  linkId: string,
  kind: ProceedingLinkView['kind'],
  direction: 'from' | 'to',
  otherProceedingId: string,
  otherMatterId: string | null = null,
): ProceedingLinkView {
  return { linkId, kind, direction, otherProceedingId, otherMatterId };
}

describe('graphOf', () => {
  it('turns an appeal chain into nodes and one edge per link', () => {
    const lower = node('os', { caseType: 'O.S.', links: [link('l1', 'appeal_from', 'to', 'as')] });
    const first = node('as', {
      caseType: 'A.S.',
      links: [link('l1', 'appeal_from', 'from', 'os'), link('l2', 'appeal_from', 'to', 'sa')],
    });
    const second = node('sa', {
      caseType: 'S.A.',
      links: [link('l2', 'appeal_from', 'from', 'as')],
    });
    const graph = graphOf([lower, first, second]);
    expect(graph.nodes.map((n) => n.id)).toEqual(['os', 'as', 'sa']);
    expect(graph.edges).toEqual([
      { id: 'l1', from: 'as', to: 'os', kind: 'appeal_from' },
      { id: 'l2', from: 'sa', to: 'as', kind: 'appeal_from' },
    ]);
    expect(graph.groups).toEqual([]);
  });

  it('adds a parent_of edge for a child without a parent_of link, and none when it has one', () => {
    const plain = node('c1', { kind: 'misc', caseType: 'W.M.P.' });
    const linked = node('c2', {
      kind: 'misc',
      caseType: 'W.M.P.',
      links: [link('lp', 'parent_of', 'to', 'main')],
    });
    const main = node('main', {
      children: [plain, linked],
      links: [link('lp', 'parent_of', 'from', 'c2')],
    });
    const graph = graphOf([main]);
    expect(graph.edges).toEqual([
      { id: 'lp', from: 'main', to: 'c2', kind: 'parent_of' },
      { id: 'parent:c1', from: 'main', to: 'c1', kind: 'parent_of' },
    ]);
    expect(graph.nodes.find((n) => n.id === 'c1')?.parentId).toBe('main');
  });

  it('leaves out links to another matter', () => {
    const only = node('a', { links: [link('x', 'connected', 'from', 'elsewhere', 'm2')] });
    expect(graphOf([only]).edges).toEqual([]);
  });

  it('collapses more than the threshold of miscellaneous children into one group', () => {
    const wmps = Array.from({ length: GRAPH_GROUP_THRESHOLD + 1 }, (_, i) =>
      node(`w${String(i)}`, { kind: 'misc', caseType: 'W.M.P.' }),
    );
    const few = Array.from({ length: GRAPH_GROUP_THRESHOLD }, (_, i) =>
      node(`f${String(i)}`, { kind: 'misc', caseType: 'W.M.P.' }),
    );
    const graph = graphOf([node('big', { children: wmps }), node('small', { children: few })]);
    expect(graph.groups).toEqual([
      {
        id: 'group:big',
        parentId: 'big',
        caseType: 'W.M.P.',
        memberIds: wmps.map((w) => w.id),
      },
    ]);
  });

  it('keeps the SR-stage proceeding unnumbered with its SR number', () => {
    const sr = node('sr', { number: null, year: null, srNo: 'SR 123', unnumbered: true });
    const [only] = graphOf([sr]).nodes;
    expect(only).toMatchObject({ unnumbered: true, srNo: 'SR 123', number: null });
  });
});
