// Seeded synthetic fixtures for the golden harness (#371, ADR 0015). Generators are pure functions
// of their seed (`mulberry32`), so a fixture regenerates byte for byte. Every party is fictional
// and every generated fixture is flagged `FICTIONAL` with `origin: synthetic`; real-fixture
// validation is #119. Test tooling only: not exported from the package entry.
import { PDFDocument, StandardFonts } from 'pdf-lib';

/** Deterministic PRNG: the same seed always yields the same sequence in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The manifest flags of a generated fixture. */
export interface SyntheticManifestEntry {
  origin: 'synthetic';
  classification: 'FICTIONAL';
}

export interface SyntheticEchoListOptions {
  pages: number;
  rowsPerPage: number;
  seed: number;
}

const CASE_TYPES = ['W.P.', 'W.P.(MD)', 'Crl.O.P.', 'CRL OP', 'Arb.O.P.', 'W.A.', 'C.M.A.'];
const STAGES = ['FOR ADMISSION', 'FOR ORDERS', 'FOR FINAL HEARING'];
/** Made-up names only, each marked as such, so no row can be mistaken for a real litigant. */
const PETITIONERS = ['Fictional Party', 'Imaginary Trader', 'Pretend Society', 'Made-up Farmer'];
const RESPONDENTS = ['Pretend Respondent', 'Fictional Collector', 'Imaginary Panchayat'];

const pick = <T>(random: () => number, values: readonly T[]): T =>
  values[Math.floor(random() * values.length)] as T;

/** A multi-page echo-format cause list (one page per form feed), reproducible from `seed`. */
export function syntheticEchoList({ pages, rowsPerPage, seed }: SyntheticEchoListOptions): {
  text: string;
  manifestEntry: SyntheticManifestEntry;
} {
  const random = mulberry32(seed);
  const out: string[] = [];
  let item = 0;
  for (let page = 0; page < pages; page += 1) {
    const lines = page === 0 ? ['ECHO TEST COURT (FICTIONAL)', 'CAUSE LIST FOR 21.10.2026'] : [];
    lines.push(`COURT HALL ${String(page + 1)}`, STAGES[page % STAGES.length] ?? 'FOR ORDERS');
    for (let row = 0; row < rowsPerPage; row += 1) {
      item += 1;
      const type = pick(random, CASE_TYPES);
      const number = String(Math.floor(random() * 99_999) + 1);
      const petitioner = pick(random, PETITIONERS);
      const respondent = pick(random, RESPONDENTS);
      lines.push(
        `${String(item)}. ${type} No. ${number} of 2026  ${petitioner} ${String(item)} vs ${respondent}`,
      );
    }
    out.push(lines.join('\n'));
  }
  return {
    text: out.join('\f'),
    manifestEntry: { origin: 'synthetic', classification: 'FICTIONAL' },
  };
}

const A4: [number, number] = [595, 842];
const FONT_SIZE = 10;
const LINE_HEIGHT = 14;
const MARGIN = 40;
/** Fixed document dates, so the same pages always produce the same bytes. */
const FIXED_DATE = new Date('2026-01-01T00:00:00.000Z');

/** A text-layer PDF with one A4 page per entry of `pages`, one `drawText` per line. */
export async function writeSyntheticPdf(
  pages: readonly (readonly string[])[],
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setCreationDate(FIXED_DATE);
  doc.setModificationDate(FIXED_DATE);
  doc.setProducer('causedeck synthetic fixtures (FICTIONAL)');
  doc.setCreator('causedeck synthetic fixtures (FICTIONAL)');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const lines of pages) {
    const page = doc.addPage(A4);
    lines.forEach((line, index) => {
      page.drawText(line, {
        x: MARGIN,
        y: A4[1] - MARGIN - index * LINE_HEIGHT,
        size: FONT_SIZE,
        font,
      });
    });
  }
  return doc.save({ useObjectStreams: false });
}
