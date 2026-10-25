// Karnataka HC registry notices (#407): FR numbers, scrutiny objections and cure deadlines as
// anchored RegistryEvent proposals, with the Madras (#36) relative-deadline model.
import { describe, expect, it } from 'vitest';

import { addPeriod, parseRegistryEvents } from '../madras-hc/registry-events.ts';
import { RegistryEventSchema, type ParserInput } from '../types.ts';

import { parseKarnatakaRegistryEvents } from './registry-events.ts';

const input = (text: string): ParserInput => ({
  kind: 'text',
  text,
  meta: { receivedAt: '2026-10-21T00:00:00Z', forumCode: 'in.ka.karnataka-hc.bengaluru' },
});
const events = (text: string) =>
  parseKarnatakaRegistryEvents(input(text)).map((event) => RegistryEventSchema.parse(event));

describe('parseKarnatakaRegistryEvents', () => {
  it.each([
    'FR No. 1234/2026',
    'F.R. No. 1234 of 2026',
    'FR No.01234/26',
    'Filing Register No. 1234/2026',
    'FILING REGISTER NO. 1234 OF 2026',
  ])('%s assigns FR 1234/2026', (text) => {
    expect(events(`Filed and registered as ${text}.`)).toEqual([
      {
        kind: 'fr_assigned',
        anchor: { page: 1, quote: text, rowIndex: 0 },
        confidence: 0.95,
        frNo: '1234/2026',
      },
    ]);
  });

  it('needs a number: a bare Filing Register No. label or a lower-case fr is no event', () => {
    expect(events('Filing Register No.')).toEqual([]);
    expect(events('fr no 12/2026 and Sr.No.1 of 2026')).toEqual([]);
  });

  it.each([
    ['The following office objections are raised.', 'office objections'],
    ['Objections: 1. Vakalath not signed.', 'Objections'],
    ['The following defects are noticed in the petition.', 'defects'],
    ['Papers returned to the advocate.', 'returned'],
  ])('%s raises an objection', (text, quote) => {
    expect(events(text)).toEqual([
      { kind: 'objection_raised', anchor: { page: 1, quote, rowIndex: 0 }, confidence: 0.8 },
    ]);
  });

  it('turns to be cured within 7 days into a deadline from the printed scrutiny date', () => {
    expect(events('Date: 21.10.2026\nDefects to be cured within 7 days.')).toEqual([
      {
        kind: 'objection_raised',
        anchor: { page: 1, quote: 'Defects', rowIndex: 1 },
        confidence: 0.8,
      },
      {
        kind: 'cure_deadline',
        anchor: { page: 1, quote: 'to be cured within 7 days', rowIndex: 1 },
        confidence: 0.9,
        deadline: { n: 7, unit: 'days', basisDate: '2026-10-21', derived: '2026-10-28' },
      },
    ]);
  });

  it('derives the deadline exactly as the Madras (#36) model does', () => {
    const notice = 'Date of scrutiny: 31.01.2026\nComply within one (1) month.';
    const [cure] = events(notice);
    expect(cure).toMatchObject({
      kind: 'cure_deadline',
      deadline: { n: 1, unit: 'months', basisDate: '2026-01-31', derived: '2026-02-28' },
    });
    expect(cure?.deadline?.derived).toBe(addPeriod('2026-01-31', 1, 'months'));
    const [madras] = parseRegistryEvents(input('Date: 21.10.2026\nRe-present within two weeks.'));
    const [karnataka] = events('Date: 21.10.2026\nRe-present within two weeks.');
    expect(karnataka?.deadline).toEqual(madras?.deadline);
  });

  it('leaves derived null without a printed basis date, and reads word numbers', () => {
    expect(events('Objections to be cured within two weeks')).toMatchObject([
      { kind: 'objection_raised' },
      { kind: 'cure_deadline', deadline: { n: 2, unit: 'weeks', basisDate: null, derived: null } },
    ]);
  });

  it('never reads a statement of objections direction as a registry objection', () => {
    expect(events('Respondents to file statement of objections within four weeks.')).toEqual([]);
    expect(events('File objections statement within 2 weeks; objections noted.')).toMatchObject([
      { kind: 'objection_raised', anchor: { quote: 'objections' } },
    ]);
  });

  it('keeps reading order across lines and pages, with page and row anchors', () => {
    const found = events(
      'FR No. 55/2026 returned with objections\fDated 02.11.2026\nre-present within 10 days',
    );
    expect(found.map((e) => [e.kind, e.anchor.page, e.anchor.rowIndex])).toEqual([
      ['fr_assigned', 1, 0],
      ['objection_raised', 1, 0],
      ['cure_deadline', 2, 1],
    ]);
    expect(found[2]?.deadline).toEqual({
      n: 10,
      unit: 'days',
      basisDate: '2026-11-02',
      derived: '2026-11-12',
    });
  });

  it('only proposes: never throws, never mutates the input and returns plain events', () => {
    const supplied = input('FR No. 1/2026\nDefects to be cured within 3 days');
    const before = structuredClone(supplied);
    const found = parseKarnatakaRegistryEvents(supplied);
    expect(supplied).toEqual(before);
    expect(found.every((event) => RegistryEventSchema.safeParse(event).success)).toBe(true);
    expect(events('')).toEqual([]);
    expect(parseKarnatakaRegistryEvents({ ...input(''), text: undefined })).toEqual([]);
    expect(events('within 0 days, to be cured within 0 days')).toEqual([]);
  });
});
