// Synthetic fixtures for the document pipeline (#45). Every name, number and order below is
// fictional: parties are "Asha Vellore" style placeholders and case numbers use made-up courts.
// Documents are built in memory (pdf-lib, docx, sharp) so no binary is committed;
// `writeFixtures(dir)` writes them, with `.ocr.json` sidecars next to the scans, for manual use.
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import fontkit from '@pdf-lib/fontkit';
import { Document, Packer, Paragraph } from 'docx';
import { PDFDocument, PDFName, PDFString, StandardFonts, type PDFFont } from 'pdf-lib';

const require = createRequire(import.meta.url);
const font = (name: string): string =>
  require.resolve(`@fontsource/noto-sans-${name}/files/noto-sans-${name}-${name}-400-normal.woff`);

export const ENGLISH_ORDER_PAGES = [
  [
    'IN THE HIGH COURT OF JUDICATURE AT FICTIONALPUR',
    "PRESENT: HON'BLE MR. JUSTICE A. SAMPLE",
    'ORDER',
    'W.P. No. 4821/2024. Asha Vellore versus the Department of Roads, Sampleland.',
    'Learned counsel for the petitioner is heard. The respondent shall file a counter on the next date of hearing.',
  ],
  [
    'List the matter after four weeks. Interim protection granted earlier shall continue until then.',
    'The registry is directed to communicate this order to both parties without delay.',
  ],
];

export const TAMIL_ORDER_LINES = [
  "PRESENT: HON'BLE MR. JUSTICE B. EXAMPLE",
  'ஆணை',
  'ஆஷா வேலூர் என்பவர் தாக்கல் செய்த மனுவின் மீது விசாரணை நடைபெற்றது.',
  'எதிர்மனுதாரர் பதில் மனுவை அடுத்த விசாரணைக்குள் தாக்கல் செய்ய வேண்டும்.',
];

export const KANNADA_ORDER_LINES = [
  'ಮಾನ್ಯ ನ್ಯಾಯಮೂರ್ತಿ ಸಿ. ಮಾದರಿ ಅವರ ಮುಂದೆ',
  'ಆದೇಶ',
  'ಕಾವೇರಿ ಮಾದರಿ ಅವರ ಅರ್ಜಿಯ ವಿಚಾರಣೆ ನಡೆಯಿತು. ಪ್ರತಿವಾದಿಯು ಉತ್ತರ ಸಲ್ಲಿಸಬೇಕು.',
];
export const KANNADA_ORDER_ENGLISH_LINE =
  'Case Nos. W.P. 1042/2024 and C.P. 77/2025 (sample court).';

export const CAUSE_LIST_LINES = [
  'CAUSE LIST FOR 12.03.2025 - COURT HALL 7, HIGH COURT OF FICTIONALPUR',
  ...Array.from(
    { length: 6 },
    (_, i) =>
      `${String(i + 1)}. W.P. No. ${String(1000 + i)}/2024 Sample Party ${String(i + 1)} v. State`,
  ),
];

/** The text a legacy Nudi/Baraha-mapped Kannada page yields: Latin-1 symbol letters. */
export const LEGACY_KANNADA_TEXT =
  'ÀÄÝÀ¢ü £ÁAiÀiÁ®ÀAiÀÄ ªÀiÁ£Àå £Áåå¥ÀwÃ ¸ÀAªÀiÁzÀj gÀªÀgÀ ªÀÄÄAzÉ PÁªÉÃj ªÀiÁzÀj CfÃð « ÁgÀuÉ';

/** The text the same legacy page really shows; the sidecar OCR reads it. */
export const LEGACY_KANNADA_REAL_TEXT =
  'ಆದೇಶ ನ್ಯಾಯಾಲಯ ಮಾನ್ಯ ನ್ಯಾಯಮೂರ್ತಿ ಕಾವೇರಿ ಮಾದರಿ ಅವರ ಅರ್ಜಿಯ ವಿಚಾರಣೆ ನಡೆಯಿತು ಪ್ರತಿವಾದಿ ಉತ್ತರ ಸಲ್ಲಿಸಲಿ';

export const PARTY_TAMIL = 'ஆஷா வேலூர்';
export const PARTY_ENGLISH = 'Asha Vellore';

const PAGE: [number, number] = [595, 842];

async function newPdf(): Promise<PDFDocument> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  return pdf;
}

