// The Proceedings tab's view (#392): the tree as the client renders it, from the
// `listMatterProceedingsTree` read model. Children stay indented under their main petition, appeals
// follow the proceeding they appeal from (O.S. -> A.S. -> S.A.), SR/FR-stage rows are unnumbered,
// links name the other end when it is in the matter, and only writers get the legal transitions of
// the C02 table (never an illegal one). The case-type nomenclature comes from the adapters per
// forum code, and the client's match key agrees with core's `normaliseCaseType`.
import type { ProceedingNode } from '@causedeck/core/matter-graph';
import { normaliseCaseType, PROCEEDING_TRANSITIONS } from '@causedeck/core/matter-graph';
import { describe, expect, it } from 'vitest';

import { compactCaseTypeCode } from '../lib/matters/case-type-code.ts';
import { caseTypeOptions } from '../lib/matters/case-types.ts';
import { flattenRows, shortLabel, toProceedingTreeView } from '../lib/matters/proceedings-view.ts';

const FORUM = { id: 'f1', court: 'High Court of Madras', establishment: null, seat: 'Chennai' };
const NOW = new Date('2026-10-22T06:00:00Z');

function node(id: string, overrides: Partial<ProceedingNode> = {}): ProceedingNode {
  return {
    id,
    kind: 'main',
    state: 'numbered',
    caseType: 'W.P.',
    caseTypeCode: 'WP',
    number: '12345',
    year: 2026,
    srNo: null,
    frNo: null,
    diaryNo: null,
    filingNo: null,
    cnr: null,
    unnumbered: false,
    petitioner: 'Secret Party',
    respondent: null,
    forum: FORUM,
    nextDate: null,
    links: [],
    children: [],
    ...overrides,
  };
}

const view = (nodes: ProceedingNode[], canWrite = true) =>
  toProceedingTreeView(nodes, {
    locale: 'en',
    now: NOW,
    canWrite,
    transitions: PROCEEDING_TRANSITIONS,
  });

