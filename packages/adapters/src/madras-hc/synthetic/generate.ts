// Seeded Madras HC document generator (#401, part 4 of #36; ADR 0018). Builds cause lists (text and
// pdf-lib PDFs through `writeSyntheticPdf`), AIMS emails (plain and HTML), orders and registry
// notices in the grammar the adapter reads (config/list-grammar.ts, case-types.ts, stage-map.ts,
// order-cues.ts), each with its truth: the rows, list date, order date and every date printed (or
// derived from a printed date) in it. Pure functions of the seed (`mulberry32`): no clock, no
// `Math.random`, no locale formatting, so the same seed gives the same bytes. Every party, advocate
// and judge is FICTIONAL. `gen:fixtures` (src/testing/gen-fixtures.ts) writes the output to the
// git-ignored `fixtures/generated/`; generated-metrics.test.ts gates the parser on it. Test tooling
// only: not exported from the package entry.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { writeSyntheticPdf } from '../../testing/synthetic.ts';

import {
  ADVOCATES,
  CHIEF_JUSTICE,
  JUDGES,
  mulberry32,
  PETITIONERS,
  pick,
  RESPONDENTS,
} from './names.ts';

export type GeneratedKind = 'cause_list' | 'order' | 'registry_notice';
export type GeneratedFormat = 'txt' | 'pdf' | 'eml';

/** A list row as the parser should report it: the `SCORED_ROW_FIELDS` of testing/golden.ts. */
export interface MadrasTruthRow {
  hallNo: string;
  itemNo: string;
  caseTypeRaw: string;
  caseType: string;
  seatSuffix: string | null;
  caseNumber: string;
  caseYear: number;
  matchKey: string;
  parties: string;
  stageRaw: string | null;
  stageNorm: string | null;
}

export interface MadrasTruth {
  /** The list date (cause lists and emails). */
  listDate?: string;
  rows?: MadrasTruthRow[];
  /** The order date (orders). */
  orderDate?: string;
  /** Every ISO date the document prints, or that follows from a printed date and period. */
  dates: string[];
}

export interface GeneratedDocument {
  name: string;
  kind: GeneratedKind;
  format: GeneratedFormat;
  content: string | Uint8Array;
  truth: MadrasTruth;
}

export interface GenerateMadrasOptions {
  seed: number;
  lists?: number;
  emails?: number;
  orders?: number;
  notices?: number;
}

export interface GeneratedFixtures {
  seed: number;
  documents: GeneratedDocument[];
}

interface CaseType {
  printed: string;
  code: string;
  seat?: 'MD';
  /** Misc petition type printed after the main case (`and W.M.P.No.1 of 2026`). */
  misc?: string;
  /** Slash and spaced `No.` variants print safely for this type. */
  variants?: boolean;
}

/** Spellings taken from the committed fixtures, so every one is in the case-type table. */
const CASE_TYPES: readonly CaseType[] = [
  { printed: 'W.P.', code: 'WP', misc: 'W.M.P.', variants: true },
  { printed: 'W.P.', code: 'WP', misc: 'W.M.P.', variants: true },
  { printed: 'WP', code: 'WP', variants: true },
  { printed: 'W.A.', code: 'WA', misc: 'W.A.M.P.' },
  { printed: 'CRL OP', code: 'CRLOP', misc: 'Crl.M.P.' },
  { printed: 'Crl.R.C.', code: 'CRLRC' },
  { printed: 'H.C.P.', code: 'HCP', misc: 'H.C.M.P.' },
  { printed: 'CRL A', code: 'CRLA' },
  { printed: 'C.S.', code: 'CS' },
  { printed: 'O.S.A.', code: 'OSA' },
  { printed: 'Arb O.P.', code: 'ARBOP' },
  { printed: 'S.A.', code: 'SA', variants: true },
  { printed: 'C.R.P.(NPD)', code: 'CRPNPD' },
  { printed: 'C.S.(COMM DIV)', code: 'CSCOMMDIV' },
  { printed: 'W.P.(MD)', code: 'WP', seat: 'MD', misc: 'W.M.P.(MD)' },
  { printed: 'Crl.O.P.(MD)', code: 'CRLOP', seat: 'MD' },
];