function drawLines(
  page: ReturnType<PDFDocument['addPage']>,
  font: PDFFont,
  lines: readonly string[],
  startY = 780,
): number {
  let y = startY;
  for (const line of lines) {
    page.drawText(line, { x: 48, y, size: 12, font, maxWidth: 500, lineHeight: 16 });
    y -= 22;
  }
  return y;
}

/** A PDF with a real text layer; one array of lines per page. */
export async function textPdf(pages: readonly (readonly string[])[]): Promise<Uint8Array> {
  const pdf = await newPdf();
  const helvetica = await pdf.embedFont(StandardFonts.Helvetica);
  for (const lines of pages) drawLines(pdf.addPage(PAGE), helvetica, lines);
  return pdf.save();
}

/** `count` text pages of ordinary order text, for the 20-page perf checks. */
export function longTextPages(count: number): string[][] {
  return Array.from({ length: count }, (_, i) => [
    `Page ${String(i + 1)} of the fictional record in W.P. No. 4821/2024.`,
    'Learned counsel for the petitioner submits that the notice was served late and the respondent',
    'has not placed any material to show otherwise; the matter is adjourned for further hearing.',
  ]);
}

/** Tamil or Kannada lines in an embedded Noto font, optionally with an English line below. */
export async function indicPdf(
  script: 'tamil' | 'kannada',
  lines: readonly string[],
  englishLine?: string,
): Promise<Uint8Array> {
  const pdf = await newPdf();
  const noto = await pdf.embedFont(await readBytes(font(script === 'tamil' ? 'tamil' : 'kannada')));
  const helvetica = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage(PAGE);
  const y = drawLines(page, noto, lines);
  if (englishLine !== undefined) drawLines(page, helvetica, [englishLine], y);
  return pdf.save();
}

async function readBytes(file: string): Promise<Uint8Array> {
  const { readFile } = await import('node:fs/promises');
  return readFile(file);
}

/** A raster of dark strokes on white: stands in for a scanned page (no text layer). */
async function scanImage(): Promise<Uint8Array> {
  const { default: sharp } = await import('sharp');
  const rows = Array.from(
    { length: 12 },
    (_, i) =>
      `<rect x="60" y="${String(80 + i * 60)}" width="${String(900 - (i % 3) * 120)}" height="14" fill="#222"/>`,
  ).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect width="1024" height="1024" fill="#fff"/>${rows}</svg>`;
  return new Uint8Array(await sharp(Buffer.from(svg)).png().toBuffer());
}

/** A PDF whose pages are only images: `scanned` pages carry no text, `textual` ones do. */
export async function mixedPdf(
  kinds: readonly ('scan' | 'text')[],
  textLines: readonly string[] = ENGLISH_ORDER_PAGES[0] ?? [],
): Promise<Uint8Array> {
  const pdf = await newPdf();
  const helvetica = await pdf.embedFont(StandardFonts.Helvetica);
  const image = await pdf.embedPng(await scanImage());
  for (const kind of kinds) {
    const page = pdf.addPage(PAGE);
    if (kind === 'scan') page.drawImage(image, { x: 40, y: 200, width: 500, height: 500 });
    else drawLines(page, helvetica, textLines);
  }
  return pdf.save();
}

/** A scanned (image-only) PDF of `pages` pages. */
export const scannedPdf = (pages: number): Promise<Uint8Array> =>
  mixedPdf(Array.from({ length: pages }, () => 'scan' as const));

/** A legacy-font Kannada page: the text layer is Latin-1 gibberish over a non-empty image. */
export async function legacyKannadaPdf(): Promise<Uint8Array> {
  const pdf = await newPdf();
  const helvetica = await pdf.embedFont(StandardFonts.Helvetica);
  const image = await pdf.embedPng(await scanImage());
  const page = pdf.addPage(PAGE);
  page.drawImage(image, { x: 40, y: 300, width: 400, height: 400 });
  drawLines(page, helvetica, [LEGACY_KANNADA_TEXT], 250);
  return pdf.save();
}

/** A PDF with `app.alert` JavaScript on open: it must never run. */
export async function maliciousPdf(): Promise<Uint8Array> {
  const pdf = await newPdf();
  const helvetica = await pdf.embedFont(StandardFonts.Helvetica);
  drawLines(pdf.addPage(PAGE), helvetica, ENGLISH_ORDER_PAGES[0] ?? []);
  const js = pdf.context.obj({
    Type: 'Action',
    S: 'JavaScript',
    JS: PDFString.of('app.alert("synthetic fixture: script ran");'),
  });
  pdf.catalog.set(PDFName.of('OpenAction'), pdf.context.register(js));
  const actions = pdf.context.obj({
    Type: 'Action',
    S: 'JavaScript',
    JS: PDFString.of('app.alert(1);'),
  });
  const names = pdf.context.obj({
    JavaScript: pdf.context.obj({ Names: [PDFString.of('x'), pdf.context.register(actions)] }),
  });
  pdf.catalog.set(PDFName.of('Names'), pdf.context.register(names));
  return pdf.save();
}

/** A PDF with a standard-handler `/Encrypt` dictionary and no known password. */
export function encryptedPdf(): Uint8Array {
  const hex32 = '00'.repeat(32);
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>',
    `<< /Filter /Standard /V 1 /R 2 /O <${hex32}> /U <${hex32}> /P -4 >>`,
  ];
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((object, i) => {
    offsets.push(body.length);
    body += `${String(i + 1)} 0 obj\n${object}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 5\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  body += `trailer\n<< /Size 5 /Root 1 0 R /Encrypt 4 0 R /ID [<${hex32.slice(0, 32)}> <${hex32.slice(0, 32)}>] >>\nstartxref\n${String(xref)}\n%%EOF\n`;
  return new TextEncoder().encode(body);
}

