import { describe, expect, it } from 'vitest';

import { buildFixtures } from './fixtures.ts';
import {
  extractCaseTitle,
  findLowConfidenceSpans,
  redactJudgment,
  redactWithResolver,
  REDACTION_VERSION,
} from './index.ts';

const pagesOf = (...texts: string[]) => texts.map((text, i) => ({ pageNo: i + 1, text }));

const CAUSE = `BETWEEN:
Ramesh Kumar ... APPELLANT
(By Sri. Kiran Raghavan, Advocate)
AND:
Suresh Babu ... RESPONDENT`;

describe('redactJudgment', () => {
  it('records the ruleset version and never returns a placeholder mapping', () => {
    const r = redactJudgment({ pages: pagesOf(CAUSE) });
    expect(r.redactionVersion).toBe(REDACTION_VERSION);
    expect(Object.keys(r).sort()).toEqual([
      'caseTitle',
      'maskReason',
      'pages',
      'redactionVersion',
      'sensitiveCategory',
      'titleMasked',
    ]);
  });

  it('gives the same person the same role label on every page', () => {
    const r = redactJudgment({
      pages: pagesOf(
        CAUSE,
        'The appellant Ramesh Kumar was tried. Ramesh denied it.',
        'Kumar is acquainted with the respondent Suresh Babu. RAMESH KUMAR appeals.',
      ),
    });
    const [p1, p2, p3] = r.pages.map((p) => p.text);
    expect(p1).toContain('the Appellant ... APPELLANT');
    expect(p2).toContain('the Appellant was tried');
    expect(p2).not.toMatch(/Ramesh/i);
    expect(p3).not.toMatch(/Kumar|Suresh|Babu/i);
    expect(p3).toContain('the Respondent');
    expect(p3).toContain('the Appellant appeals');
  });

  it('numbers several persons of one role consistently', () => {
    const r = redactJudgment({
      pages: pagesOf(
        'Anil Rao ... ACCUSED\nBharat Sen ... ACCUSED',
        'The accused Anil Rao and the accused Bharat Sen. Anil fled.',
      ),
    });
    expect(r.pages[1]?.text).toBe('The accused Accused 1 and the accused Accused 2. Accused 1 fled.');
  });

  it('keeps judges, advocates, courts, bodies, statutes, dates and amounts', () => {
    const text = `${CAUSE}
Before the Hon'ble Mr. Justice Suraj Govindaraj. Sri. Kiran Raghavan, learned counsel, argued.
Canara Bank paid Rs. 5,00,000 on 3.2.2022 under Section 420 of the Indian Penal Code before the High Court of Karnataka.`;
    const out = redactJudgment({ pages: pagesOf(text) }).pages[0]?.text ?? '';
    for (const keep of [
      'Suraj Govindaraj',
      'Kiran Raghavan',
      'Canara Bank',
      'Rs. 5,00,000',
      '3.2.2022',
      'Section 420 of the Indian Penal Code',
      'High Court of Karnataka',
    ]) {
      expect(out).toContain(keep);
    }
    expect(out).not.toContain('Ramesh');
  });

  it('labels a relative by the role they relate to', () => {
    const r = redactJudgment({
      pages: pagesOf('The complainant Mohan Das filed it. Latha Das, wife of the complainant, agrees.'),
    });
    expect(r.pages[0]?.text).toBe(
      "The complainant the Complainant filed it. the Complainant's wife, wife of the complainant, agrees.",
    );
  });

  it('removes personal data by shape', () => {
    const out =
      redactJudgment({
        pages: pagesOf(
          'Call 9845012345 or 98450 12345, mail a.b@example.com, Aadhaar 2345 6789 0123, PAN ABCDE1234F, A/c No. 123456789012, car MH12AB1234, resident of 4 MG Road, Pune.',
        ),
      }).pages[0]?.text ?? '';
    expect(out).not.toMatch(/9845|a\.b@|2345 6789|ABCDE|123456789012|MH12|MG Road/);
  });

  it('extracts the title as published', () => {
    expect(extractCaseTitle(CAUSE)).toBe('Ramesh Kumar v. Suresh Babu');
    expect(redactJudgment({ pages: pagesOf(CAUSE) }).caseTitle).toBe('Ramesh Kumar v. Suresh Babu');
  });
});

