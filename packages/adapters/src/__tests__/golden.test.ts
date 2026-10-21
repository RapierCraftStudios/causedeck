// The golden-fixture harness (#371): the committed echo fixtures pass with perfect precision and
// recall, every input has an expected file and a manifest origin, every expected anchor quote is
// verbatim in its input page, a regression shows up as a field-path diff and a lower score, and
// lawyer-supplied fixtures are read only from ADAPTER_PRIVATE_FIXTURES_DIR and reported apart.
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { resetEnvCache } from '@causedeck/config/env';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createEchoAdapter,
  createMadrasHcAdapter,
  layoutFromEmail,
  layoutFromHtml,
  LayoutDocumentSchema,
  MADRAS_HC_ADAPTER_ID,
  ParsedCauseListSchema,
} from '../index.ts';
import {
  FIXTURES_ROOT,
  FixtureManifestSchema,
  formatGoldenReport,
  runGolden,
} from '../testing/golden.ts';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../../..');
const adapterDirs = readdirSync(FIXTURES_ROOT, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

const scratch = () => mkdtempSync(path.join(os.tmpdir(), 'golden-'));

/** A copy of the committed echo fixtures under `<root>/echo`, for mutation. */
function copyEcho(root: string): string {
  const dir = path.join(root, 'echo');
  cpSync(path.join(FIXTURES_ROOT, 'echo'), dir, { recursive: true });
  return dir;
}

afterEach(() => {
  vi.unstubAllEnvs();
  resetEnvCache();
});

describe('runGolden on the committed echo fixtures', () => {
  it('passes every case with precision and recall 1 and no private set', async () => {
    const report = await runGolden('echo', {
      adapter: createEchoAdapter(),
      privateFixturesDir: null,
    });
    expect(report.private).toBeNull();
    expect(report.public.origin).toBe('committed');
    expect(report.public.cases).toHaveLength(3);
    for (const c of report.public.cases) {
      expect(c, c.file).toMatchObject({
        passed: true,
        diff: [],
        anchorViolations: [],
        missingExpected: false,
      });
    }
    expect(report.public.passed).toBe(true);
    for (const field of report.public.fields) {
      expect(field.precision, field.field).toBe(1);
      expect(field.recall, field.field).toBe(1);
    }
    expect(report.public.fields.find((f) => f.field === 'matchKey')?.tp).toBeGreaterThan(0);
  });
});

describe('runGolden on the committed Madras HC fixtures (#396)', () => {
  it('passes all 12 lists and 5 AIMS emails with precision and recall 1', async () => {
    const report = await runGolden(MADRAS_HC_ADAPTER_ID, {
      adapter: createMadrasHcAdapter(),
      privateFixturesDir: null,
    });
    expect(report.public.cases).toHaveLength(17);
    expect(report.public.cases.filter((c) => c.file.endsWith('.eml'))).toHaveLength(5);
    for (const c of report.public.cases) {
      expect(c, c.file).toMatchObject({ passed: true, diff: [], anchorViolations: [] });
    }
    for (const field of report.public.fields) {
      expect(field.precision, field.field).toBe(1);
      expect(field.recall, field.field).toBe(1);
    }
  });
});

describe('committed fixtures', () => {
  it.each(adapterDirs)('%s: every input has an expected file and a manifest origin', (adapter) => {
    const dir = path.join(FIXTURES_ROOT, adapter);
    const manifest = FixtureManifestSchema.parse(
      JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8')),
    );
    const inputs = readdirSync(dir).filter((name) => /\.input\./.test(name));
    expect(inputs.length).toBeGreaterThan(0);
    expect(manifest.fixtures.map((f) => f.file).sort()).toEqual(inputs.sort());
    for (const entry of manifest.fixtures) {
      expect(['synthetic', 'lawyer-supplied']).toContain(entry.origin);
      // Only synthetic fixtures may be committed.
      expect(entry.origin, entry.file).toBe('synthetic');
      const name = entry.file.replace(/\.input\.[^.]+$/, '');
      expect(readdirSync(dir)).toContain(`${name}.expected.json`);
    }
  });

  it.each(adapterDirs)(
    '%s: every expected cause-list anchor quote is verbatim in its input page',
    (adapter) => {
      const dir = path.join(FIXTURES_ROOT, adapter);
      // Order and registry-notice fixtures (#398) are checked by their adapter's fixture tests.
      const lists = FixtureManifestSchema.parse(
        JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8')),
      )
        .fixtures.filter((entry) => entry.kind === 'cause_list')
        .map((entry) => entry.file);
      for (const file of lists.filter((name) => /\.input\.(txt|html|json|eml)$/.test(name))) {
        const content = readFileSync(path.join(dir, file), 'utf8');
        // HTML and email anchors quote the text the layout readers produce, not the source bytes;
        // a `.json` input is a LayoutDocument (#38) and anchors quote its page texts.
        const pages = file.endsWith('.html')
          ? layoutFromHtml(content).pages.map((page) => page.text)
          : file.endsWith('.eml')
            ? layoutFromEmail(content).pages.map((page) => page.text)
            : file.endsWith('.json')
              ? LayoutDocumentSchema.parse(JSON.parse(content)).pages.map((page) => page.text)
              : content.split('\f');
        const expected = ParsedCauseListSchema.parse(
          JSON.parse(
            readFileSync(path.join(dir, file.replace(/\.input\.[^.]+$/, '.expected.json')), 'utf8'),
          ),
        );
        // Only a list read as empty ("no cases", a PDF-only email) may have no rows.
        if (expected.status !== 'empty') expect(expected.rows.length, file).toBeGreaterThan(0);
        for (const row of expected.unparsedRows ?? []) {
          expect(pages[row.anchor.page - 1], `${file}: ${row.anchor.quote}`).toContain(
            row.anchor.quote,
          );
        }
        for (const row of expected.rows) {
          expect(pages[row.anchor.page - 1], `${file}: ${row.anchor.quote}`).toContain(
            row.anchor.quote,
          );
        }
      }
    },
  );

  it('git-ignores fixtures-private/', () => {
    const gitignore = readFileSync(path.join(REPO_ROOT, '.gitignore'), 'utf8');
    expect(gitignore.split('\n')).toContain('fixtures-private/');
  });
});

describe('runGolden regressions', () => {
  it('reports a field-path diff and a lower score when the output differs from expected', async () => {
    const root = scratch();
    const dir = copyEcho(root);
    const file = path.join(dir, 'list-01-admission.expected.json');
    const expected = JSON.parse(readFileSync(file, 'utf8')) as {
      rows: { caseType: string }[];
    };
    const [first] = expected.rows;
    if (first === undefined) throw new Error('fixture has no rows');
    first.caseType = 'WA';
    writeFileSync(file, JSON.stringify(expected));

    const report = await runGolden('echo', {
      adapter: createEchoAdapter(),
      fixturesRoot: root,
      privateFixturesDir: null,
    });
    const failing = report.public.cases.find((c) => c.name === 'list-01-admission');
    expect(failing?.passed).toBe(false);
    expect(failing?.diff).toEqual(['rows[0].caseType: expected "WA", got "WP"']);
    expect(report.public.passed).toBe(false);
    const caseType = report.public.fields.find((f) => f.field === 'caseType');
    expect(caseType?.precision).toBeLessThan(1);
    expect(caseType?.recall).toBeLessThan(1);
    expect(formatGoldenReport(report)).toContain('FAIL list-01-admission.input.txt');
  });

  it('fails an input without an expected file or a manifest entry', async () => {
    const root = scratch();
    const dir = copyEcho(root);
    writeFileSync(path.join(dir, 'list-04-unlisted.input.txt'), 'COURT HALL 1\n1. W.P. 1/2026');
    const manifestPath = path.join(dir, 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      fixtures: { file: string }[];
    };
    manifest.fixtures.push({
      file: 'list-05-no-expected.input.txt',
      kind: 'cause_list',
      origin: 'synthetic',
    } as { file: string });
    writeFileSync(manifestPath, JSON.stringify(manifest));
    writeFileSync(path.join(dir, 'list-05-no-expected.input.txt'), 'COURT HALL 1\n1. W.P. 1/2026');

    const report = await runGolden('echo', {
      adapter: createEchoAdapter(),
      fixturesRoot: root,
      privateFixturesDir: null,
    });
    expect(report.public.cases.find((c) => c.name === 'list-04-unlisted')).toMatchObject({
      passed: false,
      origin: null,
    });
    expect(report.public.cases.find((c) => c.name === 'list-05-no-expected')).toMatchObject({
      passed: false,
      missingExpected: true,
    });
  });

  it('lists order and registry-notice fixtures without parsing them as cause lists (#398)', async () => {
    const root = scratch();
    const dir = copyEcho(root);
    const manifestPath = path.join(dir, 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      fixtures: { file: string; kind: string; origin: string }[];
    };
    manifest.fixtures.push(
      { file: 'order-01.input.txt', kind: 'order', origin: 'synthetic' },
      { file: 'registry-01.input.txt', kind: 'registry_notice', origin: 'synthetic' },
    );
    writeFileSync(manifestPath, JSON.stringify(manifest));
    writeFileSync(path.join(dir, 'order-01.input.txt'), 'ORDER\nPost on 12.11.2026.');
    writeFileSync(path.join(dir, 'registry-01.input.txt'), 'SR.No.1 of 2026');

    const report = await runGolden('echo', {
      adapter: createEchoAdapter(),
      fixturesRoot: root,
      privateFixturesDir: null,
    });
    expect(report.public.cases.map((c) => c.name).sort()).toEqual([
      'list-01-admission',
      'list-02-multi-page',
      'list-03-alias-and-mentions',
    ]);
    expect(report.public.passed).toBe(true);
    expect(() =>
      FixtureManifestSchema.parse({
        ...manifest,
        fixtures: [{ ...manifest.fixtures[0], kind: 'memo' }],
      }),
    ).toThrow();
  });

  it('throws for an adapter that is not registered', async () => {
    await expect(runGolden('no-such-adapter', { privateFixturesDir: null })).rejects.toThrow(
      /no-such-adapter/,
    );
  });
});

describe('private (lawyer-supplied) fixtures', () => {
  function privateDir(): string {
    const root = scratch();
    const dir = path.join(root, 'echo');
    mkdirSync(dir, { recursive: true });
    const input = 'CAUSE LIST FOR 23.10.2026\nCOURT HALL 7\nFOR ORDERS\n1. W.A. 9/2026  X vs Y';
    writeFileSync(path.join(dir, 'real-01.input.txt'), input);
    writeFileSync(
      path.join(dir, 'manifest.json'),
      JSON.stringify({
        adapter: 'echo',
        fixtures: [{ file: 'real-01.input.txt', kind: 'cause_list', origin: 'lawyer-supplied' }],
      }),
    );
    // An expected file that disagrees on the hall, so the private set fails on its own.
    writeFileSync(
      path.join(dir, 'real-01.expected.json'),
      JSON.stringify({
        adapterId: 'echo',
        adapterVersion: '1.0.0',
        forumCode: 'test.echo.principal',
        listDate: '2026-10-23',
        rows: [
          {
            anchor: { page: 1, quote: '1. W.A. 9/2026  X vs Y', rowIndex: 0 },
            confidence: 1,
            hallNo: '8',
            itemNo: '1',
            caseTypeRaw: 'W.A.',
            caseType: 'WA',
            caseNumber: '9',
            caseYear: 2026,
            matchKey: 'WA/9/2026',
            parties: 'X vs Y',
            stageRaw: 'FOR ORDERS',
            stageNorm: 'orders',
          },
        ],
        diagnostics: {
          unmappedHeadings: [],
          unknownCaseTypes: [],
          rowsSkippedNoAnchor: 0,
          hallsSeen: ['7'],
          hallsUnreadable: [],
        },
      }),
    );
    return root;
  }

  it('reports them as a separate set without changing the committed counts', async () => {
    const committed = await runGolden('echo', {
      adapter: createEchoAdapter(),
      privateFixturesDir: null,
    });
    const report = await runGolden('echo', {
      adapter: createEchoAdapter(),
      privateFixturesDir: privateDir(),
    });
    expect(report.public).toEqual(committed.public);
    expect(report.private?.origin).toBe('private');
    expect(report.private?.cases.map((c) => [c.name, c.origin, c.passed])).toEqual([
      ['real-01', 'lawyer-supplied', false],
    ]);
    expect(report.private?.cases[0]?.diff).toEqual(['rows[0].hallNo: expected "8", got "7"']);
    expect(report.private?.fields.find((f) => f.field === 'hallNo')).toMatchObject({
      tp: 0,
      fp: 1,
      fn: 1,
    });

    const text = formatGoldenReport(report);
    const committedAt = text.indexOf('## Committed fixtures: 3/3 passed');
    const privateAt = text.indexOf('## Private fixtures (lawyer-supplied): 0/1 passed');
    expect(committedAt).toBeGreaterThanOrEqual(0);
    expect(privateAt).toBeGreaterThan(committedAt);
    expect(text.slice(committedAt, privateAt)).not.toContain('real-01');
  });

  it('reads ADAPTER_PRIVATE_FIXTURES_DIR only when it is set', async () => {
    vi.stubEnv('ADAPTER_PRIVATE_FIXTURES_DIR', undefined);
    resetEnvCache();
    expect((await runGolden('echo', { adapter: createEchoAdapter() })).private).toBeNull();

    vi.stubEnv('ADAPTER_PRIVATE_FIXTURES_DIR', privateDir());
    resetEnvCache();
    const report = await runGolden('echo', { adapter: createEchoAdapter() });
    expect(report.private?.cases.map((c) => c.name)).toEqual(['real-01']);
  });
});
