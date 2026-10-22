// Seeded Karnataka HC document generator (#408, part 5 of #37; ADR 0019). Builds cause lists (saved
// HTML list pages, and pdf-lib PDFs with each cell at its column's x through
// `writeSyntheticColumnPdf`), orders and FR / scrutiny-objection notices in the grammar the adapter
// reads (config/list-grammar.ts, column-synonyms.ts, case-types.ts, stage-map.ts, order-cues.ts),
// each with its truth: the rows, list date, order date and every date printed (or derived from a
// printed date) in it. Lists are built here; orders and notices in orders.ts, the shared case types
// and date helpers in grammar.ts. Pure functions of the seed (`mulberry32`): no clock, no
// `Math.random`, no locale formatting, so the same seed gives the same bytes. Every party, advocate
// and judge is FICTIONAL. `gen:fixtures --adapter karnataka` (src/testing/gen-fixtures.ts) writes the
// output to the git-ignored `fixtures/generated/`; generated-metrics.test.ts gates the parser on it.
// Test tooling only: not exported from the package entry.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { writeSyntheticColumnPdf, type SyntheticPdfRun } from '../../testing/synthetic.ts';

import {
  addDays,
  CASE_TYPES,
  int,
  isoDay,
  numeric,
  type GeneratedDocument,
  type GeneratedFixtures,
  type GeneratedKind,
  type GenerateKarnatakaOptions,
  type KarnatakaTruthRow,
} from './grammar.ts';
import {
  ADVOCATES,
  ENROLLED_ADVOCATES,
  JUDGES,
  mulberry32,
  PETITIONERS,
  pick,
  RESPONDENTS,
} from './names.ts';
import { generateNotice, generateOrder } from './orders.ts';

export type {
  GeneratedDocument,
  GeneratedFixtures,
  GeneratedFormat,
  GeneratedKind,
  GenerateKarnatakaOptions,
  KarnatakaTruth,
  KarnatakaTruthRow,
} from './grammar.ts';

/** Stage headings with their stage-map key; `null` is an unmapped heading kept verbatim. */
const STAGES: readonly { raw: string; norm: string | null }[] = [
  { raw: 'PRELIMINARY HEARING', norm: 'preliminary_hearing' },
  { raw: 'PRELIMINARY HEARING', norm: 'preliminary_hearing' },
  { raw: 'PRELIMINARY HEARING (B GROUP)', norm: 'preliminary_hearing_b_group' },
  { raw: 'HEARING ON IA', norm: 'hearing_on_ia' },
  { raw: 'ADMISSION', norm: 'admission' },
  { raw: 'FOR HEARING', norm: 'final_hearing' },
  { raw: 'FINAL HEARING', norm: 'final_hearing' },
  { raw: 'FOR BEING SPOKEN TO', norm: 'being_spoken_to' },
  { raw: 'ORDERS (REGISTRY OBJECTIONS)', norm: 'orders' },
  { raw: 'FOR JUDGMENT', norm: 'judgment' },
  { raw: 'MOVED BY THE REGISTRY', norm: null },
];

const LIST_TYPES = ['DAILY', 'DAILY', 'DAILY', 'ADVANCE', 'SUPPLEMENTARY'] as const;

interface ListCase {
  caseLine: string;
  row: Omit<KarnatakaTruthRow, 'hallNo' | 'itemNo' | 'stageRaw' | 'stageNorm' | 'parties'>;
}

/** A case line (`WP No. 12345/2026 (GM-RES)`, `IA No. 1/2026 in RFA No. 100/2024`) and its fields. */
function caseOf(random: () => number, used: Set<string>): ListCase {
  for (;;) {
    const type = pick(random, CASE_TYPES);
    // About one in six carries the 100xxx numbering of a bench's own series.
    const number = String(random() < 0.17 ? int(random, 100_001, 109_999) : int(random, 1, 29_999));
    const year = int(random, 2018, 2026);
    const key = `${type.code}/${number}/${String(year)}`;
    if (used.has(key)) continue;
    used.add(key);
    let caseLine = `${type.printed} No. ${number}${type.of === true ? ' of ' : '/'}${String(year)}`;
    if (type.categories !== undefined && random() < 0.6) {
      caseLine += ` (${pick(random, type.categories)})`;
    } else if (random() < 0.15) {
      caseLine = `IA No. ${String(int(random, 1, 9))}/${String(year)} in ${caseLine}`;
    }
    return {
      caseLine,
      row: {
        caseTypeRaw: type.printed,
        caseType: type.code,
        seatSuffix: null,
        caseNumber: number,
        caseYear: year,
        matchKey: key,
      },
    };
  }
}

