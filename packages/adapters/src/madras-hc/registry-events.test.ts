// Madras HC registry notices (#398): SR numbers, returns, cure deadlines and numbering as anchored
// RegistryEvent proposals.
import { describe, expect, it } from 'vitest';

import { RegistryEventSchema, type ParserInput } from '../types.ts';

import { addPeriod, parseRegistryEvents } from './registry-events.ts';

const input = (text: string): ParserInput => ({
  kind: 'text',
  text,
  meta: { receivedAt: '2026-10-21T00:00:00Z', forumCode: 'in.tn.madras-hc.principal.appellate' },
});
const events = (text: string) =>
  parseRegistryEvents(input(text)).map((event) => RegistryEventSchema.parse(event));

describe('parseRegistryEvents', () => {
  it.each(['SR.No.12345 of 2026', 'S.R. No. 12345/2026', 'SR No.012345/26'])(
    '%s assigns SR 12345/2026',
    (text) => {
      expect(events(`Registered as ${text}.`)).toEqual([
        {
          kind: 'sr_assigned',
          anchor: { page: 1, quote: text, rowIndex: 0 },
          confidence: 0.95,
          srNo: '12345/2026',
        },
      ]);
    },
  );

  it('does not read a serial number as an SR number', () => {
    expect(events('Sr.No.1 of 2026')).toEqual([]);
  });

  it.each([
    ['Papers returned for rectification.', 'returned for rectification'],
    ['The following defects are noted.', 'defects'],
    ['Collect the papers from the seat for returns.', 'seat for returns'],
  ])('%s is a return for defects', (text, quote) => {
    expect(events(text)).toEqual([
      { kind: 'returned_for_defects', anchor: { page: 1, quote, rowIndex: 0 }, confidence: 0.8 },
    ]);
  });

  it('turns re-present within 7 days into a deadline from the printed notice date', () => {
    expect(events('Date: 15.10.2026\nRe-present within 7 days.')).toEqual([
      {
        kind: 'cure_deadline',
        anchor: { page: 1, quote: 'Re-present within 7 days', rowIndex: 1 },
        confidence: 0.9,
        deadline: { n: 7, unit: 'days', basisDate: '2026-10-15', derived: '2026-10-22' },
      },
    ]);
  });

  it('leaves derived null without a printed basis date, and reads word numbers', () => {
    expect(events('re-present the papers within two weeks')).toMatchObject([
      { kind: 'cure_deadline', deadline: { n: 2, unit: 'weeks', basisDate: null, derived: null } },
    ]);
  });

  it('reads numbered as W.P.No. 678 of 2026', () => {
    expect(events('The petition is numbered as W.P.No. 678 of 2026')).toMatchObject([
      {
        kind: 'numbered',
        anchor: { quote: 'numbered as W.P.No. 678 of 2026', rowIndex: 0 },
        caseRef: { caseTypeCode: 'WP', number: '678', year: 2026, matchKey: 'WP/678/2026' },
      },
    ]);
  });

  it('keeps every return of a repeated return, in reading order, and never throws', () => {
    const found = events(
      'returned for defects\nre-presented on 13.10.2026\nreturned for defects again',
    );
    expect(found.map((e) => [e.kind, e.anchor.rowIndex])).toEqual([
      ['returned_for_defects', 0],
      ['returned_for_defects', 2],
    ]);
    expect(events('')).toEqual([]);
    expect(parseRegistryEvents({ ...input(''), text: undefined })).toEqual([]);
  });
});

describe('addPeriod', () => {
  it('adds calendar days, weeks and months', () => {
    expect(addPeriod('2026-10-15', 7, 'days')).toBe('2026-10-22');
    expect(addPeriod('2026-12-28', 1, 'weeks')).toBe('2027-01-04');
    expect(addPeriod('2026-01-31', 1, 'months')).toBe('2026-02-28');
    expect(addPeriod('not a date', 1, 'days')).toBeNull();
  });
});
