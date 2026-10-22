// Seeded synthetic NCLT Bengaluru cause lists (#38, ADR 0020). The research read one real 2023 list
// (research/raw/09 §2.2); everything else is synthetic until lawyer-supplied lists arrive (#119).
// A list is laid out as drawn text runs on landscape A4 pages: preamble (date, coram, hearing mode),
// a header row whose cells wrap like a real table, and body rows whose cells wrap, carry nested
// IAs and, optionally, jitter sideways. From the same runs it builds
// - the `LayoutDocument` the PDF reader would produce (lines, words and coverage computed the way
//   src/layout/pdf.ts computes them), for the committed `.input.json` fixtures;
// - a text-layer PDF (`writeNcltPdf`, pdf-lib, fixed dates, so the same seed gives the same bytes);
// - the ground truth the golden metrics score the parser against.
// Every name is made up and marked FICTIONAL. Test tooling only: not exported from the package entry.
// Regenerate the committed fixtures after a deliberate change (then run Prettier and review):
//   node --experimental-strip-types -e \
//     "import('./src/nclt-blr/synthetic/generate.ts').then((m) => m.writeNcltFixtures())"
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { PDFDocument, StandardFonts, type PDFFont } from 'pdf-lib';

import { layoutFromPdf } from '../../layout/pdf.ts';
import { GOLDEN_RECEIVED_AT } from '../../testing/golden.ts';
import { mulberry32 } from '../../testing/synthetic.ts';
import type { BBox, LayoutDocument } from '../../types.ts';
import { NCLT_COLUMN_KEYS, NCLT_COLUMNS, type NcltColumnKey } from '../config/columns.ts';
import { NCLT_PREFIXES, childKindOf } from '../config/prefixes.ts';
import { createNcltAdapter, NCLT_ADAPTER_ID, NCLT_FORUM_CODE } from '../index.ts';
import type { NcltBench, NcltChild, NcltRow } from '../parse-cause-list.ts';

export const NCLT_SCENARIOS = [
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
] as const;
export type NcltScenario = (typeof NCLT_SCENARIOS)[number];

/** A parsed row without the parts that depend on the drawing (anchor, alias spellings). */
export type NcltTruthRow = Omit<NcltRow, 'anchor' | 'advocates'>;

export interface NcltTruth {
  listDate: string;
  benches: NcltBench[];
  rows: NcltTruthRow[];
}

/** A text run as drawn: `baseline` is measured from the top of the page. */
export interface DrawnRun {
  text: string;
  x: number;
  baseline: number;
}

export interface DrawnPage {
  width: number;
  height: number;
  runs: DrawnRun[];
}

export interface GeneratedNcltList {
  pages: DrawnPage[];
  layout: LayoutDocument;
  truth: NcltTruth;
}

/** How a list is built; scenarios and `randomNcltList` fill it in. */
export interface NcltListRecipe {
  seed: number;
  rows: number;
  /** Columns, in order (default: all ten); `extra` adds unknown ones after `section`. */
  columns?: readonly NcltColumnKey[];
  extra?: readonly string[];
  /** Header spellings: `canonical` uses the first synonym, `varied` picks one per column. */
  headers?: 'canonical' | 'varied';
  matterPrefixes?: readonly string[];
  childPrefixes?: readonly string[];
  /** Chance a row lists IAs in its own CA/IA cell (no purpose of their own). */
  inlineIaRate?: number;
  /** Chance a row has IA rows under it, and how many at most. */
  nestedRate?: number;
  maxNested?: number;
  /** Row index -> exactly this many nested IA rows. */
  nestedAt?: Readonly<Record<number, number>>;
  resolutionProfessionalRate?: number;
  remarksRate?: number;
  longNames?: boolean;
  jitterPx?: number;
  hearing?: 'physical' | 'video_conference';
  /** Rows per bench section; more than one entry prints a coram per section. */
  sections?: readonly number[];
  repeatHeaders?: boolean;
}

