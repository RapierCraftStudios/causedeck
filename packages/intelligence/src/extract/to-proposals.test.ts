import { PROPOSAL_KINDS, ProposalDraftSchema } from '@causedeck/validators/proposal-draft';
import { describe, expect, it } from 'vitest';

import type { PageText } from './anchors.ts';
import { preParse } from './preparse.ts';
import { validateExtraction, type ModelOrderOutput } from './validate.ts';
import { anchorKey, collectAnchors, toProposalDrafts } from './to-proposals.ts';

const DOC = '3f2b7d0e-5a41-4b6c-9a52-0d7c1f8e2a11';
const MATTER = '6a1d2c3b-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const PROCEEDING = '7b2e3d4c-5f60-4b7c-9d8e-0f1a2b3c4d5e';
const AI_CALL = '8c3f4e5d-6071-4c8d-8e9f-1a2b3c4d5e6f';

const TEXT = [
  'Dated: 05.01.2026',
  'Issue notice to the respondents.',
  'The respondent shall file counter affidavit within two weeks.',
  'Post on 12.03.2026 for hearing.',
  'Orders reserved.',
].join('\n');
const pages: PageText[] = [{ pageNo: 1, text: TEXT, textSource: 'layer' }];

const model = (): ModelOrderOutput => ({
  bench: [],
  orderDate: null,
  caseNumbers: [],
  neutralCitation: null,
  orderType: 'interim',
  directions: [
    {
      text: 'Issue notice',
      kind: 'filing',
      dueExpression: null,
      dueDate: null,
      page: 1,
      quote: 'Issue notice to the respondents.',
    },
  ],
  nextDate: null,
  stageCues: [],
  confidence: 0.9,
});

function drafts(ai: boolean, confidence = 0.9) {
  const base = validateExtraction({
    documentId: DOC,
    pipelineVersion: 'test',
    pages,
    pre: preParse(pages),
    model: ai ? { ...model(), confidence } : null,
  });
  const anchorIds = new Map(
    collectAnchors(base).map((a, i) => [
      anchorKey(a),
      `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    ]),
  );
  return toProposalDrafts(base, {
    captureId: null,
    matterId: MATTER,
    proceedingId: PROCEEDING,
    aiCallId: AI_CALL,
    anchorIds,
  });
}

describe('toProposalDrafts', () => {
  it('maps next date, order record, dated direction, undated task and stage cue', () => {
    const list = drafts(true);
    const kinds = list.map((d) => d.kind).sort();
    expect(kinds).toEqual(
      ['next_date', 'obligation_from_direction', 'order_record', 'listing_update', 'task'].sort(),
    );
    const next = list.find((d) => d.kind === 'next_date');
    expect(next?.payload).toEqual({ proceedingId: PROCEEDING, date: '2026-03-12' });
    const dated = list.find((d) => d.kind === 'obligation_from_direction');
    expect(dated?.payload).toMatchObject({ matterId: MATTER, dueDate: '2026-01-19' });
    const task = list.find((d) => d.kind === 'task');
    expect(task?.payload).toMatchObject({ title: 'Issue notice' });
    expect(task?.payload).not.toHaveProperty('dueDate');
  });

  it('gives every draft anchors, confidence and the document as its source, and parses', () => {
    for (const d of drafts(true)) {
      expect(d.anchors?.length, d.kind).toBeGreaterThan(0);
      expect(d.confidence).toBeGreaterThan(0);
      expect(d.source).toMatchObject({
        type: 'ai',
        input: 'document',
        ref: DOC,
        aiCallId: AI_CALL,
      });
      // `listing_update` has no stage field in the engine's payload: it is a card, not an apply.
      expect(ProposalDraftSchema.safeParse(d).success, d.kind).toBe(true);
    }
  });

  it('keeps a deterministic-only extraction at 0.6 or less and names no model call', () => {
    for (const d of drafts(false)) {
      expect(d.confidence ?? 0).toBeLessThanOrEqual(0.6);
      expect(d.source.type).toBe('deterministic');
      expect(d.source).not.toHaveProperty('aiCallId');
    }
  });

  it('never proposes an outward action: no outward_draft, no kind that sends or files', () => {
    for (const ai of [true, false]) {
      expect(drafts(ai).map((d) => d.kind)).not.toContain('outward_draft');
    }
  });

  it('sets ambiguous on drafts of an extraction that did not choose', () => {
    const text = `${TEXT}\nPost on 20.04.2026 for final hearing.`;
    const p: PageText[] = [{ pageNo: 1, text, textSource: 'layer' }];
    const e = validateExtraction({
      documentId: DOC,
      pipelineVersion: 't',
      pages: p,
      pre: preParse(p),
      model: null,
    });
    const ids = new Map(
      collectAnchors(e).map((a, i) => [
        anchorKey(a),
        `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      ]),
    );
    const list = toProposalDrafts(e, { anchorIds: ids, proceedingId: PROCEEDING });
    const nexts = list.filter((d) => d.kind === 'next_date');
    expect(nexts).toHaveLength(2);
    expect(nexts.every((d) => d.ambiguous === true)).toBe(true);
  });
});

describe('proposal kinds (static)', () => {
  it('has no L5 level and no kind that sends, files, pays or advises', () => {
    const forbidden = PROPOSAL_KINDS.filter((k) =>
      /send|file|submit|pay|advice|advise|e_?sign|l5/i.test(k),
    );
    expect(forbidden).toEqual([]);
    // The draft names no level at all: the engine's matrix decides (L4 is the highest it knows).
    expect(Object.keys(ProposalDraftSchema.shape)).not.toContain('proposedLevel');
  });
});