/** Stage headings with their stage-map key; `null` is an unmapped heading kept verbatim. */
const STAGES: readonly { raw: string; norm: string | null }[] = [
  { raw: 'FOR ADMISSION', norm: 'admission' },
  { raw: 'FOR ADMISSION', norm: 'admission' },
  { raw: 'FOR ORDERS', norm: 'orders' },
  { raw: 'FOR HEARING', norm: 'hearing' },
  { raw: 'FOR FINAL HEARING', norm: 'hearing' },
  { raw: 'AFTER NOTICE', norm: 'after_notice' },
  { raw: 'PART HEARD', norm: 'part_heard' },
  { raw: 'FRESH CASES', norm: 'fresh' },
  { raw: 'FOR MENTIONING', norm: 'mentioning' },
  { raw: 'TO BE SPOKEN TO', norm: null },
];

const SIDES = ['APPELLATE SIDE', 'ORIGINAL SIDE', 'FIRST BENCH', 'CRIMINAL SIDE'] as const;
const LIST_TYPES = ['DAILY', 'DAILY', 'ADVANCE', 'SUPPLEMENTARY'] as const;
const NUMBER_WORDS = ['two', 'three', 'four', 'six'] as const;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August'];
const MONTHS_TAIL = ['September', 'October', 'November', 'December'];
const MONTH_NAMES = [...MONTHS, ...MONTHS_TAIL];

const int = (random: () => number, min: number, max: number): number =>
  min + Math.floor(random() * (max - min + 1));
const pad2 = (n: number): string => String(n).padStart(2, '0');

/** A calendar day as ISO, `days` after 2026-01-01 (UTC arithmetic, never the clock). */
function isoDay(days: number): string {
  const date = new Date(Date.UTC(2026, 0, 1 + days));
  return `${String(date.getUTCFullYear())}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

const addDays = (iso: string, days: number): string => {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(y ?? 2026, (m ?? 1) - 1, (d ?? 1) + days));
  return `${String(date.getUTCFullYear())}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
};

/** `dd.mm.yyyy`, the court's usual spelling. */
const dotted = (iso: string): string => {
  const [y, m, d] = iso.split('-');
  return `${d ?? ''}.${m ?? ''}.${y ?? ''}`;
};

/** One of the day-first spellings `normaliseDate` reads. */
function spelled(random: () => number, iso: string): string {
  const [y, m, d] = iso.split('-');
  const day = Number(d);
  const ordinal =
    day === 1 || day === 21 || day === 31 ? 'st' : day === 2 || day === 22 ? 'nd' : 'th';
  switch (int(random, 0, 3)) {
    case 0:
      return dotted(iso);
    case 1:
      return `${d ?? ''}-${m ?? ''}-${y ?? ''}`;
    case 2:
      return `${d ?? ''}/${m ?? ''}/${y ?? ''}`;
    default:
      return `${String(day)}${day === 3 || day === 23 ? 'rd' : ordinal} ${MONTH_NAMES[Number(m) - 1] ?? ''}, ${y ?? ''}`;
  }
}

interface ListCase {
  caseLine: string;
  row: Omit<MadrasTruthRow, 'hallNo' | 'itemNo' | 'stageRaw' | 'stageNorm'>;
}

/** A case line (`W.P.No.12345 of 2026 and W.M.P.No.13001 of 2026`) with its parsed fields. */
function caseOf(random: () => number, used: Set<string>): ListCase {
  for (;;) {
    const type = pick(random, CASE_TYPES);
    const number = String(int(random, 1, 29_999));
    const year = int(random, 2019, 2026);
    const key = `${type.code}${type.seat === undefined ? '' : `(${type.seat})`}/${number}/${String(year)}`;
    if (used.has(key)) continue;
    used.add(key);
    const variant = type.variants === true ? int(random, 0, 2) : 0;
    // `W.P.No.1` but `CRL OP No.1`: a type ending in a letter keeps its space before `No.`.
    const no = /[A-Za-z]$/.test(type.printed) ? ' No.' : 'No.';
    let caseLine =
      variant === 0
        ? `${type.printed}${no}${number} of ${String(year)}`
        : variant === 1
          ? `${type.printed} No. ${number}/${String(year)}`
          : `${type.printed} No. ${number} / ${String(year)}`;
    if (type.misc !== undefined && random() < 0.35) {
      caseLine += ` and ${type.misc}No.${String(int(random, 1, 19_999))} of ${String(year)}`;
    }
    return {
      caseLine,
      row: {
        caseTypeRaw: type.printed,
        caseType: type.code,
        seatSuffix: type.seat ?? null,
        caseNumber: number,
        caseYear: year,
        matchKey: key,
        parties: '',
      },
    };
  }
}