const PAGE: [number, number] = [842, 595];
const MARGIN = 24;
const FONT_SIZE = 7;
const LINE_HEIGHT = 9;
const ROW_GAP = 5;
/** Space kept clear at a cell's right edge, so wrapped text never reaches the next column. */
const CELL_PADDING = 12;
const FIXED_DATE = new Date('2026-01-01T00:00:00.000Z');
const LIST_DATE = '21.10.2026';

const WIDTHS: Record<NcltColumnKey | 'extra', number> = {
  slNo: 30,
  cpNo: 100,
  caIaNo: 100,
  purpose: 64,
  section: 46,
  parties: 130,
  counselPetitioner: 92,
  counselRespondent: 92,
  resolutionProfessional: 84,
  remarks: 52,
  extra: 50,
};

const COMPANIES = [
  'Fictional Alloys Pvt. Ltd.',
  'Imaginary Textiles Ltd.',
  'Pretend Infra Pvt. Ltd.',
  'Made-up Foods Ltd.',
  'Sample Logistics LLP',
  'Notional Power Ltd.',
];
const CREDITORS = [
  'Fictional Bank Ltd.',
  'Imaginary Finance Ltd.',
  'Pretend Steel Suppliers',
  'Sample Credit Union',
];
const LONG_SUFFIX = ' (formerly Pretend Holdings Private Limited, FICTIONAL)';
const COUNSEL = [
  'Mr. Fictional Rao',
  'Ms. Pretend Iyer',
  'Mr. A. B. Imaginary',
  'Ms. Sample Nair',
  'Mr. K. S. Madeup',
  'Ms. Notional Shetty',
];
const PROFESSIONALS = ['Mr. Fictional RP', 'Ms. Imaginary IRP', 'Mr. Pretend Liquidator'];
const PURPOSES = ['Admission', 'Hearing', 'Pronouncement', 'Orders', 'Reply', 'Compliance'];
const SECTIONS = ['7', '9', '10', '12A', '60(5)', '66', '230-232'];
const REMARKS = ['Part heard', 'Last chance', 'Fresh matter'];
const MEMBERS = [
  "Hon'ble Shri Fictional Rao, Member (Judicial)",
  "Hon'ble Smt. Imaginary Iyer, Member (Technical)",
  "Hon'ble Shri Pretend Kumar, Member (Judicial)",
  "Hon'ble Smt. Sample Das, Member (Technical)",
];
const VS = ['Vs', 'V/s', 'Vs.'];

export const NCLT_SCENARIO_RECIPES: Readonly<Record<NcltScenario, NcltListRecipe>> = {
  'standard-10-row': { seed: 3801, rows: 10, inlineIaRate: 0.3, remarksRate: 0.2 },
  'nested-ias': { seed: 3802, rows: 4, nestedAt: { 1: 4, 2: 1 } },
  'multi-page-repeated-headers': { seed: 3803, rows: 45, inlineIaRate: 0.2, nestedRate: 0.1 },
  'wrapped-cells': { seed: 3804, rows: 6, longNames: true },
  'no-counsel-columns': {
    seed: 3805,
    rows: 6,
    columns: NCLT_COLUMN_KEYS.filter((key) => !key.startsWith('counsel')),
  },
  'vc-notice': { seed: 3806, rows: 5, hearing: 'video_conference' },
  'cpib-irp-rp': {
    seed: 3807,
    rows: 6,
    matterPrefixes: ['CP(IB)'],
    resolutionProfessionalRate: 1,
    nestedRate: 0.3,
  },
  'jittered-columns': { seed: 3808, rows: 10, jitterPx: 3, nestedRate: 0.3 },
  'empty-list': { seed: 3809, rows: 0 },
  'extra-columns': { seed: 3810, rows: 6, extra: ['Diary No.'], headers: 'varied' },
  'two-coram-sections': { seed: 3811, rows: 10, sections: [5, 5] },
  'unusual-prefix': {
    seed: 3812,
    rows: 6,
    matterPrefixes: ['TCP', 'CP(CAA)', 'CP'],
    childPrefixes: ['IA(Plan)', 'MA', 'CA(CAA)', 'CA'],
    nestedRate: 0.6,
  },
};