/** Bytes that start like a PDF and are not one. */
export function corruptPdf(): Uint8Array {
  return new TextEncoder().encode(
    '%PDF-1.7\nthis is not a pdf body, the xref and objects are gone',
  );
}

export async function docx(paragraphs: readonly string[]): Promise<Uint8Array> {
  const document = new Document({
    sections: [{ children: paragraphs.map((text) => new Paragraph(text)) }],
  });
  return new Uint8Array(await Packer.toBuffer(document));
}

/** Names that are real people or companies and must never appear in a fixture. */
export const KNOWN_REAL_NAMES = [
  'Reliance',
  'Adani',
  'Infosys',
  'Narendra Modi',
  'Supreme Court of India',
];

/** A bar enrolment number as printed in India: `KAR/1234/2015`, `MS/567/2009`. */
export const ENROLMENT_NUMBER = /\b[A-Z]{1,4}\/\d{1,5}\/(19|20)\d{2}\b/;

/** Every piece of fixture text, for the realness scan. */
export function allFixtureText(): string[] {
  return [
    ...ENGLISH_ORDER_PAGES.flat(),
    ...TAMIL_ORDER_LINES,
    ...KANNADA_ORDER_LINES,
    KANNADA_ORDER_ENGLISH_LINE,
    ...CAUSE_LIST_LINES,
    LEGACY_KANNADA_REAL_TEXT,
    PARTY_TAMIL,
    PARTY_ENGLISH,
  ];
}

/** Write the fixtures and their OCR sidecars under `dir`. */
export async function writeFixtures(dir: string): Promise<string[]> {
  mkdirSync(dir, { recursive: true });
  const files: [string, Uint8Array][] = [
    ['order-text.pdf', await textPdf(ENGLISH_ORDER_PAGES)],
    ['order-ta.pdf', await indicPdf('tamil', TAMIL_ORDER_LINES)],
    ['order-kn.pdf', await indicPdf('kannada', KANNADA_ORDER_LINES, KANNADA_ORDER_ENGLISH_LINE)],
    ['cause-list.pdf', await textPdf([CAUSE_LIST_LINES])],
    ['scan.pdf', await scannedPdf(2)],
    ['legacy-kn.pdf', await legacyKannadaPdf()],
    ['malicious.pdf', await maliciousPdf()],
    ['encrypted.pdf', encryptedPdf()],
    ['corrupt.pdf', corruptPdf()],
    ['order.docx', await docx(ENGLISH_ORDER_PAGES.flat())],
  ];
  for (const [name, bytes] of files) writeFileSync(path.join(dir, name), bytes);
  writeFileSync(
    path.join(dir, 'scan.pdf.ocr.json'),
    JSON.stringify({
      pages: ENGLISH_ORDER_PAGES.map((lines, i) => ({
        page: i + 1,
        text: lines.join('\n'),
        confidence: 0.92,
      })),
    }),
  );
  writeFileSync(
    path.join(dir, 'legacy-kn.pdf.ocr.json'),
    JSON.stringify({ pages: [{ page: 1, text: LEGACY_KANNADA_REAL_TEXT, confidence: 0.9 }] }),
  );
  return files.map(([name]) => name);
}