interface ListItem {
  itemNo: string;
  caseLine: string;
  parties: string;
  advocates: [string, string];
}

interface ListBlock {
  hallNo: string;
  listNo: string;
  bench: string[];
  stages: { stage: (typeof STAGES)[number]; items: ListItem[] }[];
}

interface ListPlan {
  name: string;
  listType: (typeof LIST_TYPES)[number];
  listDate: string;
  publishedOn: string;
  blocks: ListBlock[];
  rows: KarnatakaTruthRow[];
}

/** Halls (1 to 3), each with one or two lists, stage headings and numbered rows. */
function planList(random: () => number, index: number): ListPlan {
  const listDate = isoDay(int(random, 0, 330));
  const rows: KarnatakaTruthRow[] = [];
  const used = new Set<string>();
  const blocks: ListBlock[] = [];
  const hallCount = int(random, 1, 3);
  let hall = int(random, 1, 20);
  for (let h = 0; h < hallCount; h += 1) {
    hall += int(random, 1, 4);
    const hallNo = String(hall);
    const bench = [pick(random, JUDGES)];
    if (random() < 0.2)
      bench.push(
        pick(
          random,
          JUDGES.filter((j) => j !== bench[0]),
        ),
      );
    const lists = int(random, 1, 2);
    for (let l = 1; l <= lists; l += 1) {
      const block: ListBlock = { hallNo, listNo: String(l), bench, stages: [] };
      let item = 0;
      for (let s = int(random, 1, 3); s > 0; s -= 1) {
        const stage = pick(random, STAGES);
        const items: ListItem[] = [];
        for (let r = int(random, 1, 4); r > 0; r -= 1) {
          item += 1;
          const { caseLine, row } = caseOf(random, used);
          const parties = `${pick(random, PETITIONERS)} vs ${pick(random, RESPONDENTS)}`;
          const enrolled = random() < 0.2;
          items.push({
            itemNo: String(item),
            caseLine,
            parties,
            advocates: [
              enrolled ? pick(random, ENROLLED_ADVOCATES) : pick(random, ADVOCATES),
              random() < 0.3 ? '' : pick(random, ADVOCATES),
            ],
          });
          rows.push({
            hallNo,
            itemNo: String(item),
            ...row,
            parties,
            stageRaw: stage.raw,
            stageNorm: stage.norm,
          });
        }
        block.stages.push({ stage, items });
      }
      blocks.push(block);
    }
  }
  return {
    name: `list-${String(index + 1).padStart(3, '0')}`,
    listType: pick(random, LIST_TYPES),
    listDate,
    publishedOn: addDays(listDate, -1),
    blocks,
    rows,
  };
}

const preamble = (plan: ListPlan): string[] => [
  'HIGH COURT OF KARNATAKA, BENGALURU',
  '(FICTIONAL SYNTHETIC LIST: every party, advocate and judge is fictional)',
  `${plan.listType} CAUSE LIST FOR ${numeric(plan.listDate, '-')}`,
  `Last Causelist Updated on : ${numeric(plan.publishedOn, '-')} 06:30 PM`,
];

const HTML_HEADERS = [
  [
    'Sl. No.',
    'Case No.',
    'Petitioner / Respondent',
    'Advocate for Petitioner',
    'Advocate for Respondent',
  ],
  ['S.No', 'Case Number', 'Parties', 'Petitioner Advocate', 'Advocate for Respondent'],
] as const;