/** A list for `seed` with every feature mixed in, for the golden metrics. */
export function randomNcltRecipe(seed: number): NcltListRecipe {
  const random = mulberry32(seed);
  const rows = 8 + Math.floor(random() * 25);
  const twoSections = random() < 0.3 && rows > 10;
  return {
    seed,
    rows,
    headers: random() < 0.5 ? 'canonical' : 'varied',
    matterPrefixes: ['CP(IB)', 'CP(IB)', 'CP(CAA)', 'TCP', 'CP'],
    childPrefixes: ['IA', 'IA(IB)', 'CA', 'MA', 'IA(Plan)'],
    inlineIaRate: 0.3,
    nestedRate: 0.3,
    maxNested: 4,
    resolutionProfessionalRate: 0.4,
    remarksRate: 0.3,
    longNames: random() < 0.3,
    jitterPx: Math.round(random() * 300) / 100,
    hearing: random() < 0.3 ? 'video_conference' : 'physical',
    ...(twoSections ? { sections: [Math.floor(rows / 2), rows - Math.floor(rows / 2)] } : {}),
  };
}

const pick = <T>(random: () => number, values: readonly T[]): T =>
  values[Math.floor(random() * values.length)] as T;

const codeOf = (prefix: string): string =>
  NCLT_PREFIXES.find((entry) => entry.prefix === prefix)?.code ??
  prefix.toUpperCase().replace(/[^A-Z0-9]/g, '');

function wrap(font: PDFFont, text: string, width: number): string[] {
  if (text === '') return [];
  const lines: string[] = [];
  let current = '';
  for (const word of text.split(' ')) {
    const next = current === '' ? word : `${current} ${word}`;
    if (current !== '' && font.widthOfTextAtSize(next, FONT_SIZE) > width) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current !== '') lines.push(current);
  return lines;
}

interface Column {
  key: NcltColumnKey | 'extra';
  label: string;
  x: number;
  width: number;
}

interface CellLines {
  /** Line offset within the row -> column key -> text. */
  lines: Map<NcltColumnKey | 'extra', string>[];
}

function layoutColumns(recipe: NcltListRecipe, random: () => number): Column[] {
  const keys: (NcltColumnKey | 'extra')[] = [...(recipe.columns ?? NCLT_COLUMN_KEYS)];
  const at = keys.indexOf('section');
  const extras = recipe.extra ?? [];
  keys.splice(at < 0 ? keys.length : at + 1, 0, ...extras.map(() => 'extra' as const));
  const total = keys.reduce((sum, key) => sum + WIDTHS[key], 0);
  const scale = Math.min(1, (PAGE[0] - 2 * MARGIN) / total);
  let x = MARGIN;
  let extraIndex = 0;
  return keys.map((key) => {
    const width = Math.round(WIDTHS[key] * scale * 100) / 100;
    let label: string;
    if (key === 'extra') {
      label = extras[extraIndex] ?? 'Extra';
      extraIndex += 1;
    } else {
      const spellings = NCLT_COLUMNS[key];
      label =
        recipe.headers === 'varied' ? pick(random, spellings.slice(0, 2)) : (spellings[0] ?? key);
    }
    const column = { key, label, x, width };
    x += width;
    return column;
  });
}

function caseText(prefix: string, number: number, year: number, bench: boolean): string {
  return bench
    ? `${prefix} No. ${String(number)}/BB/${String(year)}`
    : `${prefix} No. ${String(number)}/${String(year)}`;
}

