import { PDFDocument, StandardFonts } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import {
  parseHolidayListHtml,
  parseHolidayListLines,
  parseHolidayListPdf,
  parseHolidayListText,
} from '../index.ts';

const LINES = [
  'List of Holidays for the year 2026',
  '1. 26.01.2026 Monday Republic Day',
  '2. 14-Apr-2026 Tuesday Tamil New Year',
  '3. 15th August 2026 Independence Day',
  '4. 31.02.2026 Not a real day',
  '5. 15/08/2026 Duplicate of the third',
  '25-12-2026',
];
const EXPECTED = [
  { date: '2026-01-26', name: 'Republic Day' },
  { date: '2026-04-14', name: 'Tamil New Year' },
  { date: '2026-08-15', name: 'Independence Day' },
  { date: '2026-12-25', name: 'Holiday' },
];

describe('holiday list dates', () => {
  it('reads every dated line, drops weekdays and serials, skips bad and repeated dates', () => {
    expect(parseHolidayListLines(LINES)).toEqual(EXPECTED);
    expect(parseHolidayListText(LINES.join('\r\n'))).toEqual(EXPECTED);
  });

  it('reads an HTML table', () => {
    const rows = LINES.slice(1, 4).map((line) => {
      const [serial, date, ...rest] = line.split(' ');
      return `<tr><td>${serial ?? ''}</td><td>${date ?? ''}</td><td>${rest.join(' ')}</td></tr>`;
    });
    const dates = parseHolidayListHtml(`<table>${rows.join('')}</table>`);
    expect(dates.map((d) => d.date)).toEqual(['2026-01-26', '2026-04-14', '2026-08-15']);
  });

  it('reads a PDF through its text layer', async () => {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const page = pdf.addPage([595, 842]);
    LINES.forEach((line, index) => {
      page.drawText(line, { x: 40, y: 780 - index * 24, size: 10, font });
    });
    expect(await parseHolidayListPdf(await pdf.save())).toEqual(EXPECTED);
  });

  it('returns nothing for an unreadable document', async () => {
    expect(await parseHolidayListPdf(new Uint8Array([1, 2, 3]))).toEqual([]);
    expect(parseHolidayListLines(['no dates here', ''])).toEqual([]);
  });
});
