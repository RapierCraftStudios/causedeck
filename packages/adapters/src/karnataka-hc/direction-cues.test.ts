// Karnataka HC direction cues (#406): absolute next dates carry a date only when the literal is
// printed, relative and time-bound cues stay unresolved, every cue is anchored, and an earlier- or
// impugned-order date is never a cue date.
import { describe, expect, it } from 'vitest';

import { DirectionCueSchema, type ParserInput } from '../types.ts';

import { findKarnatakaDirectionCues, maskKarnatakaEarlierOrderDates } from './direction-cues.ts';

const input = (text: string): ParserInput => ({
  kind: 'text',
  text,
  meta: { receivedAt: '2026-10-22T00:00:00Z', forumCode: 'in.ka.karnataka-hc.bengaluru' },
});
const cues = (text: string) =>
  findKarnatakaDirectionCues(input(text)).map((cue) => DirectionCueSchema.parse(cue));

describe('findKarnatakaDirectionCues', () => {
  it.each([
    ['List on 12.11.2026.', 'List on', '2026-11-12'],
    ['Call on 19.11.2026', 'Call on', '2026-11-19'],
    ['POST ON 3RD DECEMBER, 2026.', 'POST ON', '2026-12-03'],
    ['Adjourned to 26-11-2026.', 'Adjourned to', '2026-11-26'],
  ])('%s is a next date with the printed date', (text, phrase, date) => {
    expect(cues(text)).toEqual([
      {
        kind: 'next_date',
        text,
        phrase,
        anchor: { page: 1, quote: text, rowIndex: 0 },
        confidence: 0.95,
        date,
      },
    ]);
  });

  it('gives call on / list on without a printed date no date', () => {
    expect(cues('Call on.')).toMatchObject([{ kind: 'next_date', phrase: 'Call on', date: null }]);
    expect(cues('List on the date fixed by the Registry.')).toMatchObject([
      { kind: 'next_date', date: null, confidence: 0.6 },
    ]);
  });

  it('leaves relative cues unresolved', () => {
    expect(cues('List after two weeks.')).toEqual([
      {
        kind: 'next_date_relative',
        text: 'List after two weeks.',
        phrase: 'List after',
        anchor: { page: 1, quote: 'List after two weeks.', rowIndex: 0 },
        confidence: 0.85,
        date: null,
      },
    ]);
    expect(cues('List the matter after 4 weeks.')).toMatchObject([
      { kind: 'next_date_relative', phrase: 'List the matter after', date: null },
    ]);
  });

  it('reads time-bound directions only with a duration, unresolved', () => {
    const text = 'Respondents to file statement of objections within four weeks.';
    expect(cues(text)).toEqual([
      {
        kind: 'time_bound',
        text,
        phrase: 'within',
        anchor: { page: 1, quote: text, rowIndex: 0 },
        confidence: 0.85,
        date: null,
      },
    ]);
    expect(cues('The property is within the jurisdiction of this Court.')).toEqual([]);
  });

  it('never emits an earlier or impugned order date as a next date', () => {
    const text = [
      'The petitioner challenges the impugned order dated 03.03.2019 passed by the respondent.',
      'By order dated 01.10.2026 this Court granted time.',
      'The order passed on 15.09.2026 is recalled.',
    ].join('\n');
    expect(cues(text)).toEqual([]);
    const mixed = cues('Vide order dated 01.10.2026, time was granted; list on 12.11.2026.');
    expect(mixed).toHaveLength(1);
    expect(mixed[0]).toMatchObject({ kind: 'next_date', date: '2026-11-12' });
  });

  it('anchors cues by page and row, in reading order', () => {
    const text = 'ORDER\nIssue notice to the respondents.\fRule.\nOrders reserved.';
    expect(cues(text).map((cue) => [cue.kind, cue.anchor.page, cue.anchor.rowIndex])).toEqual([
      ['notice', 1, 1],
      ['rule', 2, 0],
      ['reserved', 2, 1],
    ]);
  });

  it('uses the configured phrases', () => {
    expect(
      findKarnatakaDirectionCues(input('Stand over to 12.11.2026.'), {
        phrases: ['stand over to'],
      }),
    ).toMatchObject([{ kind: 'direction', phrase: 'Stand over to' }]);
  });

  it('returns nothing for empty input', () => {
    expect(cues('')).toEqual([]);
  });
});

describe('maskKarnatakaEarlierOrderDates', () => {
  it('masks the date after an earlier-order reference, keeping offsets', () => {
    const text = 'impugned order dated 03.03.2019 and list on 12.11.2026';
    const masked = maskKarnatakaEarlierOrderDates(text);
    expect(masked).toHaveLength(text.length);
    expect(masked).toBe('impugned order dated ########## and list on 12.11.2026');
  });
});