/** One matter: its truth and the text of each of its cell lines (before wrapping). */
function makeRow(
  recipe: NcltListRecipe,
  random: () => number,
  index: number,
  slNo: number,
  benchIndex: number,
  keys: ReadonlySet<string>,
): { truth: NcltTruthRow; first: Record<string, string>; nested: Record<string, string>[] } {
  const prefix = pick(random, recipe.matterPrefixes ?? ['CP(IB)']);
  const number = 1 + Math.floor(random() * 999);
  const year = 2019 + Math.floor(random() * 8);
  const child = (purpose?: string, section?: string): NcltChild & { text: string } => {
    const childPrefix = pick(random, recipe.childPrefixes ?? ['IA', 'IA(IB)']);
    const childNumber = 1 + Math.floor(random() * 999);
    const childYear = 2020 + Math.floor(random() * 7);
    const bench = random() < 0.4;
    const code = codeOf(childPrefix);
    return {
      kind: childKindOf(code) ?? 'IA',
      prefix: childPrefix,
      code,
      number: String(childNumber),
      bench: bench ? 'BB' : null,
      year: childYear,
      ...(purpose === undefined ? {} : { purpose }),
      ...(section === undefined ? {} : { section }),
      text: caseText(childPrefix, childNumber, childYear, bench),
    };
  };
  const inline =
    random() < (recipe.inlineIaRate ?? 0)
      ? Array.from({ length: random() < 0.5 ? 1 : 2 }, () => child())
      : [];
  const nestedCount =
    recipe.nestedAt?.[index] ??
    (random() < (recipe.nestedRate ?? 0) ? 1 + Math.floor(random() * (recipe.maxNested ?? 3)) : 0);
  const nested = Array.from({ length: nestedCount }, () =>
    child(pick(random, PURPOSES), pick(random, SECTIONS)),
  );
  const suffix = recipe.longNames === true ? LONG_SUFFIX : '';
  const petitioner = `${pick(random, CREDITORS)}${suffix}`;
  const respondent = `${pick(random, COMPANIES)}${suffix}`;
  const parties = `${petitioner} ${pick(random, VS)} ${respondent}`;
  const counsel = () =>
    Array.from({ length: random() < 0.5 ? 1 : 2 }, () => pick(random, COUNSEL)).filter(
      (name, i, all) => all.indexOf(name) === i,
    );
  const counselPetitioner = counsel();
  const counselRespondent = counsel();
  const purpose = pick(random, PURPOSES);
  const section = pick(random, SECTIONS);
  const rp = random() < (recipe.resolutionProfessionalRate ?? 0) ? pick(random, PROFESSIONALS) : '';
  const remarks = random() < (recipe.remarksRate ?? 0) ? pick(random, REMARKS) : '';
  const cpText = caseText(prefix, number, year, true);
  const has = (key: string) => keys.has(key);
  const strip = (entry: NcltChild & { text: string }): NcltChild =>
    Object.fromEntries(Object.entries(entry).filter(([field]) => field !== 'text')) as NcltChild;
  const truth: NcltTruthRow = {
    slNo: has('slNo') ? String(slNo) : null,
    cp: { prefix, code: codeOf(prefix), number: String(number), bench: 'BB', year },
    children: has('caIaNo') ? [...inline, ...nested].map(strip) : [],
    purpose: has('purpose') ? purpose : null,
    section: has('section') ? section : null,
    parties: has('parties') ? parties : null,
    petitioner: has('parties') ? petitioner : null,
    respondent: has('parties') ? respondent : null,
    counselPetitioner: has('counselPetitioner') ? counselPetitioner : [],
    counselRespondent: has('counselRespondent') ? counselRespondent : [],
    ...(rp !== '' && has('resolutionProfessional') ? { resolutionProfessional: rp } : {}),
    ...(remarks !== '' && has('remarks') ? { remarks } : {}),
    benchIndex,
  };
  return {
    truth,
    first: {
      slNo: String(slNo),
      cpNo: cpText,
      caIaNo: inline.map((c) => c.text).join(', '),
      purpose,
      section,
      parties,
      counselPetitioner: counselPetitioner.join(', '),
      counselRespondent: counselRespondent.join(', '),
      resolutionProfessional: rp,
      remarks,
      extra: `${String(1000 + Math.floor(random() * 8999))}/2026`,
    },
    nested: nested.map((c) => ({
      caIaNo: c.text,
      purpose: c.purpose ?? '',
      section: c.section ?? '',
    })),
  };
}