/** A saved list page: per hall and list, the bench lines and a table under stage heading rows. */
function listHtml(random: () => number, plan: ListPlan): string {
  const out = ['<!doctype html>', '<html><body>'];
  const [court, note, title, stamp] = preamble(plan);
  out.push(`<h2>${court ?? ''}</h2>`, `<p>${note ?? ''}</p>`, `<h3>${title ?? ''}</h3>`);
  out.push(`<p>${stamp ?? ''}</p>`);
  let lastHall = '';
  for (const block of plan.blocks) {
    if (block.hallNo !== lastHall) out.push(`<div><b>COURT HALL NO. ${block.hallNo}</b></div>`);
    lastHall = block.hallNo;
    out.push(`<div>LIST NO. ${block.listNo}</div>`);
    for (const judge of block.bench) out.push(`<div>${judge}</div>`);
    const header = pick(random, HTML_HEADERS);
    out.push('<table border="1">', `<tr>${header.map((h) => `<th>${h}</th>`).join('')}</tr>`);
    for (const { stage, items } of block.stages) {
      out.push(`<tr><td colspan="5">${stage.raw}</td></tr>`);
      for (const item of items) {
        // The case number is the link text on the court's page; the category follows it.
        const at = item.caseLine.lastIndexOf(' (');
        const caseCell =
          at === -1 || random() < 0.3
            ? `<a href="#case">${item.caseLine}</a>`
            : `<a href="#case">${item.caseLine.slice(0, at)}</a>${item.caseLine.slice(at)}`;
        const cells = [item.itemNo, caseCell, item.parties, ...item.advocates];
        out.push(`<tr>${cells.map((cell) => `<td>${cell}</td>`).join('')}</tr>`);
      }
    }
    out.push('</table>');
  }
  out.push('</body></html>');
  return `${out.join('\n')}\n`;
}

/** Column starts in a PDF list (points), each column wide enough for its text at 8 pt. */
const PDF_X = { item: 30, case: 62, parties: 200, pet: 362, res: 472 } as const;
const PDF_LINE = 14;
const PDF_TOP = 50;
const PDF_LINES_PER_PAGE = 52;
const PDF_SIZE = 8;

/** Words of `text` packed into lines of at most `width` characters. */
function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  for (const word of text.split(' ')) {
    const last = lines.at(-1);
    if (last !== undefined && last.length + 1 + word.length <= width) {
      lines[lines.length - 1] = `${last} ${word}`;
    } else lines.push(word);
  }
  return lines;
}

type PdfLine = Omit<SyntheticPdfRun, 'y'>[];

/**
 * A consolidated list PDF: the preamble, then per hall and list the bench, the column header and
 * rows whose cells sit at their column's x with up to 3 points of jitter; a wrapped case number or
 * party name continues on the next line with an empty serial cell. A page that continues a hall
 * repeats the hall heading and the header.
 */
async function listPdf(random: () => number, plan: ListPlan): Promise<Uint8Array> {
  const jitter = () => int(random, -3, 3);
  const text = (value: string): PdfLine => [{ x: PDF_X.item, text: value, size: PDF_SIZE }];
  const header: PdfLine = [
    { x: PDF_X.item, text: 'Sl. No.', size: PDF_SIZE },
    { x: PDF_X.case, text: 'Case No.', size: PDF_SIZE },
    { x: PDF_X.parties, text: 'Petitioner / Respondent', size: PDF_SIZE },
    { x: PDF_X.pet, text: 'Advocate for Petitioner', size: PDF_SIZE },
    { x: PDF_X.res, text: 'Advocate for Respondent', size: PDF_SIZE },
  ];
  // Groups of lines that stay on one page (a row and its continuation lines).
  const groups: { lines: PdfLine[]; hallNo: string | null }[] = [
    { lines: preamble(plan).map(text), hallNo: null },
  ];
  let lastHall = '';
  for (const block of plan.blocks) {
    const opening: PdfLine[] = [];
    if (block.hallNo !== lastHall) opening.push(text(`COURT HALL NO. ${block.hallNo}`));
    lastHall = block.hallNo;
    opening.push(text(`LIST NO. ${block.listNo}`), ...block.bench.map(text), header);
    groups.push({ lines: opening, hallNo: block.hallNo });
    for (const { stage, items } of block.stages) {
      groups.push({ lines: [text(stage.raw)], hallNo: block.hallNo });
      for (const item of items) {
        const caseParts = wrap(item.caseLine, 24);
        const partyParts = wrap(item.parties, 28);
        const lines: PdfLine[] = [];
        for (let i = 0; i < Math.max(caseParts.length, partyParts.length); i += 1) {
          const runs: PdfLine = [];
          const at = (x: number, value: string | undefined) => {
            if (value !== undefined && value !== '') {
              runs.push({ x: x + jitter(), text: value, size: PDF_SIZE });
            }
          };
          if (i === 0) at(PDF_X.item, item.itemNo);
          at(PDF_X.case, caseParts[i]);
          at(PDF_X.parties, partyParts[i]);
          if (i === 0) {
            at(PDF_X.pet, item.advocates[0].replace(/ KAR\/.*$/, ''));
            at(PDF_X.res, item.advocates[1]);
          }
          lines.push(runs);
        }
        groups.push({ lines, hallNo: block.hallNo });
      }
    }
  }
  const pages: PdfLine[][] = [[]];
  for (const group of groups) {
    let page = pages.at(-1) ?? [];
    if (page.length + group.lines.length > PDF_LINES_PER_PAGE - 2) {
      page = group.hallNo === null ? [] : [text(`COURT HALL NO. ${group.hallNo}`), header];
      pages.push(page);
    }
    page.push(...group.lines);
  }
  return writeSyntheticColumnPdf(
    pages.map((lines, index) =>
      [...lines, text(`Page ${String(index + 1)} of ${String(pages.length)}`)].flatMap(
        (runs, row) => runs.map((run) => ({ ...run, y: PDF_TOP + row * PDF_LINE })),
      ),
    ),
  );
}

