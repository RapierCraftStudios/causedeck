// The committed NCLT Bengaluru fixtures (#38): 12 synthetic `LayoutDocument` lists and 4 rendered
// PDFs, all FICTIONAL, are exactly what the seeded generator produces; each PDF read back through
// `layoutFromPdf` parses identically to its layout fixture (bboxes aside: pdfjs measures glyphs a
// little wider than pdf-lib); and the golden harness passes them with every anchor verbatim.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { layoutFromPdf } from '../layout/pdf.ts';
import { runGolden } from '../testing/golden.ts';

import { createNcltAdapter, NCLT_ADAPTER_ID, NCLT_CONFIG, parseNcltCauseList } from './index.ts';
import {
  generateNcltScenario,
  NCLT_FIXTURES_DIR,
  NCLT_PDF_SCENARIOS,
  NCLT_SCENARIOS,
  ncltFixtureFiles,
  writeNcltPdf,
} from './synthetic/generate.ts';

const withoutBoxes = (value: unknown): unknown =>
  JSON.parse(JSON.stringify(value, (key, inner: unknown) => (key === 'bbox' ? undefined : inner)));

describe('committed NCLT fixtures', () => {
  it('are the generator output: 12 layouts, 4 PDFs, an expected file each, all FICTIONAL', async () => {
    const files = await ncltFixtureFiles();
    const committed = readdirSync(NCLT_FIXTURES_DIR).sort();
    expect(committed).toEqual(files.map((file) => file.name).sort());
    expect(committed.filter((name) => name.endsWith('.input.json'))).toHaveLength(12);
    expect(committed.filter((name) => name.endsWith('.input.pdf'))).toHaveLength(4);
    for (const { name, content } of files) {
      const raw = readFileSync(path.join(NCLT_FIXTURES_DIR, name));
      if (content instanceof Uint8Array) {
        expect(new Uint8Array(raw), name).toEqual(content);
      } else {
        expect(JSON.parse(raw.toString('utf8')), name).toEqual(content);
      }
    }
    const manifest = JSON.parse(
      readFileSync(path.join(NCLT_FIXTURES_DIR, 'manifest.json'), 'utf8'),
    ) as { classification: string; fixtures: { origin: string; classification: string }[] };
    expect(manifest.classification).toBe('FICTIONAL');
    expect(manifest.fixtures).toHaveLength(16);
    for (const entry of manifest.fixtures) {
      expect(entry).toMatchObject({ origin: 'synthetic', classification: 'FICTIONAL' });
    }
  });

  it('covers the 12 scenarios', () => {
    expect(NCLT_SCENARIOS).toEqual([
      'standard-10-row',
      'nested-ias',
      'multi-page-repeated-headers',
      'wrapped-cells',
      'no-counsel-columns',
      'vc-notice',
      'cpib-irp-rp',
      'jittered-columns',
      'empty-list',
      'extra-columns',
      'two-coram-sections',
      'unusual-prefix',
    ]);
  });

  it.each(NCLT_PDF_SCENARIOS)(
    '%s: the rendered PDF round-trips through layoutFromPdf',
    async (scenario) => {
      const list = await generateNcltScenario(scenario);
      const fromLayout = parseNcltCauseList(list.layout, NCLT_CONFIG);
      const fromPdf = parseNcltCauseList(
        await layoutFromPdf(await writeNcltPdf(list.pages)),
        NCLT_CONFIG,
      );
      expect(fromLayout.rows.length).toBeGreaterThan(0);
      expect(withoutBoxes(fromPdf)).toEqual(withoutBoxes(fromLayout));
      fromPdf.rows.forEach((row, index) => {
        const expected = fromLayout.rows[index]?.anchor.bbox;
        expect(row.anchor.bbox?.x).toBeCloseTo(expected?.x ?? Number.NaN, 0);
        expect(row.anchor.bbox?.y).toBeCloseTo(expected?.y ?? Number.NaN, 0);
        expect(Math.abs((row.anchor.bbox?.width ?? 0) / (expected?.width ?? 1) - 1)).toBeLessThan(
          0.03,
        );
      });
    },
  );

  it('pass the golden harness with every anchor verbatim', async () => {
    const report = await runGolden(NCLT_ADAPTER_ID, {
      adapter: createNcltAdapter(),
      privateFixturesDir: null,
    });
    expect(report.public.cases).toHaveLength(16);
    for (const c of report.public.cases) {
      expect(c, c.file).toMatchObject({ passed: true, diff: [], anchorViolations: [] });
    }
    for (const field of report.public.fields) {
      expect([field.field, field.precision, field.recall]).toEqual([field.field, 1, 1]);
    }
  });
});