/** Draws a list from a recipe: the runs per page, their layout and the truth. */
export async function generateNcltList(recipe: NcltListRecipe): Promise<GeneratedNcltList> {
  const random = mulberry32(recipe.seed);
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const columns = layoutColumns(recipe, random);
  const keys = new Set<string>(columns.map((column) => column.key));
  const sections = recipe.sections ?? [recipe.rows];
  const hearing = recipe.hearing ?? 'physical';
  const pages: DrawnPage[] = [];
  const benches: NcltBench[] = [];
  const rows: NcltTruthRow[] = [];
  let page: DrawnPage = { width: PAGE[0], height: PAGE[1], runs: [] };
  pages.push(page);
  let y = MARGIN;
  const jitter = () =>
    recipe.jitterPx === undefined
      ? 0
      : Math.round((random() * 2 - 1) * recipe.jitterPx * 100) / 100;
  const text = (value: string, x: number) => {
    page.runs.push({ text: value, x, baseline: Math.round((y + FONT_SIZE) * 100) / 100 });
  };
  const newPage = () => {
    page = { width: PAGE[0], height: PAGE[1], runs: [] };
    pages.push(page);
    y = MARGIN;
  };
  const drawHeader = () => {
    const wrapped = columns.map((column) => wrap(font, column.label, column.width - CELL_PADDING));
    const height = Math.max(...wrapped.map((lines) => lines.length));
    for (let line = 0; line < height; line += 1) {
      columns.forEach((column, i) => {
        const value = wrapped[i]?.[line];
        if (value !== undefined) text(value, column.x);
      });
      y += LINE_HEIGHT;
    }
    y += ROW_GAP;
  };
  const preamble = (lines: string[]) => {
    for (const line of lines) {
      text(line, MARGIN);
      y += LINE_HEIGHT;
    }
    y += ROW_GAP;
  };

  preamble([
    'NATIONAL COMPANY LAW TRIBUNAL, BENGALURU BENCH (FICTIONAL)',
    `CAUSE LIST DATED ${LIST_DATE}`,
  ]);
  let slNo = 0;
  for (const [benchIndex, count] of sections.entries()) {
    const members = [pick(random, MEMBERS.slice(0, 2)), pick(random, MEMBERS.slice(2))];
    const vc = hearing === 'video_conference';
    const lines = [
      `Coram: ${members[0] ?? ''}`,
      members[1] ?? '',
      vc ? 'VIDEO CONFERENCE HEARING AT 10:30 AM' : 'PHYSICAL HEARING AT 2:30 PM',
      ...(vc ? ['Webex link: https://example.invalid/nclt-fictional-bench (FICTIONAL)'] : []),
    ];
    if (y + (lines.length + 4) * LINE_HEIGHT > PAGE[1] - MARGIN) newPage();
    preamble(lines);
    benches.push({
      bench: members.join('; '),
      hearingMode: vc ? 'video_conference' : 'physical',
      time: vc ? '10:30' : '14:30',
      hasVcLink: vc,
    });
    drawHeader();
    for (let i = 0; i < count; i += 1) {
      slNo += 1;
      const row = makeRow(recipe, random, rows.length, slNo, benchIndex, keys);
      rows.push(row.truth);
      const cells: CellLines = { lines: [] };
      const firstWrapped = columns.map((column) => {
        const value = row.first[column.key] ?? '';
        const width = column.width - CELL_PADDING;
        // Several IAs in one cell: comma-separated when they fit, else one per line.
        if (column.key === 'caIaNo' && font.widthOfTextAtSize(value, FONT_SIZE) > width) {
          return value.split(', ');
        }
        return wrap(font, value, width);
      });
      const firstHeight = Math.max(1, ...firstWrapped.map((lines) => lines.length));
      for (let line = 0; line < firstHeight; line += 1) {
        cells.lines.push(
          new Map(columns.map((column, c) => [column.key, firstWrapped[c]?.[line] ?? ''])),
        );
      }
      for (const nested of row.nested) {
        cells.lines.push(new Map(columns.map((column) => [column.key, nested[column.key] ?? ''])));
      }
      if (y + cells.lines.length * LINE_HEIGHT > PAGE[1] - MARGIN) {
        newPage();
        if (recipe.repeatHeaders !== false) drawHeader();
      }
      const offsets = columns.map(() => jitter());
      for (const line of cells.lines) {
        columns.forEach((column, c) => {
          const value = line.get(column.key) ?? '';
          if (value !== '') text(value, Math.round((column.x + (offsets[c] ?? 0)) * 100) / 100);
        });
        y += LINE_HEIGHT;
      }
      y += ROW_GAP;
    }
  }

  const widths = (run: DrawnRun) => font.widthOfTextAtSize(run.text, FONT_SIZE);
  return {
    pages,
    layout: { pages: pages.map((drawn, index) => layoutPage(index + 1, drawn, widths)) },
    truth: { listDate: '2026-10-21', benches, rows },
  };
}

