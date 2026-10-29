// The demo seed's generated rows (#93), without a database: deterministic, no id shared between the
// two workspaces, no case-outcome language (Rule 36), fictional names only, the PDF watermark.
import { describe, expect, it } from 'vitest';

import {
  DEMO_MATTERS_PER_WORKSPACE,
  DEMO_WORKSPACE_KEYS,
  DEMO_WORKSPACES,
  demoMatterRows,
  FICTIONAL_SUFFIX,
  matterSpecs,
  demoOrderPdf,
} from '../demo/index.ts';
import { demoCourtRows } from '../demo/courts.ts';
import { createPrng, demoId, seedInstant, WORKSPACE_ID_SPAN } from '../demo/shared.ts';

const DAY = '2026-10-21';
const at = seedInstant(DAY);

/** Words of a case outcome sold as a result: a demo never says a matter was won or lost. */
const OUTCOME_MARKETING =
  /\b(won|win|wins|winning|lost|loses|victory|victorious|success(?:ful)?|acquitted|convicted|favou?r(?:ed|able)?|triumph|record)\b/i;

function allIds(key: (typeof DEMO_WORKSPACE_KEYS)[number]): string[] {
  const ws = DEMO_WORKSPACES[key];
  const graph = demoMatterRows(ws, DAY, at);
  const courts = demoCourtRows(ws, at);
  const groups: { id?: string | undefined }[][] = [
    graph.matters,
    graph.persons,
    graph.roleEdges,
    graph.proceedings,
    graph.proceedingLinks,
    graph.documents,
    graph.anchors,
    graph.orders,
    graph.listings,
    graph.hearings,
    graph.obligations,
    graph.tasks,
    courts.forums,
    courts.halls,
    courts.benches,
  ];
  return groups.flatMap((rows) => rows.map((r) => String(r.id)));
}

describe('demo seed content', () => {
  it('generates the same rows on every call', () => {
    for (const key of DEMO_WORKSPACE_KEYS) {
      const ws = DEMO_WORKSPACES[key];
      expect(demoMatterRows(ws, DAY, at)).toEqual(demoMatterRows(ws, DAY, at));
      expect(matterSpecs(ws)).toEqual(matterSpecs(ws));
      expect(matterSpecs(ws)).toHaveLength(DEMO_MATTERS_PER_WORKSPACE);
    }
  });

  it('gives each workspace its own ids, and no id twice within one', () => {
    const a = allIds('chennai-solo');
    const b = allIds('bengaluru-chamber');
    expect(new Set(a).size).toBe(a.length);
    expect(new Set(b).size).toBe(b.length);
    const inA = new Set(a);
    expect(b.filter((id) => inA.has(id))).toEqual([]);
    expect(DEMO_WORKSPACES['chennai-solo'].id).not.toBe(DEMO_WORKSPACES['bengaluru-chamber'].id);
    expect(demoId(1, 1, 1)).not.toBe(demoId(1, 1, 0));
    expect(() => demoId(1, WORKSPACE_ID_SPAN)).toThrow(RangeError);
  });

  it('has a seeded PRNG: same seed same sequence, different seed different', () => {
    const first = createPrng(7);
    const second = createPrng(7);
    const seq = [first(), first(), first()];
    expect(seq).toEqual([second(), second(), second()]);
    expect(seq.every((n) => n >= 0 && n < 1)).toBe(true);
    expect(createPrng(8)()).not.toBe(seq[0]);
  });

  it('says nothing about winning or losing (Rule 36)', () => {
    for (const key of DEMO_WORKSPACE_KEYS) {
      const graph = demoMatterRows(DEMO_WORKSPACES[key], DAY, at);
      const text = [
        ...graph.hearings.map((h) => h.outcome ?? ''),
        ...graph.obligations.flatMap((o) => [o.description, o.basis ?? '', o.closedNote ?? '']),
        ...graph.orders.flatMap((o) => o.operativeDirections?.map((d) => d.text) ?? []),
        ...graph.anchors.map((a) => a.quote),
        ...graph.tasks.map((t) => t.title),
      ];
      expect(text.length).toBeGreaterThan(300);
      for (const line of text) expect(line, line).not.toMatch(OUTCOME_MARKETING);
    }
  });

  it('marks every person and title fictional and keeps the matter mix', () => {
    for (const key of DEMO_WORKSPACE_KEYS) {
      const graph = demoMatterRows(DEMO_WORKSPACES[key], DAY, at);
      for (const p of graph.persons) expect(p.name.endsWith(FICTIONAL_SUFFIX), p.name).toBe(true);
      expect(new Set(graph.matters.map((m) => m.practiceArea)).size).toBeGreaterThanOrEqual(4);
      expect(graph.matters.filter((m) => m.status === 'disposed').length).toBeGreaterThanOrEqual(2);
    }
  });

  it('puts the SYNTHETIC watermark on every order PDF', () => {
    const pdf = demoOrderPdf({ caseNumber: 'WP-DEMO/2026/0001', title: 'Order', lines: ['x'] });
    const text = Buffer.from(pdf.bytes).toString('latin1');
    expect(text.match(/SYNTHETIC/g)?.length).toBeGreaterThanOrEqual(2);
    expect(text).not.toMatch(/IN THE HIGH COURT/i);
  });
});
