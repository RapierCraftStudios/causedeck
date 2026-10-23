// Seeded synthetic A0 fixtures (#56). District cause lists and orders in English, Tamil, Kannada and
// mixed script, commercial-court (`Com.O.S.`) numbering, CNRs, a table layout, an image-only PDF
// with an OCR sidecar and malformed documents, for each of the three A0 ids. Everything is FICTIONAL:
// every party is made up and the courts are not real establishments; real district fixtures are
// validated later with #119. The same seed gives the same bytes. Test tooling only: not exported
// from the package entry. Regenerate the committed fixtures after a deliberate change (then run
// Prettier and review):
//   node --experimental-strip-types -e \
//     "import('./src/generic-a0/synthetic/generate.ts').then((m) => m.writeA0Fixtures())"
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { addInterval, renderDate } from '@causedeck/intelligence/extract';
import { PDFDocument } from 'pdf-lib';

import { layoutFromPdf } from '../../layout/pdf.ts';
import { GOLDEN_RECEIVED_AT } from '../../testing/golden.ts';
import { mulberry32 } from '../../testing/synthetic.ts';
import type { LayoutDocument, ParserInput } from '../../types.ts';
import { createA0Adapter } from '../index.ts';

export const A0_SYNTHETIC_FORUMS = [
  { adapterId: 'generic.a0', forumCode: 'generic.a0', court: 'THE FICTIONAL DISTRICT COURT' },
  {
    adapterId: 'in.ka.bengaluru-urban.district',
    forumCode: 'in.ka.bengaluru-urban.city-civil-sessions',
    court: 'THE FICTIONAL CITY CIVIL COURT, BENGALURU',
  },
  {
    adapterId: 'in.tn.chennai.district',
    forumCode: 'in.tn.chennai.city-civil-court',
    court: 'THE FICTIONAL CITY CIVIL COURT, CHENNAI',
  },
] as const;
export type A0SyntheticForum = (typeof A0_SYNTHETIC_FORUMS)[number];

export const A0_SCENARIOS = [
  'list-english',
  'list-tamil',
  'list-kannada',
  'list-mixed',
  'list-commercial',
  'list-cnr',
  'list-table',
  'list-image-only',
  'list-malformed',
  'order-english',
  'order-tamil',
  'order-kannada',
  'order-mixed',
  'order-commercial',
  'order-cnr',
  'order-malformed',
] as const;
export type A0Scenario = (typeof A0_SCENARIOS)[number];

/** A case as the document prints it, and as the parser must normalise it. */
export interface A0TruthCase {
  caseTypeRaw: string;
  caseType: string;
  caseNumber: string;
  caseYear: number;
  cnr?: string;
}

export interface A0Truth {
  kind: 'cause_list' | 'order';
  cases: A0TruthCase[];
  listDate?: string;
  orderDate?: string;
  nextDate?: string;
  /** Every absolute date written in the document (a decoy among them is not a next date). */
  dates: string[];
  language: 'en' | 'ta' | 'kn' | 'ta+en' | 'kn+en';
}

export interface GeneratedA0Document {
  name: string;
  kind: 'cause_list' | 'order';
  ext: 'txt' | 'json' | 'pdf';
  forum: A0SyntheticForum;
  scenario: A0Scenario;
  /** The text pages (an OCR sidecar's pages for the image-only list). */
  pages: string[];
  /** The `.input.json` layout of a table list. */
  layout?: LayoutDocument;
  truth: A0Truth;
}

type Language = 'en' | 'ta' | 'kn';

interface Pack {
  parties: readonly string[];
  stages: readonly string[];
  vs: string;
  listTitle: string;
  dated: string;
  direction: string;
  post: (date: string) => string;
  digits: 'ta' | 'kn' | undefined;
}