/** Person advocates first: a line opening with an `M/s` firm may be a party (list-grammar.ts). */
const PERSON_ADVOCATES = ADVOCATES.filter((name) => !name.startsWith('M/s'));

function advocatesLine(random: () => number): string {
  const first = pick(random, PERSON_ADVOCATES);
  if (random() < 0.5) return first;
  const second = pick(random, ADVOCATES);
  return second === first ? first : `${first} / ${second}`;
}

function benchLines(random: () => number): string[] {
  const judge = pick(random, JUDGES);
  if (random() < 0.2) return [CHIEF_JUSTICE, judge];
  if (random() < 0.2) {
    const second = pick(random, JUDGES);
    return second === judge ? [judge] : [judge, second];
  }
  return [judge];
}

interface Hall {
  hallNo: string;
  bench: string[];
  stages: { stage: (typeof STAGES)[number]; items: { itemNo: string; lines: string[] }[] }[];
}

/** Halls of numbered rows, with the truth rows in print order. */
function hallsOf(
  random: () => number,
  rows: MadrasTruthRow[],
  options: { halls: number; maxRows: number },
): Hall[] {
  const used = new Set<string>();
  const hallNos = new Set<number>();
  const halls: Hall[] = [];
  while (hallNos.size < options.halls) hallNos.add(int(random, 1, 45));
  for (const hallNo of hallNos) {
    const hall: Hall = { hallNo: String(hallNo), bench: benchLines(random), stages: [] };
    let item = 0;
    const stageCount = int(random, 1, 3);
    const stages = new Set<(typeof STAGES)[number]>();
    while (stages.size < stageCount) stages.add(pick(random, STAGES));
    for (const stage of stages) {
      const items: Hall['stages'][number]['items'] = [];
      for (let i = int(random, 2, options.maxRows); i > 0; i -= 1) {
        item += 1;
        const roll = random();
        const itemNo =
          roll < 0.06 ? `${String(item)}A` : roll < 0.1 ? `${String(item)}(a)` : String(item);
        const { caseLine, row } = caseOf(random, used);
        const parties = `${pick(random, PETITIONERS)} vs ${pick(random, RESPONDENTS)}`;
        items.push({
          itemNo,
          lines: [`${itemNo}. ${caseLine}`, `   ${parties}`, `   ${advocatesLine(random)}`],
        });
        rows.push({
          ...row,
          parties,
          hallNo: hall.hallNo,
          itemNo,
          stageRaw: stage.raw,
          stageNorm: stage.norm,
        });
      }
      hall.stages.push({ stage, items });
    }
    halls.push(hall);
  }
  return halls;
}

function generateList(random: () => number, index: number, pdf: boolean) {
  const listDate = isoDay(int(random, 0, 330));
  const side = pick(random, SIDES);
  const header = [
    'HIGH COURT OF JUDICATURE AT MADRAS',
    `${side} (FICTIONAL - SYNTHETIC FIXTURE)`,
    `${pick(random, LIST_TYPES)} CAUSE LIST FOR ${dotted(listDate)}`,
  ];
  const rows: MadrasTruthRow[] = [];
  const halls = hallsOf(random, rows, { halls: int(random, 1, 3), maxRows: 6 });
  // Body lines, then pages of at most `perPage` lines with the header repeated and a page marker.
  const body: string[] = [];
  for (const hall of halls) {
    body.push('', `COURT No. ${hall.hallNo}`, ...hall.bench);
    for (const { stage, items } of hall.stages) {
      body.push('', stage.raw);
      for (const { lines } of items) body.push(...lines);
    }
  }
  const perPage = pdf ? 44 : int(random, 18, 60);
  const chunks: string[][] = [];
  for (let at = 0; at < body.length; at += perPage) chunks.push(body.slice(at, at + perPage));
  const pages = chunks.map((chunk, i) => [
    ...header,
    ...chunk,
    '',
    `Page ${String(i + 1)} of ${String(chunks.length)}`,
  ]);
  const name = `list-${String(index + 1).padStart(3, '0')}`;
  return { name, pages, truth: { listDate, rows, dates: [listDate] } };
}

