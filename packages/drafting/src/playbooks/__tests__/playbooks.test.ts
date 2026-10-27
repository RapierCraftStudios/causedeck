import type { Playbook } from '@causedeck/validators';
import type { Block } from '@causedeck/validators/drafting';
import { describe, expect, it } from 'vitest';

import {
  applyPlaybook,
  applyStyleSettings,
  DEFAULT_STYLE_SETTINGS,
  parseStyleSettings,
  rankForNarratives,
  rankPrecedents,
  type PrecedentCandidate,
} from '../index';

const COURT = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

const cand = (over: Partial<PrecedentCandidate> & { passageId: string }): PrecedentCandidate => ({
  courtId: null,
  kind: 'prayer',
  language: 'en',
  ...over,
});

describe('rankPrecedents', () => {
  const query = { courtId: COURT, kind: 'prayer', language: 'en' };

  it('orders by court, kind, language, then similarity and explains each', () => {
    const ranked = rankPrecedents(
      [
        cand({ passageId: 'c', courtId: OTHER, kind: 'facts', language: 'ta' }),
        cand({ passageId: 'b', courtId: COURT, kind: 'facts', language: 'en' }),
        cand({ passageId: 'a', courtId: COURT, distance: 0.2 }),
      ],
      query,
    );
    expect(ranked.map((r) => r.passageId)).toEqual(['a', 'b', 'c']);
    expect(ranked[0]?.reasons.map((r) => r.code)).toEqual([
      'court',
      'kind',
      'language',
      'similarity',
    ]);
    expect(ranked[2]?.reasons).toEqual([]);
  });

  it('uses similarity as one input only', () => {
    const ranked = rankPrecedents(
      [
        cand({ passageId: 'near', courtId: OTHER, kind: 'facts', language: 'ta', distance: 0 }),
        cand({ passageId: 'match', courtId: COURT }),
      ],
      query,
    );
    expect(ranked[0]?.passageId).toBe('match');
  });

  it('is deterministic: ties break by passage id and input is not mutated', () => {
    const input = [cand({ passageId: 'z' }), cand({ passageId: 'a' })];
    const copy = structuredClone(input);
    expect(rankPrecedents(input, query).map((r) => r.passageId)).toEqual(['a', 'z']);
    expect(rankPrecedents([...input].reverse(), query)).toEqual(rankPrecedents(input, query));
    expect(input).toEqual(copy);
  });

  it('clamps out-of-range distances', () => {
    const ranked = rankPrecedents(
      [cand({ passageId: 'far', distance: 5 }), cand({ passageId: 'near', distance: -3 })],
      query,
    );
    const score = (id: string): number => ranked.find((r) => r.passageId === id)?.score ?? NaN;
    expect(score('near') - score('far')).toBeCloseTo(15);
  });

  it('ranks per narrative block', () => {
    const blocks: Block[] = [
      { type: 'section', children: [{ type: 'narrative', id: 'n1', prompt: 'p', maxChars: 100 }] },
    ];
    const map = rankForNarratives(blocks, [cand({ passageId: 'a' })], () => query);
    expect([...map.keys()]).toEqual(['n1']);
  });
});

const tree = (): Block[] => [
  { type: 'heading', level: 1, text: 'facts of the case' },
  { type: 'paragraph', id: 'salutation', text: 'To, The Court' },
  { type: 'paragraph', text: 'Keep me' },
  {
    type: 'section',
    id: 'prayer',
    children: [{ type: 'paragraph', text: 'old prayer' }],
  },
  {
    type: 'section',
    id: 'annexures',
    children: [
      { type: 'paragraph', text: 'Annexure B' },
      { type: 'paragraph', text: 'Annexure C' },
      { type: 'paragraph', text: 'Annexure A' },
    ],
  },
];

const playbook: Playbook = {
  name: 'Writ',
  courtId: COURT,
  format: 'writ_petition',
  standardPrayers: ['Issue a writ of mandamus', 'Grant costs'],
  annexureOrder: ['Annexure A', 'Annexure B'],
};

describe('applyPlaybook', () => {
  it('changes only the approved prayers and annexure order', () => {
    const input = tree();
    const copy = structuredClone(input);
    const result = applyPlaybook(input, playbook, { courtId: COURT });
    expect(input).toEqual(copy);
    expect(result.changes.map((c) => c.kind)).toEqual(['prayers', 'annexure_order']);
    expect(result.blocks.slice(0, 3)).toEqual(copy.slice(0, 3));
    const prayer = result.blocks[3];
    expect(prayer?.type === 'section' && prayer.children[0]).toMatchObject({
      type: 'list',
      children: [{ text: 'Issue a writ of mandamus' }, { text: 'Grant costs' }],
    });
    const annex = result.blocks[4];
    expect(
      annex?.type === 'section' && annex.children.map((c) => c.type === 'paragraph' && c.text),
    ).toEqual(['Annexure A', 'Annexure B', 'Annexure C']);
  });

  it('does nothing for another court or format', () => {
    const input = tree();
    expect(applyPlaybook(input, playbook, { courtId: OTHER })).toMatchObject({
      changes: [],
      skipped: 'court_mismatch',
    });
    expect(applyPlaybook(input, playbook, { courtId: COURT, format: 'appeal' }).skipped).toBe(
      'format_mismatch',
    );
  });

  it('leaves a playbook with no prayers or order alone', () => {
    const result = applyPlaybook(
      tree(),
      { ...playbook, standardPrayers: [], annexureOrder: [] },
      { courtId: COURT },
    );
    expect(result.changes).toEqual([]);
    expect(result.blocks).toEqual(tree());
  });
});

describe('style profile', () => {
  it('defaults leave blocks unchanged', () => {
    expect(applyStyleSettings(tree(), DEFAULT_STYLE_SETTINGS)).toEqual(tree());
    expect(parseStyleSettings({})).toEqual(DEFAULT_STYLE_SETTINGS);
  });

  it('applies only the explicit settings', () => {
    const out = applyStyleSettings(tree(), {
      headingStyle: 'title',
      numbering: 'roman',
      salutation: 'To, The Hon’ble High Court',
      prayerWording: [{ from: 'Keep me', to: 'Kept, reworded' }],
    });
    expect(out[0]).toMatchObject({ text: 'I. Facts Of The Case' });
    expect(out[1]).toMatchObject({ text: 'To, The Hon’ble High Court' });
    expect(out[2]).toMatchObject({ text: 'Kept, reworded' });
    expect(out.slice(3)).toEqual(tree().slice(3));
  });

  it('is idempotent on numbering', () => {
    const profile = { ...DEFAULT_STYLE_SETTINGS, numbering: 'decimal' as const };
    const once = applyStyleSettings(tree(), profile);
    expect(applyStyleSettings(once, profile)).toEqual(once);
  });

  it('refuses unknown settings', () => {
    expect(() => parseStyleSettings({ tone: 'learned' })).toThrow(/Unknown style setting/);
    expect(() => parseStyleSettings({ headingStyle: 'comic' })).toThrow();
    expect(() => parseStyleSettings({ prayerWording: [{ from: 'a' }] })).toThrow();
  });
});