describe('toProceedingTreeView (#392)', () => {
  it('formats a row: case number parts, forum, chips, next date and no party names', () => {
    const [row] = view([
      node('p1', {
        cnr: 'TNMD010012342026',
        diaryNo: '88',
        nextDate: {
          date: '2026-11-02',
          proceedingId: 'p1',
          listingId: 'l1',
          sourceType: 'adapter',
          confirmationState: 'confirmed',
          stage: 'admission',
          canonical: true,
          provenance: {
            sourceType: 'adapter',
            sourceRef: null,
            anchorId: null,
            confidence: null,
            confirmationState: 'confirmed',
            capturedAt: NOW,
          },
        },
      }),
    ]);
    expect(row).toMatchObject({
      id: 'p1',
      depth: 1,
      caseNumber: { type: 'W.P.', number: '12345', year: 2026 },
      label: 'W.P. 12345/2026',
      unnumbered: false,
      forum: 'High Court of Madras, Chennai',
      cnr: 'TNMD010012342026',
      diaryNo: '88',
      stage: 'admission',
    });
    expect(row?.nextDate?.text).toMatch(/02 Nov 2026/);
    expect(JSON.stringify(row)).not.toContain('Secret Party');
  });

  it('marks an SR/FR-stage proceeding unnumbered and labels it by its SR number', () => {
    const [row] = view([
      node('p1', { state: 'sr_fr', number: null, year: null, unnumbered: true, srNo: '4521' }),
    ]);
    expect(row).toMatchObject({ caseNumber: null, unnumbered: true, label: 'W.P. SR 4521' });
  });

  it('indents children and orders appeals after the proceeding they appeal from', () => {
    const os = node('os', { caseType: 'O.S.', number: '1', year: 2020 });
    const as = node('as', {
      kind: 'appeal',
      caseType: 'A.S.',
      number: '2',
      year: 2022,
      links: [
        {
          linkId: 'l1',
          kind: 'appeal_from',
          direction: 'from',
          otherProceedingId: 'os',
          otherMatterId: null,
        },
      ],
    });
    const sa = node('sa', {
      kind: 'appeal',
      caseType: 'S.A.',
      number: '3',
      year: 2024,
      links: [
        {
          linkId: 'l2',
          kind: 'appeal_from',
          direction: 'from',
          otherProceedingId: 'as',
          otherMatterId: null,
        },
      ],
    });
    const wp = node('wp', {
      children: [node('wmp', { kind: 'misc', caseType: 'W.M.P.', number: '7', year: 2026 })],
    });
    // The read model's order is by creation; the S.A. was recorded first.
    const rows = view([sa, wp, as, os]);
    expect(rows.map((r) => r.id)).toEqual(['wp', 'os', 'as', 'sa']);
    expect(rows[0]?.children.map((c) => [c.id, c.depth])).toEqual([['wmp', 2]]);
    expect(rows.find((r) => r.id === 'sa')?.links).toEqual([
      {
        linkId: 'l2',
        kind: 'appeal_from',
        direction: 'from',
        otherLabel: 'A.S. 2/2022',
        otherMatterId: null,
      },
    ]);
    expect(flattenRows(rows).map((r) => r.id)).toEqual(['wp', 'wmp', 'os', 'as', 'sa']);
  });

  it('names a link into another matter only by that matter, and hides parent links', () => {
    const [row] = view([
      node('p1', {
        links: [
          {
            linkId: 'l1',
            kind: 'lower_court',
            direction: 'from',
            otherProceedingId: 'x',
            otherMatterId: 'm2',
          },
          {
            linkId: 'l2',
            kind: 'connected',
            direction: 'to',
            otherProceedingId: 'y',
            otherMatterId: null,
          },
          {
            linkId: 'l3',
            kind: 'parent_of',
            direction: 'from',
            otherProceedingId: 'z',
            otherMatterId: null,
          },
        ],
      }),
    ]);
    expect(row?.links).toEqual([
      {
        linkId: 'l1',
        kind: 'lower_court',
        direction: 'from',
        otherLabel: null,
        otherMatterId: 'm2',
      },
      { linkId: 'l2', kind: 'connected', direction: 'to', otherLabel: null, otherMatterId: null },
    ]);
  });

  it('gives writers exactly the legal transitions and readers none', () => {
    const states = ['filed', 'sr_fr', 'defects', 're_presented', 'numbered', 'disposed'] as const;
    const nodes = states.map((state) => node(state, { state }));
    for (const row of view(nodes)) {
      expect(row.transitions).toEqual([...PROCEEDING_TRANSITIONS[row.state]]);
    }
    expect(view(nodes).find((r) => r.state === 'disposed')?.transitions).toEqual(['numbered']);
    expect(view(nodes).find((r) => r.state === 'filed')?.transitions).toEqual(['sr_fr']);
    for (const row of view(nodes, false)) expect(row.transitions).toEqual([]);
  });

  it('labels a proceeding without a number or SR by its case type', () => {
    expect(shortLabel({ caseType: 'I.A.', number: null, year: null, srNo: null, frNo: null })).toBe(
      'I.A.',
    );
  });
});

describe('case-type nomenclature (#392)', () => {
  it('lists the adapter case types per forum code, and none for a custom forum', () => {
    const madras = caseTypeOptions('in.tn.madras-hc.principal.appellate');
    expect(madras.map((o) => o.code)).toContain('WP');
    expect(madras.find((o) => o.code === 'WA')?.aliases).toContain('Writ Appeal');
    expect(caseTypeOptions('in.ka.karnataka-hc.bengaluru').length).toBeGreaterThan(0);
    expect(caseTypeOptions('in.nclt.bengaluru').map((o) => o.label)).toContain('CP(IB)');
    expect(caseTypeOptions('ws.custom-forum')).toEqual([]);
  });

  it('matches core normaliseCaseType in any punctuation', () => {
    for (const raw of ['W.P.', 'w p', 'W-P', 'Crl.O.P.', 'W.P.(MD)', 'CRL_A', ' wa ']) {
      expect(compactCaseTypeCode(raw), raw).toBe(normaliseCaseType(raw));
    }
    expect(compactCaseTypeCode(' . ')).toBe('');
  });
});