/** An AIMS email: plain-text hall blocks, or an HTML table without stage headings. */
function generateEmail(random: () => number, index: number): GeneratedDocument {
  const listDate = isoDay(int(random, 0, 330));
  const rows: MadrasTruthRow[] = [];
  const halls = hallsOf(random, rows, { halls: int(random, 1, 2), maxRows: 3 });
  const name = `email-${String(index + 1).padStart(3, '0')}`;
  const html = random() < 0.4;
  const head = [
    'From: AIMS Registry <aims-registry@example.test>',
    'To: Advocate R. Fictional <r.fictional@example.test>',
    // The subject picks the profile (config/email-profiles.ts): `tagged cases` is the table one.
    html
      ? `Subject: AIMS - Tagged cases listed on ${dotted(listDate)}`
      : `Subject: Cause List for ${dotted(listDate)}`,
    'Date: Thu, 22 Oct 2026 18:05:00 +0530',
    `Message-ID: <${name}@example.test>`,
    'MIME-Version: 1.0',
    `Content-Type: text/${html ? 'html' : 'plain'}; charset=utf-8`,
    'Content-Transfer-Encoding: 7bit',
    '',
  ];
  let body: string[];
  if (html) {
    const cells: string[] = [];
    for (const row of rows) {
      const hall = halls.find((h) => h.hallNo === row.hallNo);
      const item = hall?.stages.flatMap((s) => s.items).find((i) => i.itemNo === row.itemNo);
      const caseLine = (item?.lines[0] ?? '').replace(/^\S+\s/, '');
      const advocates = (item?.lines[2] ?? '').trim();
      cells.push(
        `<tr><td>Court No. ${row.hallNo}</td><td>${row.itemNo}</td><td>${caseLine}</td><td>${row.parties}</td><td>${advocates.replace(/&/g, '&amp;')}</td></tr>`,
      );
      row.stageRaw = null;
      row.stageNorm = null;
    }
    body = [
      '<html><body>',
      '<p>Dear Advocate,</p>',
      `<p>Your tagged cases (FICTIONAL - SYNTHETIC FIXTURE):</p>`,
      '<table border="1">',
      '<tr><th>Court Hall</th><th>Item</th><th>Case No.</th><th>Parties</th><th>Advocates</th></tr>',
      ...cells,
      '</table>',
      '<p>-- This is a system generated email from AIMS.</p>',
      '</body></html>',
    ];
  } else {
    body = [
      'Dear Advocate,',
      '',
      'The cases tagged by you (MS/123/1990) are listed as below.',
      '(FICTIONAL - SYNTHETIC FIXTURE)',
    ];
    for (const hall of halls) {
      body.push('', `COURT No. ${hall.hallNo}`, ...hall.bench);
      for (const { stage, items } of hall.stages) {
        body.push(stage.raw);
        for (const { lines } of items) body.push(...lines);
      }
    }
    body.push(
      '',
      '--',
      'This is a system generated email from AIMS (FICTIONAL - SYNTHETIC FIXTURE).',
    );
  }
  return {
    name,
    kind: 'cause_list',
    format: 'eml',
    content: `${[...head, ...body].join('\n')}\n`,
    truth: { listDate, rows, dates: [listDate] },
  };
}