const PACKS: Record<Language, Pack> = {
  en: {
    parties: [
      'Fictional Traders Pvt Ltd',
      'Imaginary Textiles',
      'Pretend Housing Society',
      'Made-up Farmer',
      'Invented Motors',
      'Sample Bank Ltd',
    ],
    stages: ['FOR ORDERS', 'FOR EVIDENCE', 'FOR ARGUMENTS'],
    vs: 'vs',
    listTitle: 'CAUSE LIST FOR',
    dated: 'Dated:',
    direction: 'The plaintiff is directed to file the counter within two weeks.',
    post: (d) => `Post on ${d} for evidence.`,
    digits: undefined,
  },
  ta: {
    parties: [
      'கற்பனை வணிகர்கள் நிறுவனம்',
      'புனைவு ஜவுளி',
      'கற்பனை குடியிருப்போர் சங்கம்',
      'போலி விவசாயி',
      'மாதிரி வங்கி',
      'கற்பனை மோட்டார்ஸ்',
    ],
    stages: ['ஆணைக்காக', 'சாட்சியத்திற்காக', 'வாதத்திற்காக'],
    vs: 'எதிர்',
    listTitle: 'வழக்குப் பட்டியல்',
    dated: 'தேதி:',
    direction: 'வாதி இரண்டு வாரங்களுக்குள் பதில் மனு தாக்கல் செய்ய வேண்டும்.',
    post: (d) => `${d} அன்று சாட்சியத்திற்காக பட்டியலிடப்படும்.`,
    digits: 'ta',
  },
  kn: {
    parties: [
      'ಕಾಲ್ಪನಿಕ ವ್ಯಾಪಾರಿಗಳ ಸಂಸ್ಥೆ',
      'ಕಲ್ಪಿತ ಜವಳಿ',
      'ಕಾಲ್ಪನಿಕ ವಸತಿ ಸಂಘ',
      'ಕಾಲ್ಪನಿಕ ರೈತ',
      'ಮಾದರಿ ಬ್ಯಾಂಕ್',
      'ಕಲ್ಪಿತ ಮೋಟಾರ್ಸ್',
    ],
    stages: ['ಆದೇಶಕ್ಕಾಗಿ', 'ಸಾಕ್ಷ್ಯಕ್ಕಾಗಿ', 'ವಾದಕ್ಕಾಗಿ'],
    vs: 'ವಿರುದ್ಧ',
    listTitle: 'ಪ್ರಕರಣಗಳ ಪಟ್ಟಿ',
    dated: 'ದಿನಾಂಕ:',
    direction: 'ವಾದಿಯು ಎರಡು ವಾರಗಳಲ್ಲಿ ಉತ್ತರ ಸಲ್ಲಿಸಬೇಕು.',
    post: (d) => `${d} ರಂದು ಸಾಕ್ಷ್ಯಕ್ಕಾಗಿ ಪಟ್ಟಿ ಮಾಡಲಾಗುವುದು.`,
    digits: 'kn',
  },
};

const DISTRICT_TYPES: readonly [string, string][] = [
  ['O.S.', 'OS'],
  ['Crl.Misc.', 'CRLMISC'],
  ['Ex.P.', 'EXP'],
  ['CCCA', 'CCCA'],
  ['C.C.', 'CC'],
  ['S.C.', 'SC'],
  ['M.V.C.', 'MVC'],
];
const COMMERCIAL_TYPES: readonly [string, string][] = [
  ['Com.O.S.', 'COMOS'],
  ['Com.Ex.', 'COMEX'],
  ['Com.A.P.', 'COMAP'],
  ['Com.A.A.', 'COMAA'],
  ['Com.Misc.', 'COMMISC'],
  ['Com.FDP', 'COMFDP'],
];

const FIXED_DATE = new Date('2026-01-01T00:00:00.000Z');
/** A valid 1x1 PNG: the "scan" of an image-only page. */
const PNG_1X1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const pick = <T>(random: () => number, values: readonly T[]): T =>
  values[Math.floor(random() * values.length)] as T;
const int = (random: () => number, min: number, max: number): number =>
  min + Math.floor(random() * (max - min + 1));
const pad = (n: number, width: number): string => String(n).padStart(width, '0');

/** A fictional but well-formed ISO date in the second half of 2026. */
function randomDate(random: () => number): string {
  return `2026-${pad(int(random, 7, 12), 2)}-${pad(int(random, 1, 28), 2)}`;
}

/** An eCourts-shaped CNR: 4 letters, 2 digits, 6 digits, 4-digit year (16 characters). */
function randomCnr(random: () => number, forum: A0SyntheticForum, year: number): string {
  const prefix = forum.adapterId.startsWith('in.tn') ? 'TNCH' : 'KABG';
  return `${prefix}${pad(int(random, 1, 9), 2)}${pad(int(random, 1, 999_999), 6)}${String(year)}`;
}

