import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PDFDocument, StandardFonts } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import {
  effectiveOnFromTitle,
  kindFromTitle,
  MADRAS_HC_NOTICE_CONFIG,
  parseKarnatakaHcNotices,
  parseMadrasHcNotices,
  parseNoticeListLines,
  parseNoticeListPdf,
} from '../index.ts';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const read = (name: string): string => readFileSync(path.join(dir, name), 'utf8');
const golden = (name: string): unknown => JSON.parse(read(name));

describe('notice parsers: golden fixtures', () => {
  it('reads the Madras HC notice page', () => {
    const result = parseMadrasHcNotices(
      read('madras-hc-notices.html'),
      'https://www.mhc.example/notices',
    );
    expect(result).toEqual(golden('madras-hc-notices.golden.json'));
  });

  it('reads the Karnataka HC notice page', () => {
    const result = parseKarnatakaHcNotices(
      read('karnataka-hc-notices.html'),
      'https://karnatakajudiciary.example/notices',
    );
    expect(result).toEqual(golden('karnataka-hc-notices.golden.json'));
  });

  it('yields nothing for a page without rows and never reads scripts or comments', () => {
    expect(parseMadrasHcNotices('<p>maintenance</p>', 'https://www.mhc.example/')).toEqual({
      notices: [],
      skipped: 0,
    });
    const html = read('madras-hc-notices.html');
    expect(html).toContain('never.pdf');
    expect(html).toContain('commented.pdf');
    const urls = parseMadrasHcNotices(html, 'https://www.mhc.example/n').notices.map((n) => n.url);
    expect(urls.some((url) => url.includes('never') || url.includes('commented'))).toBe(false);
  });
});

describe('notice parsers: PDF list', () => {
  const config = { ...MADRAS_HC_NOTICE_CONFIG, baseUrl: 'https://www.mhc.example/list.pdf' };
  const lines = [
    'Notices of the Registry',
    '1. 12/03/2026 Circular on filing w.e.f. 01/04/2026 https://www.mhc.example/c/1.pdf',
    '2. 05/03/2026 Holiday list for Madurai Bench',
    '3. Missing date notice',
  ];

  it('reads dated lines, using a printed URL or a positional fragment', () => {
    const { notices, skipped } = parseNoticeListLines(lines, config);
    expect(skipped).toBe(0);
    expect(notices.map((n) => [n.title, n.issuedOn, n.effectiveOn, n.url, n.kindHint])).toEqual([
      [
        'Circular on filing w.e.f. 01/04/2026',
        '2026-03-12',
        '2026-04-01',
        'https://www.mhc.example/c/1.pdf',
        'circular',
      ],
      [
        'Holiday list for Madurai Bench',
        '2026-03-05',
        null,
        'https://www.mhc.example/list.pdf#2',
        'holiday',
      ],
    ]);
    expect(notices[1]?.forumCodes).toEqual(['in.tn.madras-hc.madurai']);
  });

  it('reads a PDF through its text layer', async () => {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const page = pdf.addPage([595, 842]);
    lines.forEach((line, index) => {
      page.drawText(line, { x: 40, y: 780 - index * 24, size: 10, font });
    });
    const result = await parseNoticeListPdf(await pdf.save(), config);
    expect(result.notices.map((n) => n.issuedOn)).toEqual(['2026-03-12', '2026-03-05']);
  });
});

describe('notice rules', () => {
  it('classifies by title keyword and leaves unknown titles open', () => {
    expect(kindFromTitle('Holiday list 2026')).toBe('holiday');
    expect(kindFromTitle('Bar Council notice')).toBe('bar_council');
    expect(kindFromTitle('Lunch menu')).toBeNull();
  });

  it('reads an effective date only from an explicit phrase', () => {
    expect(effectiveOnFromTitle('Rules with effect from 1 April 2026')).toBe('2026-04-01');
    expect(effectiveOnFromTitle('Hearing on 01/04/2026')).toBeNull();
  });
});