/** The list for a named scenario. */
export function generateNcltScenario(scenario: NcltScenario): Promise<GeneratedNcltList> {
  return generateNcltList(NCLT_SCENARIO_RECIPES[scenario]);
}

/** A text-layer PDF of drawn pages, Helvetica 7 pt, byte-identical for the same pages. */
export async function writeNcltPdf(pages: readonly DrawnPage[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setCreationDate(FIXED_DATE);
  doc.setModificationDate(FIXED_DATE);
  doc.setProducer('causedeck synthetic fixtures (FICTIONAL)');
  doc.setCreator('causedeck synthetic fixtures (FICTIONAL)');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const drawn of pages) {
    const page = doc.addPage([drawn.width, drawn.height]);
    for (const run of drawn.runs) {
      page.drawText(run.text, { x: run.x, y: drawn.height - run.baseline, size: FONT_SIZE, font });
    }
  }
  return doc.save({ useObjectStreams: false });
}

// The layout the PDF reader (src/layout/pdf.ts) builds from text runs, reproduced for drawn runs.
type LayoutPage = LayoutDocument['pages'][number];
const round = (value: number) => Math.round(value * 100) / 100;

interface Run extends DrawnRun {
  width: number;
  height: number;
}

function union(boxes: BBox[]): BBox {
  const left = Math.min(...boxes.map((b) => b.x));
  const top = Math.min(...boxes.map((b) => b.y));
  const right = Math.max(...boxes.map((b) => b.x + b.width));
  const bottom = Math.max(...boxes.map((b) => b.y + b.height));
  return { x: round(left), y: round(top), width: round(right - left), height: round(bottom - top) };
}

function layoutPage(
  number: number,
  drawn: DrawnPage,
  widthOf: (run: DrawnRun) => number,
): LayoutPage {
  const runs: Run[] = drawn.runs.map((run) => ({ ...run, width: widthOf(run), height: FONT_SIZE }));
  const sorted = [...runs].sort((a, b) => a.baseline - b.baseline || a.x - b.x);
  const grouped: { baseline: number; runs: Run[] }[] = [];
  for (const run of sorted) {
    const last = grouped.at(-1);
    if (
      last !== undefined &&
      Math.abs(run.baseline - last.baseline) <= Math.max(1, run.height / 2)
    ) {
      last.runs.push(run);
    } else {
      grouped.push({ baseline: run.baseline, runs: [run] });
    }
  }
  const box = (run: Run): BBox => ({
    x: round(run.x),
    y: round(run.baseline - run.height),
    width: round(run.width),
    height: round(run.height),
  });
  const lines = grouped.map(({ runs: lineRuns }) => {
    const ordered = lineRuns.sort((a, b) => a.x - b.x);
    let text = '';
    let right = Number.NEGATIVE_INFINITY;
    for (const run of ordered) {
      if (text !== '' && run.x - right > run.height * 0.1) text += ' ';
      text += run.text.trim();
      right = run.x + run.width;
    }
    return { text, bbox: union(ordered.map(box)), runs: ordered };
  });
  const words = lines.flatMap((line) =>
    line.runs.flatMap((run) => {
      const charWidth = run.text.length === 0 ? 0 : run.width / run.text.length;
      return [...run.text.matchAll(/\S+/g)].map((match) => ({
        text: match[0],
        bbox: {
          x: round(run.x + match.index * charWidth),
          y: round(run.baseline - run.height),
          width: round(match[0].length * charWidth),
          height: round(run.height),
        },
      }));
    }),
  );
  const area = drawn.width * drawn.height;
  const covered = lines.reduce((sum, line) => sum + line.bbox.width * line.bbox.height, 0);
  const textCoverage =
    lines.length === 0 || area === 0
      ? 0
      : Math.max(0.0001, Math.min(1, Math.round((covered / area) * 10_000) / 10_000));
  return {
    page: number,
    width: round(drawn.width),
    height: round(drawn.height),
    text: lines.map((line) => line.text).join('\n'),
    items: lines.map(({ text, bbox }) => ({ text, bbox })),
    words,
    textCoverage,
  };
}