function cases(
  random: () => number,
  forum: A0SyntheticForum,
  count: number,
  types: readonly [string, string][],
  withCnr: boolean,
): A0TruthCase[] {
  const seen = new Set<string>();
  const out: A0TruthCase[] = [];
  while (out.length < count) {
    const [caseTypeRaw, caseType] = pick(random, types);
    const caseNumber = String(int(random, 1, 9999));
    const caseYear = int(random, 2019, 2026);
    const key = `${caseType}/${caseNumber}/${String(caseYear)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      caseTypeRaw,
      caseType,
      caseNumber,
      caseYear,
      ...(withCnr ? { cnr: randomCnr(random, forum, caseYear) } : {}),
    });
  }
  return out;
}

const caseText = (c: A0TruthCase): string =>
  `${c.caseTypeRaw} No. ${c.caseNumber}/${String(c.caseYear)}`;

function rowLine(random: () => number, serial: number, c: A0TruthCase, pack: Pack): string {
  const a = pick(random, pack.parties);
  let b = pick(random, pack.parties);
  if (b === a) b = pack.parties[(pack.parties.indexOf(a) + 1) % pack.parties.length] ?? b;
  const cnr = c.cnr === undefined ? '' : `    CNR: ${c.cnr}`;
  return `${String(serial)}. ${caseText(c)}    ${a} ${pack.vs} ${b}${cnr}`;
}

interface ListParts {
  pages: string[];
  truth: A0Truth;
}

function buildList(
  random: () => number,
  forum: A0SyntheticForum,
  languages: readonly Language[],
  types: readonly [string, string][],
  options: { withCnr?: boolean; malformed?: boolean; rows?: number } = {},
): ListParts {
  const listDate = randomDate(random);
  const first = PACKS[languages[0] ?? 'en'];
  const list = cases(random, forum, options.rows ?? 9, types, options.withCnr === true);
  const dates = [listDate];
  const pages: string[] = [];
  let serial = 0;
  const perPage = 5;
  for (let at = 0; at < list.length; at += perPage) {
    const lines: string[] = [];
    if (at === 0) {
      lines.push(
        `IN ${forum.court} (FICTIONAL)`,
        `${first.listTitle} ${renderDate(listDate, 'dd.mm.yyyy', first.digits)}`,
      );
    }
    lines.push(`COURT HALL ${String(int(random, 1, 40))}`);
    lines.push(pick(random, first.stages));
    for (const c of list.slice(at, at + perPage)) {
      serial += 1;
      const lang = languages[(serial - 1) % languages.length] ?? 'en';
      lines.push(rowLine(random, serial, c, PACKS[lang]));
    }
    if (options.malformed === true && at === 0) {
      lines.push(
        'O.S. No. /2025   Fictional Traders Pvt Ltd vs Imaginary Textiles',
        'Crl.Misc. No. abc of 2025',
        '12/2025',
        'No. 55 of',
        '#####  ####',
        'KABG0101234520',
        'Posted 32.13.2026',
      );
    }
    pages.push(lines.join('\n'));
  }
  const language: A0Truth['language'] =
    languages.length > 1 ? (languages.includes('kn') ? 'kn+en' : 'ta+en') : (languages[0] ?? 'en');
  return { pages, truth: { kind: 'cause_list', cases: list, listDate, dates, language } };
}

/** A table list as a layout reader produces it: one cell per column, rows 16 pt apart. */
function tableLayout(
  random: () => number,
  forum: A0SyntheticForum,
  language: Language,
): { layout: LayoutDocument; truth: A0Truth } {
  const pack = PACKS[language];
  const listDate = randomDate(random);
  const list = cases(random, forum, 8, COMMERCIAL_TYPES, false);
  const lines: { text: string; cells: [number, string][]; y: number }[] = [];
  let y = 40;
  const push = (cells: [number, string][]) => {
    lines.push({ text: cells.map(([, t]) => t).join(' '), cells, y });
    y += 16;
  };
  push([[40, `${pack.listTitle} ${renderDate(listDate, 'dd.mm.yyyy', pack.digits)}`]]);
  push([[40, 'COURT HALL 7']]);
  push([
    [40, 'Sl. No.'],
    [90, 'Case No.'],
    [260, 'Parties'],
    [480, 'Stage'],
  ]);
  list.forEach((c, index) => {
    const a = pick(random, pack.parties);
    const b = pick(random, pack.parties);
    push([
      [40, String(index + 1)],
      [90, caseText(c)],
      [260, `${a} ${pack.vs} ${b}`],
      [480, pick(random, pack.stages)],
    ]);
  });
  const layout: LayoutDocument = {
    pages: [
      {
        page: 1,
        width: 595,
        height: 842,
        text: lines.map((l) => l.text).join('\n'),
        items: lines.flatMap((l) =>
          l.cells.map(([x, text]) => ({
            text,
            bbox: { x, y: l.y, width: Math.max(8, text.length * 5), height: 10 },
          })),
        ),
        textCoverage: 0.4,
      },
    ],
  };
  const language2: A0Truth['language'] =
    language === 'en' ? 'en' : language === 'ta' ? 'ta+en' : 'kn+en';
  return {
    layout,
    truth: { kind: 'cause_list', cases: list, listDate, dates: [listDate], language: language2 },
  };
}

interface OrderOptions {
  withCnr?: boolean;
  relative?: boolean;
  malformed?: boolean;
}

function buildOrder(
  random: () => number,
  forum: A0SyntheticForum,
  languages: readonly Language[],
  types: readonly [string, string][],
  options: OrderOptions = {},
): { pages: string[]; truth: A0Truth } {
  const pack = PACKS[languages[0] ?? 'en'];
  const second = PACKS[languages[1] ?? languages[0] ?? 'en'];
  const orderDate = randomDate(random);
  const [c] = cases(random, forum, 1, types, options.withCnr === true);
  const nextDate =
    options.relative === true ? addInterval(orderDate, 4, 'week') : randomDate(random);
  const dates = [orderDate];
  const lit = (iso: string, p: Pack) => renderDate(iso, 'dd.mm.yyyy', p.digits);
  const lines = [`IN ${forum.court} (FICTIONAL)`, `${pack.dated} ${lit(orderDate, pack)}`];
  if (c === undefined) throw new Error('no case generated');
  const printed =
    options.malformed === true ? `${c.caseTypeRaw} No. ${c.caseNumber} of` : caseText(c);
  lines.push(printed);
  if (c.cnr !== undefined) lines.push(`CNR: ${c.cnr}`);
  lines.push(`${pick(random, pack.parties)} ${pack.vs} ${pick(random, second.parties)}`, 'ORDER');
  lines.push(second.direction);
  if (options.relative === true) lines.push('List after four weeks.');
  else if (options.malformed !== true) {
    lines.push(second.post(lit(nextDate, second)));
    dates.push(nextDate);
  }
  if (options.malformed === true) {
    const decoy = '2019-03-03';
    lines.push(
      `In the order dated ${renderDate(decoy, 'dd.mm.yyyy')} the application was dismissed.`,
    );
    dates.push(decoy);
    lines.push('##  ~~~  O.C.R noise  ##', 'Fictional ?? vs ??');
  }
  const language: A0Truth['language'] =
    languages.length > 1 ? (languages.includes('kn') ? 'kn+en' : 'ta+en') : (languages[0] ?? 'en');
  return {
    pages: [lines.join('\n')],
    truth: {
      kind: 'order',
      cases: options.malformed === true ? [] : [c],
      orderDate,
      ...(options.malformed === true ? {} : { nextDate }),
      dates,
      language,
    },
  };
}

/** A fixture document for `scenario`, reproducible from `seed`. */
export function generateA0Document(
  forum: A0SyntheticForum,
  scenario: A0Scenario,
  seed: number,
): GeneratedA0Document {
  const index = A0_SYNTHETIC_FORUMS.indexOf(forum) * 100 + A0_SCENARIOS.indexOf(scenario);
  const random = mulberry32(seed * 7919 + index * 104_729 + 17);
  const head = { forum, scenario, name: scenario };
  const kind = scenario.startsWith('list') ? ('cause_list' as const) : ('order' as const);
  switch (scenario) {
    case 'list-english':
      return { ...head, kind, ext: 'txt', ...buildList(random, forum, ['en'], DISTRICT_TYPES) };
    case 'list-tamil':
      return { ...head, kind, ext: 'txt', ...buildList(random, forum, ['ta'], DISTRICT_TYPES) };
    case 'list-kannada':
      return { ...head, kind, ext: 'txt', ...buildList(random, forum, ['kn'], DISTRICT_TYPES) };
    case 'list-mixed':
      return {
        ...head,
        kind,
        ext: 'txt',
        ...buildList(
          random,
          forum,
          [forum.adapterId.startsWith('in.tn') ? 'ta' : 'kn', 'en'],
          DISTRICT_TYPES,
        ),
      };
    case 'list-commercial':
      return { ...head, kind, ext: 'txt', ...buildList(random, forum, ['en'], COMMERCIAL_TYPES) };
    case 'list-cnr':
      return {
        ...head,
        kind,
        ext: 'txt',
        ...buildList(random, forum, ['en'], DISTRICT_TYPES, { withCnr: true }),
      };
    case 'list-table': {
      const t = tableLayout(random, forum, forum.adapterId.startsWith('in.tn') ? 'ta' : 'en');
      return {
        ...head,
        kind,
        ext: 'json',
        pages: t.layout.pages.map((p) => p.text),
        layout: t.layout,
        truth: t.truth,
      };
    }
    case 'list-image-only':
      return {
        ...head,
        kind,
        ext: 'pdf',
        ...buildList(random, forum, ['en'], DISTRICT_TYPES, { rows: 6 }),
      };
    case 'list-malformed':
      return {
        ...head,
        kind,
        ext: 'txt',
        ...buildList(random, forum, ['en'], DISTRICT_TYPES, { malformed: true, rows: 4 }),
      };
    case 'order-english':
      return { ...head, kind, ext: 'txt', ...buildOrder(random, forum, ['en'], DISTRICT_TYPES) };
    case 'order-tamil':
      return { ...head, kind, ext: 'txt', ...buildOrder(random, forum, ['ta'], DISTRICT_TYPES) };
    case 'order-kannada':
      return { ...head, kind, ext: 'txt', ...buildOrder(random, forum, ['kn'], DISTRICT_TYPES) };
    case 'order-mixed':
      return {
        ...head,
        kind,
        ext: 'txt',
        ...buildOrder(
          random,
          forum,
          ['en', forum.adapterId.startsWith('in.tn') ? 'ta' : 'kn'],
          DISTRICT_TYPES,
        ),
      };
    case 'order-commercial':
      return {
        ...head,
        kind,
        ext: 'txt',
        ...buildOrder(random, forum, ['en'], COMMERCIAL_TYPES, { relative: true }),
      };
    case 'order-cnr':
      return {
        ...head,
        kind,
        ext: 'txt',
        ...buildOrder(random, forum, ['en'], DISTRICT_TYPES, { withCnr: true }),
      };
    case 'order-malformed':
      return {
        ...head,
        kind,
        ext: 'txt',
        ...buildOrder(random, forum, ['en'], DISTRICT_TYPES, { malformed: true }),
      };
  }
}

/** An image-only PDF (one embedded image per page, no text layer). */
export async function imageOnlyPdf(pageCount: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setCreationDate(FIXED_DATE);
  doc.setModificationDate(FIXED_DATE);
  doc.setProducer('causedeck synthetic fixtures (FICTIONAL)');
  doc.setCreator('causedeck synthetic fixtures (FICTIONAL)');
  const image = await doc.embedPng(Buffer.from(PNG_1X1, 'base64'));
  for (let i = 0; i < pageCount; i += 1) {
    const page = doc.addPage([595, 842]);
    page.drawImage(image, { x: 40, y: 40, width: 515, height: 762 });
  }
  return doc.save({ useObjectStreams: false });
}

/** The OCR layout (#45) of an image-only list: its text, as the OCR step would return it. */
export function ocrSidecar(doc: GeneratedA0Document): LayoutDocument {
  return {
    pages: doc.pages.map((text, i) => ({
      page: i + 1,
      width: 595,
      height: 842,
      text,
      items: [],
      textCoverage: 1,
    })),
  };
}

export const A0_FIXTURES_ROOT = path.resolve(import.meta.dirname, '../../../fixtures');
const SEED = 56;

/** Every file of the committed fixtures of one A0 adapter id. */
async function filesFor(
  forum: A0SyntheticForum,
): Promise<{ name: string; content: string | Uint8Array }[]> {
  const adapter = createA0Adapter({ id: forum.adapterId });
  const files: { name: string; content: string | Uint8Array }[] = [];
  const manifest: {
    file: string;
    kind: string;
    origin: string;
    classification: string;
    forumCode: string;
  }[] = [];
  for (const scenario of A0_SCENARIOS) {
    const doc = generateA0Document(forum, scenario, SEED);
    const file = `${doc.name}.input.${doc.ext}`;
    manifest.push({
      file,
      kind: doc.kind,
      origin: 'synthetic',
      classification: 'FICTIONAL',
      forumCode: forum.forumCode,
    });
    const meta = { fileName: file, receivedAt: GOLDEN_RECEIVED_AT, forumCode: forum.forumCode };
    let input: ParserInput;
    if (doc.ext === 'pdf') {
      const pdf = await imageOnlyPdf(doc.pages.length);
      files.push({ name: file, content: pdf });
      files.push({ name: `${doc.name}.ocr.json`, content: `${JSON.stringify(ocrSidecar(doc))}\n` });
      input = { kind: 'layout', layout: await layoutFromPdf(pdf), meta };
    } else if (doc.ext === 'json' && doc.layout !== undefined) {
      files.push({ name: file, content: `${JSON.stringify(doc.layout)}\n` });
      input = { kind: 'layout', layout: doc.layout, meta };
    } else {
      const text = doc.pages.join('\f');
      files.push({ name: file, content: text });
      input = { kind: 'text', text, meta };
    }
    const expected =
      doc.kind === 'cause_list'
        ? await adapter.parseCauseList(input)
        : { forumCode: forum.forumCode, truth: doc.truth };
    files.push({ name: `${doc.name}.expected.json`, content: `${JSON.stringify(expected)}\n` });
  }
  files.push({
    name: 'manifest.json',
    content: `${JSON.stringify({
      adapter: forum.adapterId,
      classification: 'FICTIONAL',
      note: `Synthetic A0 district fixtures from src/generic-a0/synthetic/generate.ts (#56), seed ${String(SEED)}. Every party and court is fictional; real district fixtures are validated later with #119.`,
      fixtures: manifest,
    })}\n`,
  });
  return files;
}

export async function writeA0Fixtures(root: string = A0_FIXTURES_ROOT): Promise<void> {
  for (const forum of A0_SYNTHETIC_FORUMS) {
    const dir = path.join(root, forum.adapterId);
    mkdirSync(dir, { recursive: true });
    for (const { name, content } of await filesFor(forum))
      writeFileSync(path.join(dir, name), content);
  }
}

/**
 * `gen:fixtures --adapter a0 --seed N` (`src/testing/gen-fixtures.ts`): the generic forum's seeded
 * documents and their truth files, for the generated-data metrics. Not the committed fixtures.
 */
export async function writeGeneratedFixtures(options: {
  seed: number;
  outDir: string;
}): Promise<{ cause_list: number; order: number; registry_notice: number }> {
  mkdirSync(options.outDir, { recursive: true });
  const forum = A0_SYNTHETIC_FORUMS[0];
  const counts = { cause_list: 0, order: 0, registry_notice: 0 };
  for (const scenario of A0_SCENARIOS) {
    const doc = generateA0Document(forum, scenario, options.seed);
    const base = path.join(options.outDir, `${doc.name}.input`);
    if (doc.ext === 'pdf') writeFileSync(`${base}.pdf`, await imageOnlyPdf(doc.pages.length));
    else if (doc.layout !== undefined) writeFileSync(`${base}.json`, JSON.stringify(doc.layout));
    else writeFileSync(`${base}.txt`, doc.pages.join('\f'));
    writeFileSync(path.join(options.outDir, `${doc.name}.truth.json`), JSON.stringify(doc.truth));
    counts[doc.kind] += 1;
  }
  return counts;
}
