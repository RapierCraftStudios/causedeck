// Sample order PDFs of the demo seed (#182): a dependency-free, deterministic one-page PDF 1.4 with
// a "DEMO DATA - FICTIONAL" heading, the fake case number and lorem-style text. The same input
// always gives the same bytes (no dates, ids or random object keys), so the document's sha256 is
// stable across seeds. Storing the encrypted object in the bucket is a follow-up: `@causedeck/db`
// cannot depend on `@causedeck/storage`.
import { createHash } from 'node:crypto';

export interface DemoPdfInput {
  /** The fake case number, e.g. `WP-DEMO/2026/0001`. */
  caseNumber: string;
  /** e.g. `Interim order dated 2026-10-14`. */
  title: string;
  /** Body paragraphs; printable ASCII only. */
  lines: readonly string[];
}

export interface DemoPdf {
  bytes: Uint8Array;
  sha256: string;
}

/** The visible watermark of every seeded document (#93): printed top and bottom of the page. */
export const DEMO_PDF_WATERMARK = 'SYNTHETIC';

export const DEMO_PDF_HEADING = 'SYNTHETIC - DEMO DATA - FICTIONAL';

const LOREM =
  'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.';

/** Escape a PDF literal string and drop anything outside printable ASCII. */
function pdfText(value: string): string {
  return value
    .replace(/[^\x20-\x7e]/g, '?')
    .replaceAll('\\', '\\\\')
    .replaceAll('(', '\\(')
    .replaceAll(')', '\\)');
}

export function demoOrderPdf(input: DemoPdfInput): DemoPdf {
  const body = [
    DEMO_PDF_HEADING,
    '',
    input.caseNumber,
    input.title,
    '',
    ...input.lines,
    '',
    LOREM,
    '',
    DEMO_PDF_WATERMARK,
  ];
  const ops = ['BT', '/F1 12 Tf', '16 TL', '72 770 Td'];
  for (const line of body) ops.push(`(${pdfText(line)}) Tj T*`);
  ops.push('ET');
  const stream = ops.join('\n');

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${String(Buffer.byteLength(stream, 'latin1'))} >>\nstream\n${stream}\nendstream`,
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((obj, i) => {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    out += `${String(i + 1)} 0 obj\n${obj}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${String(objects.length + 1)}\n0000000000 65535 f \n`;
  for (const offset of offsets) out += `${String(offset).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${String(objects.length + 1)} /Root 1 0 R >>\nstartxref\n${String(xref)}\n%%EOF\n`;

  const bytes = new Uint8Array(Buffer.from(out, 'latin1'));
  return { bytes, sha256: createHash('sha256').update(bytes).digest('hex') };
}
