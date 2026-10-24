// Synthetic roster PDFs for the roster-PDF preview tests (#385). Every court, judge and portfolio
// here is fictional; real rosters are validated later with the lawyer-supplied fixtures (#119). The
// PDFs are built with pdf-lib in standard Helvetica (WinAnsi, so ASCII apostrophes only), one table
// row per line with its cells at fixed column offsets, the way sitting arrangements are printed.
import { PDFDocument, StandardFonts } from 'pdf-lib';

/** One printed cell: its left edge in PDF points and its text. */
export interface RosterCell {
  x: number;
  text: string;
}

/** A page of lines, each a list of cells on one baseline. */
export type RosterPage = RosterCell[][];

export interface ExpectedCandidate {
  hallNo: string;
  judges: string[];
  portfolioText: string;
  pageNo: number;
}

const SIZE = 9;
const LINE_GAP = 18;

/** A PDF with the given pages (A4 portrait unless `size` is given), lines top to bottom. */
export async function rosterPdf(
  pages: RosterPage[],
  size: [number, number] = [595, 842],
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const lines of pages) {
    const page = doc.addPage(size);
    lines.forEach((cells, index) => {
      const y = size[1] - 50 - index * LINE_GAP;
      for (const cell of cells) page.drawText(cell.text, { x: cell.x, y, size: SIZE, font });
    });
  }
  return doc.save();
}

// Madras-style: "Sitting Arrangements wef", court halls by number, judges in capitals, a division
// bench's second judge on the next line, portfolios wrapping onto a second line.
const MADRAS_PAGES: RosterPage[] = [
  [
    [{ x: 40, text: 'HIGH COURT OF A FICTIONAL PROVINCE (SYNTHETIC ROSTER)' }],
    [{ x: 40, text: 'SITTING ARRANGEMENTS wef 05.10.2026' }],
    [
      { x: 40, text: 'COURT HALL' },
      { x: 150, text: "HON'BLE JUDGES" },
      { x: 400, text: 'PORTFOLIO' },
    ],
    [
      { x: 40, text: 'COURT HALL No. 1' },
      { x: 150, text: "HON'BLE MR.JUSTICE A. VENPA (fictional)" },
      { x: 400, text: 'Writ Petitions of 2024' },
    ],
    [{ x: 400, text: 'and earlier years' }],
    [
      { x: 40, text: 'COURT HALL No. 2' },
      { x: 150, text: "HON'BLE MR.JUSTICE K. MARUDHAM (fictional)" },
      { x: 400, text: 'Writ Appeals' },
    ],
    [{ x: 150, text: "HON'BLE MRS.JUSTICE T. NEITHAL (fictional)" }],
    [
      { x: 40, text: 'COURT HALL No. 12A' },
      { x: 150, text: "HON'BLE DR.JUSTICE R. KURINJI (fictional)" },
      { x: 400, text: 'Criminal Revisions' },
    ],
    [{ x: 40, text: 'BY ORDER OF THE HONOURABLE THE CHIEF JUSTICE' }],
  ],
];

export const MADRAS_EXPECTED: ExpectedCandidate[] = [
  {
    hallNo: '1',
    judges: ['Justice A. VENPA (fictional)'],
    portfolioText: 'Writ Petitions of 2024 and earlier years',
    pageNo: 1,
  },
  {
    hallNo: '2',
    judges: ['Justice K. MARUDHAM (fictional)', 'Justice T. NEITHAL (fictional)'],
    portfolioText: 'Writ Appeals',
    pageNo: 1,
  },
  {
    hallNo: '12A',
    judges: ['Justice R. KURINJI (fictional)'],
    portfolioText: 'Criminal Revisions',
    pageNo: 1,
  },
];

export const madrasRosterPdf = (): Promise<Uint8Array> => rosterPdf(MADRAS_PAGES);

// Karnataka-style: a landscape "sitting list ... with effect from", `CH-01` hall codes, a division
// bench's judges joined by `&` in one cell, and the list continuing onto a second page.
const LANDSCAPE: [number, number] = [842, 595];
const KARNATAKA_PAGES: RosterPage[] = [
  [
    [{ x: 30, text: 'HIGH COURT OF ANOTHER FICTIONAL PROVINCE (SYNTHETIC ROSTER)' }],
    [{ x: 30, text: "SITTING LIST OF HON'BLE JUDGES with effect from 12.10.2026" }],
    [
      { x: 30, text: 'CH-01' },
      {
        x: 90,
        text: "Hon'ble Mr. Justice S. Tungabhadra (fictional) & Hon'ble Mrs. Justice M. Sharavathi (fictional)",
      },
      { x: 600, text: 'Division Bench: Writ Appeals' },
    ],
    [
      { x: 30, text: 'CH-02' },
      { x: 90, text: "Hon'ble Ms. Justice P. Kabini (fictional)" },
      { x: 600, text: 'Single Bench: Bail Applications' },
    ],
    [
      { x: 30, text: 'CH-03' },
      { x: 90, text: "Hon'ble Dr. Justice H. Nethravathi (fictional)" },
      { x: 600, text: 'Company Petitions' },
    ],
  ],
  [
    [
      { x: 30, text: 'CH-04' },
      { x: 90, text: "Hon'ble Mr. Justice V. Hemavathi (fictional)" },
      { x: 600, text: 'Writ Petitions (Service)' },
    ],
    [{ x: 30, text: 'Registrar General (fictional)' }],
  ],
];

export const KARNATAKA_EXPECTED: ExpectedCandidate[] = [
  {
    hallNo: '1',
    judges: ['Justice S. Tungabhadra (fictional)', 'Justice M. Sharavathi (fictional)'],
    portfolioText: 'Division Bench: Writ Appeals',
    pageNo: 1,
  },
  {
    hallNo: '2',
    judges: ['Justice P. Kabini (fictional)'],
    portfolioText: 'Single Bench: Bail Applications',
    pageNo: 1,
  },
  {
    hallNo: '3',
    judges: ['Justice H. Nethravathi (fictional)'],
    portfolioText: 'Company Petitions',
    pageNo: 1,
  },
  {
    hallNo: '4',
    judges: ['Justice V. Hemavathi (fictional)'],
    portfolioText: 'Writ Petitions (Service)',
    pageNo: 2,
  },
];

export const karnatakaRosterPdf = (): Promise<Uint8Array> => rosterPdf(KARNATAKA_PAGES, LANDSCAPE);