describe('sensitive categories', () => {
  const sensitive = buildFixtures().filter((f) => f.sensitive !== null);

  it('has a fixture for POCSO, sexual offence, JJ and matrimonial', () => {
    const kinds = new Set(sensitive.map((f) => f.sensitive));
    for (const k of ['pocso', 'sexual_offence', 'juvenile', 'matrimonial']) expect(kinds).toContain(k);
  });

  it.each(sensitive.map((f) => [f.id, f] as const))('masks the title and victim details of %s', (_id, f) => {
    const r = redactJudgment({ pages: pagesOf(...f.pages) });
    expect(r.sensitiveCategory).toBe(f.sensitive);
    expect(r.titleMasked).toBe(true);
    expect(r.maskReason).toBe(`auto:${f.sensitive}`);
    const all = `${r.caseTitle ?? ''}\n${r.pages.map((p) => p.text).join('\n')}`.toLowerCase();
    for (const id of f.victimIdentifiers) expect(all).not.toContain(id.toLowerCase());
  });

  it('detects sections of the BNS and IPC and 228A', () => {
    for (const text of [
      'offence under Section 64 of the Bharatiya Nyaya Sanhita',
      'charged under IPC Section 376(2)',
      'disclosure barred by Section 228A of the IPC',
    ]) {
      expect(redactJudgment({ pages: pagesOf(text) }).sensitiveCategory).toBe('sexual_offence');
    }
  });

  it('leaves an ordinary judgment unmasked', () => {
    const r = redactJudgment({ pages: pagesOf(CAUSE, 'The appeal concerns a cheque under Section 138.') });
    expect(r.sensitiveCategory).toBeNull();
    expect(r.titleMasked).toBe(false);
    expect(r.maskReason).toBeNull();
  });

  it('masks title and text on a forced mask, removing the listed names', () => {
    const r = redactJudgment({
      pages: pagesOf(CAUSE, 'Ramesh Kumar met Neha Sharma at the market.'),
      extraNames: ['Neha Sharma'],
      forceMask: { reason: 'mask_request:42' },
    });
    expect(r.titleMasked).toBe(true);
    expect(r.maskReason).toBe('mask_request:42');
    expect(r.caseTitle).not.toMatch(/Ramesh|Suresh/);
    expect(r.pages[1]?.text).not.toMatch(/Neha|Sharma/);
  });
});

describe('redactWithResolver', () => {
  const text = `${CAUSE}\nThe contract was signed with Meera Pillai at Bengaluru.`;

  it('finds name-like spans the rules left', () => {
    const spans = findLowConfidenceSpans(
      redactJudgment({ pages: pagesOf(text) }).pages.map((p) => p.text),
      [],
    );
    expect(spans.map((s) => s.text)).toContain('Meera Pillai');
  });

  it('redacts a span the resolver confirms as a person', async () => {
    const r = await redactWithResolver(
      { pages: pagesOf(text) },
      { resolve: async () => ({ spans: [{ text: 'Meera Pillai', isPerson: true }] }) },
    );
    expect(r.pages[0]?.text).not.toContain('Meera');
    expect(r.pages[0]?.text).toContain('Person 1');
  });

  it('leaves a span the resolver rejects, and ignores an invalid reply', async () => {
    const rejected = await redactWithResolver(
      { pages: pagesOf(text) },
      { resolve: async () => ({ spans: [{ text: 'Meera Pillai', isPerson: false }] }) },
    );
    expect(rejected.pages[0]?.text).toContain('Meera Pillai');
    const invalid = await redactWithResolver({ pages: pagesOf(text) }, { resolve: async () => ({ nope: 1 }) });
    expect(invalid.pages[0]?.text).toContain('Meera Pillai');
    expect(invalid.lowConfidence).toBeGreaterThan(0);
    const thrown = await redactWithResolver(
      { pages: pagesOf(text) },
      { resolve: async () => Promise.reject(new Error('gateway down')) },
    );
    expect(thrown.pages[0]?.text).toContain('Meera Pillai');
  });
});
