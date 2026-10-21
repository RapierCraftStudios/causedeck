// Golden-fixture harness (#371, ADR 0015). For an adapter, every `fixtures/<id>/<name>.input.*`
// listed in `manifest.json` is parsed and compared with `<name>.expected.json`: a readable path
// diff, the anchors whose quote is not verbatim on its page, and a per-field precision/recall
// table. Lawyer-supplied fixtures are never committed; they are read from
// `ADAPTER_PRIVATE_FIXTURES_DIR` (same layout) only when it is set, and reported as a separate set
// so they never mix with the committed counts. CI never sets it (the real-fixture gate is #119).
// Reads files only: no network, no clock. Test tooling: not exported from the package entry.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { serverEnv } from '@causedeck/config/env';
import { z } from 'zod';

import { layoutFromHtml } from '../layout/html.ts';
import { layoutFromPdf } from '../layout/pdf.ts';
import { resolveById } from '../registry.ts';
import {
  ParsedCauseListSchema,
  type CourtAdapter,
  type ParsedCauseList,
  type ParsedListRow,
  type ParserInput,
} from '../types.ts';

/** The committed fixtures: `packages/adapters/fixtures`. */
export const FIXTURES_ROOT = path.resolve(import.meta.dirname, '../../fixtures');

/** `receivedAt` for every golden input, so expected files never depend on the clock. */
export const GOLDEN_RECEIVED_AT = '2026-10-21T04:00:00.000Z';

export const FixtureOriginSchema = z.enum(['synthetic', 'lawyer-supplied']);
export type FixtureOrigin = z.infer<typeof FixtureOriginSchema>;

export const FixtureManifestSchema = z.object({
  adapter: z.string().min(1),
  classification: z.string().optional(),
  note: z.string().optional(),
  fixtures: z.array(
    z.object({
      file: z
        .string()
        .regex(/^[\w.-]+\.input\.(txt|html|pdf)$/, 'must be <name>.input.txt|html|pdf'),
      kind: z.literal('cause_list'),
      origin: FixtureOriginSchema,
      classification: z.string().optional(),
      forumCode: z.string().min(1).optional(),
    }),
  ),
});
export type FixtureManifest = z.infer<typeof FixtureManifestSchema>;

export interface GoldenCase {
  name: string;
  file: string;
  /** Unknown when the file is on disk but not in the manifest. */
  origin: FixtureOrigin | null;
  passed: boolean;
  /** `path: expected X, got Y` lines; empty when the output equals the expected file. */
  diff: string[];
  /** Rows whose `anchor.quote` is not verbatim in the text of `anchor.page`. */
  anchorViolations: string[];
  missingExpected: boolean;
}

export interface FieldScore {
  field: string;
  tp: number;
  fp: number;
  fn: number;
  precision: number;
  recall: number;
}

export interface GoldenSetReport {
  origin: 'committed' | 'private';
  cases: GoldenCase[];
  fields: FieldScore[];
  passed: boolean;
}

export interface GoldenReport {
  adapterId: string;
  public: GoldenSetReport;
  /** Null unless a private fixtures directory is configured. */
  private: GoldenSetReport | null;
}

export interface RunGoldenOptions {
  /** Defaults to `resolveById(adapterId)`. */
  adapter?: CourtAdapter;
  /** Defaults to `FIXTURES_ROOT`. */
  fixturesRoot?: string;
  /** Defaults to `ADAPTER_PRIVATE_FIXTURES_DIR`; null skips the private set. */
  privateFixturesDir?: string | null;
}

/** The row fields scored for precision and recall, after the list-level `listDate`. */
export const SCORED_ROW_FIELDS = [
  'hallNo',
  'itemNo',
  'caseTypeRaw',
  'caseType',
  'seatSuffix',
  'caseNumber',
  'caseYear',
  'matchKey',
  'parties',
  'stageRaw',
  'stageNorm',
] as const satisfies readonly (keyof ParsedListRow)[];

const SCORED_FIELDS = ['listDate', ...SCORED_ROW_FIELDS] as const;