/**
 * Every Karnataka document for `seed`: lists (about one in four a PDF), orders and notices. Each
 * kind draws from its own stream, so changing one count never changes another kind's bytes.
 */
export async function generateKarnatakaFixtures({
  seed,
  lists = 32,
  orders = 50,
  notices = 10,
}: GenerateKarnatakaOptions): Promise<GeneratedFixtures> {
  const documents: GeneratedDocument[] = [];
  const listRandom = mulberry32(seed);
  for (let i = 0; i < lists; i += 1) {
    const plan = planList(listRandom, i);
    const pdf = i % 4 === 3;
    documents.push({
      name: plan.name,
      kind: 'cause_list',
      format: pdf ? 'pdf' : 'html',
      content: pdf ? await listPdf(listRandom, plan) : listHtml(listRandom, plan),
      truth: {
        listDate: plan.listDate,
        rows: plan.rows,
        dates: [plan.listDate, plan.publishedOn],
      },
    });
  }
  const orderRandom = mulberry32(seed ^ 0x0d0d0d);
  for (let i = 0; i < orders; i += 1) documents.push(generateOrder(orderRandom, i));
  const noticeRandom = mulberry32(seed ^ 0x0a0a0a);
  for (let i = 0; i < notices; i += 1) documents.push(generateNotice(noticeRandom, i));
  return { seed, documents };
}

/** The file name of a generated document's input. */
export const inputFileOf = (doc: GeneratedDocument): string => `${doc.name}.input.${doc.format}`;

/**
 * Writes `<name>.input.<ext>`, `<name>.truth.json` and `index.json` (origin synthetic, FICTIONAL)
 * into `outDir`, in sorted order. Returns the counts per kind.
 */
export async function writeGeneratedFixtures({
  seed,
  outDir,
}: {
  seed: number;
  outDir: string;
}): Promise<Record<GeneratedKind, number>> {
  const { documents } = await generateKarnatakaFixtures({ seed });
  mkdirSync(outDir, { recursive: true });
  const sorted = [...documents].sort((a, b) => a.name.localeCompare(b.name, 'en'));
  for (const doc of sorted) {
    writeFileSync(path.join(outDir, inputFileOf(doc)), doc.content);
    writeFileSync(
      path.join(outDir, `${doc.name}.truth.json`),
      `${JSON.stringify(doc.truth, null, 2)}\n`,
    );
  }
  const index = {
    adapter: 'in.ka.karnataka-hc.bengaluru',
    seed,
    classification: 'FICTIONAL',
    fixtures: sorted.map((doc) => ({
      file: inputFileOf(doc),
      kind: doc.kind,
      origin: 'synthetic',
      classification: 'FICTIONAL',
    })),
  };
  writeFileSync(path.join(outDir, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
  const count = (kind: GeneratedKind) => documents.filter((doc) => doc.kind === kind).length;
  return {
    cause_list: count('cause_list'),
    order: count('order'),
    registry_notice: count('registry_notice'),
  };
}
