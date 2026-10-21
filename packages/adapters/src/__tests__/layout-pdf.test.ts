// The PDF layout reader (#370): per-page lines and words with top-left bboxes from the text layer
// of pdf-lib PDFs, `textCoverage` per page (0 for an image-only page, so #45 OCRs it), and a PDF
// carrying an `app.alert` JavaScript payload that parses without the payload running.
import { PDFDict, PDFDocument, PDFName, PDFString, StandardFonts } from 'pdf-lib';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ECHO_FORUM_CODE,
  createEchoAdapter,
  layoutFromPdf,
  LayoutDocumentSchema,
} from '../index.ts';

const A4: [number, number] = [595, 842];
const SIZE = 12;
/** A 1x1 PNG, so a page can hold an image and no text, as a scan does. */
const PNG = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  ),
  (char) => char.charCodeAt(0),
);

const HALL = { text: 'COURT HALL 1', x: 50, y: 780 };
const STAGE = { text: 'FOR ADMISSION', x: 50, y: 760 };
const ROW = {
  text: '1. W.P. No. 12345 of 2026 Arun Kavitham vs Fictional District Collector',
  x: 50,
  y: 740,
};
const LINES = [HALL, STAGE, ROW];

async function pdfWith(build: (doc: PDFDocument) => Promise<void> | void): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  await build(doc);
  return doc.save();
}

async function textPage(doc: PDFDocument, lines: typeof LINES): Promise<void> {
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage(A4);
  for (const line of lines) page.drawText(line.text, { x: line.x, y: line.y, size: SIZE, font });
}

async function imagePage(doc: PDFDocument): Promise<void> {
  const image = await doc.embedPng(PNG);
  doc.addPage(A4).drawImage(image, { x: 0, y: 0, width: A4[0], height: A4[1] });
}

describe('layoutFromPdf', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns lines and words with top-left bboxes and textCoverage for a text-layer PDF', async () => {
    const layout = await layoutFromPdf(await pdfWith((doc) => textPage(doc, LINES)));
    expect(LayoutDocumentSchema.parse(layout)).toEqual(layout);
    expect(layout.pages).toHaveLength(1);
    const [page] = layout.pages;
    expect(page).toMatchObject({ page: 1, width: 595, height: 842 });
    expect(page?.text.split('\n')).toEqual(LINES.map((line) => line.text));
    expect(page?.items.map((item) => item.text)).toEqual(LINES.map((line) => line.text));
    for (const [index, line] of LINES.entries()) {
      const bbox = page?.items[index]?.bbox;
      expect(bbox?.x).toBeCloseTo(line.x, 0);
      // pdf-lib draws at the baseline from the bottom; the bbox top is a glyph height above it.
      expect(Math.abs((bbox?.y ?? 0) - (842 - line.y - SIZE))).toBeLessThan(2);
      expect(bbox?.height).toBeCloseTo(SIZE, 0);
      expect(bbox?.width).toBeGreaterThan(0);
    }
    expect(page?.words?.map((word) => word.text)).toEqual(
      LINES.flatMap((line) => line.text.split(/\s+/)),
    );
    const lastLine = page?.items[2]?.bbox;
    for (const word of page?.words?.slice(-9) ?? []) {
      expect(word.bbox.x).toBeGreaterThanOrEqual((lastLine?.x ?? 0) - 0.01);
      expect(word.bbox.x + word.bbox.width).toBeLessThanOrEqual(
        (lastLine?.x ?? 0) + (lastLine?.width ?? 0) + 0.01,
      );
      expect(word.bbox.y).toBeCloseTo(lastLine?.y ?? 0, 1);
    }
    expect(page?.textCoverage).toBeGreaterThan(0);
    expect(page?.textCoverage).toBeLessThanOrEqual(1);
  });

  it('reads each page of a multi-page PDF with its own text and coverage', async () => {
    const layout = await layoutFromPdf(
      await pdfWith(async (doc) => {
        await textPage(doc, [HALL]);
        await textPage(doc, [STAGE, ROW]);
      }),
    );
    expect(layout.pages.map((page) => [page.page, page.text])).toEqual([
      [1, HALL.text],
      [2, `${STAGE.text}\n${ROW.text}`],
    ]);
    const [first, second] = layout.pages.map((page) => page.textCoverage ?? 0);
    expect(first).toBeGreaterThan(0);
    expect(second).toBeGreaterThan(first ?? 0);
  });

  it('reports textCoverage 0 for an image-only PDF, so the caller falls back to OCR', async () => {
    const layout = await layoutFromPdf(await pdfWith(imagePage));
    expect(layout.pages).toEqual([
      { page: 1, width: 595, height: 842, text: '', items: [], words: [], textCoverage: 0 },
    ]);
  });

  it('reports coverage per page in a mixed PDF', async () => {
    const layout = await layoutFromPdf(
      await pdfWith(async (doc) => {
        await textPage(doc, LINES);
        await imagePage(doc);
      }),
    );
    expect(layout.pages[0]?.textCoverage).toBeGreaterThan(0);
    expect(layout.pages[1]?.textCoverage).toBe(0);
  });

  it('parses a PDF with embedded JavaScript without executing it', async () => {
    const alert = vi.fn();
    vi.stubGlobal('app', { alert });
    vi.stubGlobal('alert', alert);
    const bytes = await pdfWith(async (doc) => {
      await textPage(doc, LINES);
      doc.addJavaScript('payload', 'app.alert("pwned"); alert("pwned");');
      doc.catalog.set(
        PDFName.of('OpenAction'),
        doc.context.obj({ Type: 'Action', S: 'JavaScript', JS: PDFString.of('app.alert("open")') }),
      );
    });
    // The payload is in the file: a document-level script and an open action.
    const saved = await PDFDocument.load(bytes);
    expect(saved.catalog.lookup(PDFName.of('Names'), PDFDict).has(PDFName.of('JavaScript'))).toBe(
      true,
    );
    const openAction = saved.catalog.lookup(PDFName.of('OpenAction'), PDFDict);
    expect(openAction.lookup(PDFName.of('JS'), PDFString).decodeText()).toBe('app.alert("open")');

    const layout = await layoutFromPdf(bytes);
    expect(layout.pages[0]?.text.split('\n')).toEqual(LINES.map((line) => line.text));
    expect(alert).not.toHaveBeenCalled();
  });

  it('is deterministic and leaves the caller buffer usable', async () => {
    const bytes = await pdfWith((doc) => textPage(doc, LINES));
    const length = bytes.byteLength;
    const first = await layoutFromPdf(bytes);
    expect(bytes.byteLength).toBe(length);
    expect(JSON.stringify(await layoutFromPdf(bytes))).toBe(JSON.stringify(first));
  });

  it('feeds the adapter contract: echo rows anchor to the PDF line bboxes', async () => {
    const layout = await layoutFromPdf(await pdfWith((doc) => textPage(doc, LINES)));
    const parsed = await createEchoAdapter().parseCauseList({
      kind: 'layout',
      layout,
      meta: { receivedAt: '2026-10-21T04:00:00.000Z', forumCode: ECHO_FORUM_CODE },
    });
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]?.anchor).toEqual({
      page: 1,
      quote: ROW.text,
      rowIndex: 0,
      bbox: layout.pages[0]?.items[2]?.bbox,
    });
  });
});