/** Builds the parser input for a fixture file from its extension. */
async function inputFor(file: string, forumCode: string): Promise<ParserInput> {
  const meta = { fileName: path.basename(file), receivedAt: GOLDEN_RECEIVED_AT, forumCode };
  if (file.endsWith('.pdf')) {
    return {
      kind: 'layout',
      layout: await layoutFromPdf(new Uint8Array(readFileSync(file))),
      meta,
    };
  }
  const content = readFileSync(file, 'utf8');
  if (file.endsWith('.html')) {
    return { kind: 'html', html: content, layout: layoutFromHtml(content), meta };
  }
  return { kind: 'text', text: content, meta };
}

/** The page texts anchors quote from: layout pages, or text split on form feeds. */
export function pageTexts(input: ParserInput): string[] {
  if (input.layout !== undefined) return input.layout.pages.map((page) => page.text);
  return (input.text ?? '').split('\f');
}

/** Anchors in `parsed` whose quote is not verbatim in the text of their page. */
export function anchorViolations(parsed: ParsedCauseList, pages: readonly string[]): string[] {
  return parsed.rows.flatMap((row, index) =>
    pages[row.anchor.page - 1]?.includes(row.anchor.quote) === true
      ? []
      : [
          `rows[${String(index)}]: quote ${JSON.stringify(row.anchor.quote)} is not on page ${String(row.anchor.page)}`,
        ],
  );
}

const show = (value: unknown) => (value === undefined ? '(missing)' : JSON.stringify(value));

