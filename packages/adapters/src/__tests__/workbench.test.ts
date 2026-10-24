// The fixture workbench builder (#516): a labeled document becomes a fixture bundle whose expected
// output includes the labeler's corrections, validates against the manifest schema, and passes the
// golden runner once written under a fixtures root.
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { createEchoAdapter } from '../example/echo-adapter.ts';
import { exportBundle } from '../testing/export-fixture.ts';
import { FIXTURES_ROOT, FixtureManifestSchema, runGolden } from '../testing/golden.ts';
import {
  applyCorrections,
  buildFixture,
  correctionsFromEdits,
  FixtureBundleSchema,
  previewDocument,
  WorkbenchError,
} from '../workbench/index.ts';

const DOCUMENT = readFileSync(
  path.join(FIXTURES_ROOT, 'echo/list-02-multi-page.input.txt'),
  'utf8',
);
const adapter = createEchoAdapter();

describe('corrections', () => {
  it('patch a row by anchor and the list date, and reject an unknown row', async () => {
    const parsed = await previewDocument(adapter, 'text', DOCUMENT);
    const first = parsed.rows[0];
    if (first === undefined) throw new Error('no rows');
    const corrected = applyCorrections(parsed, {
      listDate: '2026-11-02',
      rows: [{ anchor: first.anchor, patch: { hallNo: '7', caseNumber: '999' } }],
    });
    expect(corrected.listDate).toBe('2026-11-02');
    expect(corrected.rows[0]).toMatchObject({ hallNo: '7', caseNumber: '999' });
    expect(corrected.rows.slice(1)).toEqual(parsed.rows.slice(1));
    expect(() =>
      applyCorrections(parsed, {
        rows: [{ anchor: { page: 1, quote: 'not a row' }, patch: { hallNo: '1' } }],
      }),
    ).toThrow(WorkbenchError);
    expect(() => applyCorrections(parsed, { listDate: 'tomorrow' })).toThrow();
  });

  it('become patches only for the cells a form changed', async () => {
    const parsed = await previewDocument(adapter, 'text', DOCUMENT);
    const same = parsed.rows.map((row) => ({ caseNumber: row.caseNumber ?? '' }));
    expect(correctionsFromEdits(parsed, { rows: same }).rows).toEqual([]);
    const edited = same.map((cells, i) =>
      i === 0 ? { ...cells, caseNumber: '4242', caseYear: '1999' } : cells,
    );
    const { rows } = correctionsFromEdits(parsed, { rows: edited });
    expect(rows).toHaveLength(1);
    expect(rows?.[0]?.patch).toEqual({ caseNumber: '4242', caseYear: 1999 });
  });
});

describe('buildFixture', () => {
  it('rejects a bad fixture name', async () => {
    await expect(
      buildFixture({ adapter, name: 'Bad Name', format: 'text', content: DOCUMENT }),
    ).rejects.toThrow(WorkbenchError);
  });

  it('writes a fixture the golden runner passes, with the corrections as expected output', async () => {
    const parsed = await previewDocument(adapter, 'text', DOCUMENT);
    const first = parsed.rows[0];
    if (first === undefined) throw new Error('no rows');
    const { bundle } = await buildFixture({
      adapter,
      name: 'list-90-workbench',
      format: 'text',
      content: DOCUMENT,
      corrections: { rows: [{ anchor: first.anchor, patch: { hallNo: '9' } }] },
    });
    expect(FixtureBundleSchema.parse(bundle)).toEqual(bundle);
    expect(bundle.expected.rows[0]?.hallNo).toBe('9');

    const root = mkdtempSync(path.join(os.tmpdir(), 'workbench-'));
    const dir = path.join(root, 'echo');
    mkdirSync(dir);
    writeFileSync(
      path.join(dir, 'manifest.json'),
      JSON.stringify({ adapter: 'echo', classification: 'REDACTED', fixtures: [] }),
    );
    exportBundle(bundle, root);
    const manifest = FixtureManifestSchema.parse(
      JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8')),
    );
    expect(manifest.fixtures).toEqual([bundle.manifestEntry]);
    // The correction changed hallNo only, so the unmodified parse of the redacted input differs
    // from the expected file in exactly that field: the golden runner reports it.
    const report = await runGolden('echo', {
      adapter,
      fixturesRoot: root,
      privateFixturesDir: null,
    });
    expect(report.public.cases).toHaveLength(1);
    expect(report.public.cases[0]?.diff.join('\n')).toMatch(/hallNo: expected "9"/);
    // Without corrections the fixture passes as written.
    const clean = await buildFixture({
      adapter,
      name: 'list-91-clean',
      format: 'text',
      content: DOCUMENT,
    });
    expect(clean.reparseMatches).toBe(true);
  });

  it('exportBundle refuses to overwrite a fixture and to write one with personal data', async () => {
    const { bundle } = await buildFixture({
      adapter,
      name: 'list-92-x',
      format: 'text',
      content: DOCUMENT,
    });
    const root = mkdtempSync(path.join(os.tmpdir(), 'workbench-'));
    exportBundle(bundle, root);
    expect(() => exportBundle(bundle, root)).toThrow(/already exists/);
    expect(() =>
      exportBundle(
        { ...bundle, inputFile: 'list-93.input.txt', inputContent: 'call 9876543210' },
        root,
      ),
    ).toThrow(/personal data/);
  });
});