function generateOrder(random: () => number, index: number): GeneratedDocument {
  const orderDate = isoDay(int(random, 0, 330));
  const dates = [orderDate];
  const { caseLine } = caseOf(random, new Set());
  const label = pick(random, ['DATED:', 'DATED :', 'Date of order:', 'DATED']);
  const lines = [
    'IN THE HIGH COURT OF JUDICATURE AT MADRAS',
    '(FICTIONAL SYNTHETIC ORDER: every party, advocate and judge is fictional)',
    `${label} ${spelled(random, orderDate)}`,
    'CORAM',
    pick(random, JUDGES),
    caseLine,
    `${pick(random, PETITIONERS)} ... Petitioner`,
    'Vs.',
    `${pick(random, RESPONDENTS)} ... Respondent`,
    'Prayer: Petition filed under Article 226 of the Constitution of India for a writ of mandamus.',
    `For Petitioner : ${pick(random, ADVOCATES)}`,
    `For Respondent : ${pick(random, ADVOCATES)}`,
    'ORDER',
    'Heard the learned counsel on either side.',
  ];
  if (random() < 0.25) {
    // A decoy: an earlier order's date is printed but is neither the order date nor a next date.
    const earlier = isoDay(int(random, -2000, -30));
    dates.push(earlier);
    lines.push(`The petitioner relies on the order dated ${dotted(earlier)} in the earlier round.`);
  }
  const cues = int(random, 0, 2);
  for (let i = 0; i < cues; i += 1) {
    switch (int(random, 0, 4)) {
      case 0: {
        const next = addDays(orderDate, int(random, 7, 60));
        dates.push(next);
        lines.push(`Post on ${dotted(next)}.`);
        break;
      }
      case 1:
        lines.push(`List after ${pick(random, NUMBER_WORDS)} weeks.`);
        break;
      case 2:
        lines.push('Issue notice to the respondent, returnable in two weeks.');
        break;
      case 3:
        lines.push(`Counter affidavit to be filed within ${pick(random, NUMBER_WORDS)} weeks.`);
        break;
      default:
        lines.push('There shall be an order of interim stay till the next hearing.');
    }
  }
  return {
    name: `order-${String(index + 1).padStart(3, '0')}`,
    kind: 'order',
    format: 'txt',
    content: `${lines.join('\n')}\n`,
    truth: { orderDate, dates },
  };
}

function generateNotice(random: () => number, index: number): GeneratedDocument {
  const dated = random() < 0.8;
  const basis = isoDay(int(random, 0, 330));
  const days = int(random, 3, 30);
  const sr = `SR.No.${String(int(random, 1, 29_999))} of 2026`;
  const lines = [
    'HIGH COURT OF JUDICATURE AT MADRAS',
    `REGISTRY: ${pick(random, ['WRIT SECTION', 'CIVIL SECTION', 'CRIMINAL SECTION'])}`,
    '(FICTIONAL SYNTHETIC REGISTRY NOTICE: every name is fictional)',
    ...(dated ? [`Date: ${dotted(basis)}`] : []),
    `${sr}: the papers shall be re-presented within ${String(days)} days at the seat for returns after curing the defects.`,
  ];
  return {
    name: `notice-${String(index + 1).padStart(3, '0')}`,
    kind: 'registry_notice',
    format: 'txt',
    content: `${lines.join('\n')}\n`,
    truth: { dates: dated ? [basis, addDays(basis, days)] : [] },
  };
}

/**
 * Every Madras document for `seed`: lists (about one in five a PDF), emails, orders and notices.
 * Each kind draws from its own stream, so changing one count never changes another kind's bytes.
 */
export async function generateMadrasFixtures({
  seed,
  lists = 30,
  emails = 10,
  orders = 50,
  notices = 10,
}: GenerateMadrasOptions): Promise<GeneratedFixtures> {
  const documents: GeneratedDocument[] = [];
  const listRandom = mulberry32(seed);
  for (let i = 0; i < lists; i += 1) {
    const pdf = i % 5 === 4;
    const list = generateList(listRandom, i, pdf);
    documents.push({
      name: list.name,
      kind: 'cause_list',
      format: pdf ? 'pdf' : 'txt',
      content: pdf
        ? await writeSyntheticPdf(list.pages)
        : `${list.pages.map((page) => page.join('\n')).join('\n\f')}\n`,
      truth: list.truth,
    });
  }
  const emailRandom = mulberry32(seed ^ 0x0e0e0e);
  for (let i = 0; i < emails; i += 1) documents.push(generateEmail(emailRandom, i));
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
}): Promise<Record<GeneratedKind, number> & { emails: number }> {
  const { documents } = await generateMadrasFixtures({ seed });
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
    adapter: 'in.tn.madras-hc.principal',
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
    emails: documents.filter((doc) => doc.format === 'eml').length,
  };
}