/** The scenarios also committed as rendered PDFs (`<scenario>-pdf.input.pdf`). */
export const NCLT_PDF_SCENARIOS: readonly NcltScenario[] = [
  'standard-10-row',
  'nested-ias',
  'multi-page-repeated-headers',
  'two-coram-sections',
];

export const NCLT_FIXTURES_DIR = path.resolve(
  import.meta.dirname,
  '../../../fixtures/in.nclt.bengaluru',
);

export interface NcltFixtureFile {
  name: string;
  /** JSON values are compared parsed, so formatting never matters; PDFs byte for byte. */
  content: unknown;
}

/**
 * Every committed NCLT fixture: the manifest, 12 layout inputs, 4 rendered PDFs and the adapter's
 * expected output for each, read the way the golden harness reads them.
 */
export async function ncltFixtureFiles(): Promise<NcltFixtureFile[]> {
  const adapter = createNcltAdapter();
  const files: NcltFixtureFile[] = [];
  const entries: { file: string }[] = [];
  const expected = async (name: string, file: string, layout: LayoutDocument) => {
    const meta = { fileName: file, receivedAt: GOLDEN_RECEIVED_AT, forumCode: NCLT_FORUM_CODE };
    const parsed = await adapter.parseCauseList({ kind: 'layout', layout, meta });
    files.push({ name: `${name}.expected.json`, content: JSON.parse(JSON.stringify(parsed)) });
  };
  for (const scenario of NCLT_SCENARIOS) {
    const list = await generateNcltScenario(scenario);
    const file = `${scenario}.input.json`;
    entries.push({ file });
    files.push({ name: file, content: list.layout });
    await expected(scenario, file, list.layout);
    if (NCLT_PDF_SCENARIOS.includes(scenario)) {
      const pdf = await writeNcltPdf(list.pages);
      const pdfFile = `${scenario}-pdf.input.pdf`;
      entries.push({ file: pdfFile });
      files.push({ name: pdfFile, content: pdf });
      await expected(`${scenario}-pdf`, pdfFile, await layoutFromPdf(pdf));
    }
  }
  files.unshift({
    name: 'manifest.json',
    content: {
      adapter: NCLT_ADAPTER_ID,
      classification: 'FICTIONAL',
      note: 'Synthetic NCLT Bengaluru lists from src/nclt-blr/synthetic/generate.ts (#38). Every party, advocate, professional and member is fictional; real-list validation is #119.',
      fixtures: entries
        .sort((a, b) => a.file.localeCompare(b.file))
        .map(({ file }) => ({
          file,
          kind: 'cause_list',
          origin: 'synthetic',
          classification: 'FICTIONAL',
        })),
    },
  });
  return files;
}

/** Writes the fixtures to `dir`; run Prettier on them afterwards. */
export async function writeNcltFixtures(dir: string = NCLT_FIXTURES_DIR): Promise<void> {
  mkdirSync(dir, { recursive: true });
  for (const { name, content } of await ncltFixtureFiles()) {
    writeFileSync(
      path.join(dir, name),
      // Compact: Prettier then keeps every object that fits on one line, e.g. one line per word.
      content instanceof Uint8Array ? content : `${JSON.stringify(content)}\n`,
    );
  }
}
