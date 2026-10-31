import { describe, expect, it } from 'vitest';

import {
  parseHolidayListLines,
  parseVacationRangeLines,
  parseVacationRangesHtml,
  parseVacationRangesText,
  vacationRangeFromLine,
  vacationRangeFromTitle,
} from '../index.ts';
import { buildNotice } from '../types.ts';

const CONFIG = {
  baseUrl: 'https://court.example/notices',
  defaultForumCodes: ['x'],
  benchKeywords: {},
};

describe('vacation ranges (#650)', () => {
  it('reads from/to of a vacation line in the common phrasings', () => {
    expect(vacationRangeFromLine('Summer Vacation from 01.06.2026 to 30.06.2026')).toEqual({
      from: '2026-06-01',
      to: '2026-06-30',
      name: 'Summer Vacation',
    });
    expect(vacationRangeFromLine('1. Winter recess: 24-Dec-2026 - 03-Jan-2027')).toEqual({
      from: '2026-12-24',
      to: '2027-01-03',
      name: 'Winter recess',
    });
    expect(
      vacationRangeFromLine('Dussehra vacation 10th October 2026 till 18th October 2026'),
    ).toMatchObject({
      from: '2026-10-10',
      to: '2026-10-18',
    });
  });

  it('names an unnamed range and needs the vacation word unless the document is known to be one', () => {
    expect(vacationRangeFromLine('01.06.2026 to 30.06.2026')).toBeNull();
    expect(vacationRangeFromLine('01.06.2026 to 30.06.2026', { assumeVacation: true })).toEqual({
      from: '2026-06-01',
      to: '2026-06-30',
      name: 'Court vacation',
    });
  });

  it('rejects reversed, unreadable and single-date lines', () => {
    expect(vacationRangeFromLine('Vacation 30.06.2026 to 01.06.2026')).toBeNull();
    expect(vacationRangeFromLine('Vacation 31.02.2026 to 05.03.2026')).toBeNull();
    expect(vacationRangeFromLine('Vacation begins 01.06.2026')).toBeNull();
    expect(
      vacationRangeFromLine('Holiday 01.06.2026 and a gap of words 03.06.2026', {
        assumeVacation: true,
      }),
    ).toBeNull();
  });

  it('collects distinct ranges from text and html', () => {
    const lines = [
      'Calendar 2026',
      'Summer vacation 01.06.2026 to 30.06.2026',
      'Summer vacation 01.06.2026 to 30.06.2026',
      'Winter vacation 24.12.2026 to 03.01.2027',
    ];
    expect(parseVacationRangeLines(lines)).toHaveLength(2);
    expect(parseVacationRangesText(lines.join('\n'))).toHaveLength(2);
    expect(
      parseVacationRangesHtml('<p>Summer vacation 01.06.2026 to 30.06.2026</p>').map((r) => r.to),
    ).toEqual(['2026-06-30']);
    expect(parseVacationRangesHtml('')).toEqual([]);
  });

  it('keeps a vacation line out of the holiday dates', () => {
    expect(
      parseHolidayListLines([
        'Summer vacation 01.06.2026 to 30.06.2026',
        '26.01.2026 Republic Day',
      ]),
    ).toEqual([{ date: '2026-01-26', name: 'Republic Day' }]);
  });

  it('reads a range from a notice title and leaves holidays alone', () => {
    expect(vacationRangeFromTitle('Summer vacation 2026 from 01.06.2026 to 30.06.2026')).toEqual({
      from: '2026-06-01',
      to: '2026-06-30',
    });
    expect(vacationRangeFromTitle('Holiday on 14.04.2026')).toBeNull();
    const notice = buildNotice(
      {
        title: 'Summer vacation from 01.06.2026 to 30.06.2026',
        issuedOn: '2026-04-01',
        url: 'https://court.example/n/1',
      },
      CONFIG,
    );
    expect(notice).toMatchObject({
      kindHint: 'holiday',
      vacationRange: { from: '2026-06-01', to: '2026-06-30' },
    });
  });
});
