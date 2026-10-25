// The roster PDF the import journeys upload (#437): a synthetic Madras-style "Sitting Arrangements
// wef" page. Every court, judge and portfolio is fictional. Built here without pdf-lib (the e2e
// package has none): an uncompressed PDF 1.4 with one A4 page and the standard Helvetica font in
// WinAnsi (not embedded, as pdf-lib's StandardFonts write it), one text run per table cell at fixed
// column offsets, the layout of packages/core/src/court/__fixtures__/rosters.ts. Hall 7 is printed
// with no judge and no portfolio, so the parser reads it at confidence 0.4 (below 0.6: "Check this
// row") and the lawyer must enter its judges before confirming. Plain Node only: no imports.

interface Cell {
  x: number;
  text: string;
}

const PAGE = { width: 595, height: 842 } as const;
const SIZE = 9;
const LINE_GAP = 18;
const HALL_X = 40;
const JUDGES_X = 150;
const PORTFOLIO_X = 400;

/** The effective date the PDF prints (`wef 05.10.2026`), as the preview reads it. */
export const ROSTER_PDF_EFFECTIVE_FROM = '2026-10-05';

/** The hall printed without judges or portfolio (confidence 0.4). */
export const ROSTER_PDF_LOW_HALL = '7';

const LINES: Cell[][] = [
  [{ x: HALL_X, text: 'HIGH COURT OF A FICTIONAL PROVINCE (SYNTHETIC ROSTER)' }],
  [{ x: HALL_X, text: 'SITTING ARRANGEMENTS wef 05.10.2026' }],
  [
    { x: HALL_X, text: 'COURT HALL' },
    { x: JUDGES_X, text: "HON'BLE JUDGES" },
    { x: PORTFOLIO_X, text: 'PORTFOLIO' },
  ],
  [
    { x: HALL_X, text: 'COURT HALL No. 2' },
    { x: JUDGES_X, text: "HON'BLE MR.JUSTICE A. VENPA (fictional)" },
    { x: PORTFOLIO_X, text: 'Writ Petitions' },
  ],
  [
    { x: HALL_X, text: 'COURT HALL No. 5' },
    { x: JUDGES_X, text: "HON'BLE MR.JUSTICE K. MARUDHAM (fictional)" },
    { x: PORTFOLIO_X, text: 'Writ Appeals' },
  ],
  [{ x: JUDGES_X, text: "HON'BLE MRS.JUSTICE T. NEITHAL (fictional)" }],
  [{ x: HALL_X, text: `COURT HALL No. ${ROSTER_PDF_LOW_HALL}` }],
  [
    { x: HALL_X, text: 'COURT HALL No. 12A' },
    { x: JUDGES_X, text: "HON'BLE DR.JUSTICE R. KURINJI (fictional)" },
    { x: PORTFOLIO_X, text: 'Criminal Revisions' },
  ],
  [{ x: HALL_X, text: 'BY ORDER OF THE HONOURABLE THE CHIEF JUSTICE' }],
];

export interface RosterPdfCandidate {
  hallNo: string;
  judges: string[];
  portfolioText: string;
  confidence: number;
}

/** What `previewRosterImport` reads from `rosterImportPdf()`, in order. */
export const ROSTER_PDF_EXPECTED: readonly RosterPdfCandidate[] = [
  {
    hallNo: '2',
    judges: ['Justice A. VENPA (fictional)'],
    portfolioText: 'Writ Petitions',
    confidence: 1,
  },
  {
    hallNo: '5',
    judges: ['Justice K. MARUDHAM (fictional)', 'Justice T. NEITHAL (fictional)'],
    portfolioText: 'Writ Appeals',
    confidence: 1,
  },
  { hallNo: ROSTER_PDF_LOW_HALL, judges: [], portfolioText: '', confidence: 0.4 },
  {
    hallNo: '12A',
    judges: ['Justice R. KURINJI (fictional)'],
    portfolioText: 'Criminal Revisions',
    confidence: 1,
  },
];

/** A PDF literal string: backslashes and parentheses escaped. ASCII only. */
function pdfString(text: string): string {
  return `(${text.replace(/[\\()]/g, (c) => `\\${c}`)})`;
}

function contentStream(): string {
  const runs: string[] = [];
  LINES.forEach((cells, index) => {
    const y = PAGE.height - 50 - index * LINE_GAP;
    for (const cell of cells) {
      runs.push(
        `BT /F1 ${String(SIZE)} Tf 1 0 0 1 ${String(cell.x)} ${String(y)} Tm ${pdfString(cell.text)} Tj ET`,
      );
    }
  });
  return runs.join('\n');
}

/** The roster PDF's bytes, built the same on every call. */
export function rosterImportPdf(): Buffer {
  const content = contentStream();
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${String(PAGE.width)} ${String(PAGE.height)}] ` +
      '/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    `<< /Length ${String(Buffer.byteLength(content, 'latin1'))} >>\nstream\n${content}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${String(index + 1)} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${String(objects.length + 1)}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${String(objects.length + 1)} /Root 1 0 R >>\nstartxref\n${String(xref)}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}
