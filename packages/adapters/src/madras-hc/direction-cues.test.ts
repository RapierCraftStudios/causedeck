// Madras HC direction cues (#398): absolute next dates carry a date only when the literal is
// printed, relative and time-bound cues stay unresolved, every cue is anchored, and an earlier-order
// date is never a cue date.
import { describe, expect, it } from 'vitest';

import { DirectionCueSchema, type ParserInput } from '../types.ts';

import { findMadrasDirectionCues, maskEarlierOrderDates } from './direction-cues.ts';

const input = (text: string): ParserInput => ({
  kind: 'text',
  text,
  meta: { receivedAt: '2026-10-21T00:00:00Z', forumCode: 'in.tn.madras-hc.principal.appellate' },
});
const cues = (text: string) =>
  findMadrasDirectionCues(input(text)).map((cue) => DirectionCueSchema.parse(cue));

describe('findMadrasDirectionCues', () => {
  it.each([
    ['Post on 12.11.2026.', 'Post on', '2026-11-12'],
    ['Call on 26.11.2026', 'Call on', '2026-11-26'],
    ['list on 3rd December, 2026.', 'list on', '2026-12-03'],
  ])('%s is a next date with the printed date', (text, phrase, date) => {
    expect(cues(text)).toEqual([
      {
        kind: 'next_date',
        text: text.trim(),
        phrase,
        anchor: { page: 1, quote: text.trim(), rowIndex: 0 },
        confidence: 0.95,
        date,
      },
    ]);
  });

  it('gives call on / list on without a printed date no date', () => {
    expect(cues('Call on.')).toMatchObject([{ kind: 'next_date', phrase: 'Call on', date: null }]);
    expect(cues('List on the date fixed by the Registry.')).toMatchObject([
      { kind: 'next_date', date: null },
    ]);
  });

  it.each(['List after four weeks.', 'Post the matter after two weeks.'])(
    '%s is relative and unresolved',
    (text) => {
      expect(cues(text)).toMatchObject([{ kind: 'next_date_relative', date: null, text }]);
    },
  );

  it.each(['Counter within two weeks.', 'Petitioner to file reply within 10 days.'])(
    '%s is time-bound and unresolved',
    (text) => {
      expect(cues(text)).toMatchObject([{ kind: 'time_bound', phrase: 'within', date: null }]);
    },
  );

  it('reads notices, reserved orders and dispensation', () => {
    expect(
      cues('Issue notice.\nOrders reserved.\nPersonal appearance is dispensed with.').map((cue) => [
        cue.kind,
        cue.anchor.rowIndex,
      ]),
    ).toEqual([
      ['notice', 0],
      ['reserved', 1],
      ['dispensed', 2],
    ]);
  });

  it('never uses a date in a reference to an earlier order', () => {
    const found = cues(
      'Post on the date fixed in the order dated 03.03.2019.\nCall on dated 03.03.2019.',
    );
    expect(found).toHaveLength(2);
    expect(found.every((cue) => cue.date === null)).toBe(true);
  });

  it('ignores within without a duration and anchors across pages', () => {
    expect(cues('The relief is within the scope of the writ.')).toEqual([]);
    expect(cues('ORDER\fHeard.\nPost on 12.11.2026.')).toMatchObject([
      { anchor: { page: 2, rowIndex: 1, quote: 'Post on 12.11.2026.' } },
    ]);
  });

  it('splits a line into clauses so each cue quotes its own', () => {
    expect(
      cues('Counter within two weeks. Post the matter after three weeks.').map((cue) => cue.text),
    ).toEqual(['Counter within two weeks.', 'Post the matter after three weeks.']);
  });

  it('uses configured phrases and never throws', () => {
    expect(
      findMadrasDirectionCues(input('Stand over to 12.11.2026.'), { phrases: ['stand over'] }),
    ).toMatchObject([{ kind: 'direction', phrase: 'Stand over' }]);
    expect(cues('')).toEqual([]);
    expect(findMadrasDirectionCues({ ...input(''), text: undefined })).toEqual([]);
  });
});

describe('maskEarlierOrderDates', () => {
  it('masks the date after an earlier-order reference, keeping offsets', () => {
    const text = 'by an order dated 03.03.2019 in W.P.No.1 of 2019';
    const masked = maskEarlierOrderDates(text);
    expect(masked).toHaveLength(text.length);
    expect(masked).not.toContain('03.03.2019');
    expect(maskEarlierOrderDates('Post on 12.11.2026')).toBe('Post on 12.11.2026');
  });
});