/** A structural diff of two JSON values as `path: expected X, got Y` lines. */
export function diffJson(expected: unknown, actual: unknown, at = ''): string[] {
  if (Array.isArray(expected) && Array.isArray(actual)) {
    const out: string[] = [];
    for (let i = 0; i < Math.max(expected.length, actual.length); i += 1) {
      out.push(...diffJson(expected[i], actual[i], `${at}[${String(i)}]`));
    }
    return out;
  }
  if (isRecord(expected) && isRecord(actual)) {
    const keys = [...new Set([...Object.keys(expected), ...Object.keys(actual)])];
    return keys.flatMap((key) =>
      diffJson(expected[key], actual[key], at === '' ? key : `${at}.${key}`),
    );
  }
  if (JSON.stringify(expected) === JSON.stringify(actual)) return [];
  return [`${at === '' ? '(root)' : at}: expected ${show(expected)}, got ${show(actual)}`];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

type Counts = Record<(typeof SCORED_FIELDS)[number], { tp: number; fp: number; fn: number }>;

const present = (value: unknown) => value !== undefined && value !== null;

function count(tally: { tp: number; fp: number; fn: number }, expected: unknown, actual: unknown) {
  const equal = present(expected) && JSON.stringify(expected) === JSON.stringify(actual);
  if (equal) {
    tally.tp += 1;
    return;
  }
  if (present(actual)) tally.fp += 1;
  if (present(expected)) tally.fn += 1;
}

const anchorKey = (row: ParsedListRow) => `${String(row.anchor.page)}\u0000${row.anchor.quote}`;

/** Adds one fixture's field outcomes to `counts`; rows are aligned by anchor page and quote. */
function score(counts: Counts, expected: ParsedCauseList, actual: ParsedCauseList): void {
  count(counts.listDate, expected.listDate, actual.listDate);
  const expectedRows = new Map(expected.rows.map((row) => [anchorKey(row), row]));
  const actualRows = new Map(actual.rows.map((row) => [anchorKey(row), row]));
  for (const key of new Set([...expectedRows.keys(), ...actualRows.keys()])) {
    for (const field of SCORED_ROW_FIELDS) {
      count(counts[field], expectedRows.get(key)?.[field], actualRows.get(key)?.[field]);
    }
  }
}

const ratio = (hits: number, total: number) =>
  total === 0 ? 1 : Math.round((hits / total) * 1000) / 1000;

async function runSet(
  adapter: CourtAdapter,
  dir: string,
  origin: GoldenSetReport['origin'],
): Promise<GoldenSetReport> {
  const counts = Object.fromEntries(
    SCORED_FIELDS.map((field) => [field, { tp: 0, fp: 0, fn: 0 }]),
  ) as Counts;
  const cases: GoldenCase[] = [];
  if (existsSync(dir)) {
    const manifest = FixtureManifestSchema.parse(
      JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8')),
    );
    const listed = new Set(manifest.fixtures.map((entry) => entry.file));
    for (const file of readdirSync(dir)
      .filter((name) => /\.input\./.test(name))
      .sort()) {
      if (listed.has(file)) continue;
      cases.push({
        name: file.replace(/\.input\.[^.]+$/, ''),
        file,
        origin: null,
        passed: false,
        diff: [`${file}: not listed in manifest.json`],
        anchorViolations: [],
        missingExpected: false,
      });
    }
    for (const entry of manifest.fixtures) {
      const name = entry.file.replace(/\.input\.[^.]+$/, '');
      const input = await inputFor(
        path.join(dir, entry.file),
        entry.forumCode ?? adapter.forumCodes[0] ?? '',
      );
      const actual = ParsedCauseListSchema.parse(await adapter.parseCauseList(input));
      const violations = anchorViolations(actual, pageTexts(input));
      const expectedPath = path.join(dir, `${name}.expected.json`);
      if (!existsSync(expectedPath)) {
        cases.push({
          name,
          file: entry.file,
          origin: entry.origin,
          passed: false,
          diff: [`${name}.expected.json: missing`],
          anchorViolations: violations,
          missingExpected: true,
        });
        continue;
      }
      const expected = ParsedCauseListSchema.parse(JSON.parse(readFileSync(expectedPath, 'utf8')));
      score(counts, expected, actual);
      const diff = diffJson(expected, actual);
      cases.push({
        name,
        file: entry.file,
        origin: entry.origin,
        passed: diff.length === 0 && violations.length === 0,
        diff,
        anchorViolations: violations,
        missingExpected: false,
      });
    }
  }
  const fields = SCORED_FIELDS.map((field) => {
    const { tp, fp, fn } = counts[field];
    return { field, tp, fp, fn, precision: ratio(tp, tp + fp), recall: ratio(tp, tp + fn) };
  });
  return { origin, cases, fields, passed: cases.every((c) => c.passed) };
}

/** Runs the golden fixtures of `adapterId`, committed and (when configured) private, separately. */
export async function runGolden(
  adapterId: string,
  options: RunGoldenOptions = {},
): Promise<GoldenReport> {
  const adapter = options.adapter ?? resolveById(adapterId);
  if (adapter === undefined) throw new Error(`No adapter registered with id ${adapterId}`);
  const root = options.fixturesRoot ?? FIXTURES_ROOT;
  const privateDir =
    options.privateFixturesDir === undefined
      ? serverEnv().ADAPTER_PRIVATE_FIXTURES_DIR
      : options.privateFixturesDir;
  return {
    adapterId,
    public: await runSet(adapter, path.join(root, adapterId), 'committed'),
    private:
      privateDir === undefined || privateDir === null
        ? null
        : await runSet(adapter, path.join(privateDir, adapterId), 'private'),
  };
}

function formatSet(title: string, set: GoldenSetReport): string[] {
  const passed = set.cases.filter((c) => c.passed).length;
  const lines = [`## ${title}: ${String(passed)}/${String(set.cases.length)} passed`];
  for (const c of set.cases) {
    lines.push(
      `${c.passed ? 'PASS' : 'FAIL'} ${c.file}${c.origin === null ? '' : ` (${c.origin})`}`,
    );
    for (const line of [...c.diff, ...c.anchorViolations]) lines.push(`  ${line}`);
  }
  lines.push(
    '',
    `${'field'.padEnd(12)} ${'tp'.padStart(5)} ${'fp'.padStart(5)} ${'fn'.padStart(5)} precision recall`,
  );
  for (const f of set.fields) {
    lines.push(
      `${f.field.padEnd(12)} ${String(f.tp).padStart(5)} ${String(f.fp).padStart(5)} ${String(f.fn).padStart(5)} ${f.precision.toFixed(3).padStart(9)} ${f.recall.toFixed(3).padStart(6)}`,
    );
  }
  return lines;
}

/** The report as text: committed and private fixtures under separate headings. */
export function formatGoldenReport(report: GoldenReport): string {
  const lines = [
    `# Golden fixtures: ${report.adapterId}`,
    ...formatSet('Committed fixtures', report.public),
  ];
  if (report.private !== null)
    lines.push('', ...formatSet('Private fixtures (lawyer-supplied)', report.private));
  return `${lines.join('\n')}\n`;
}
