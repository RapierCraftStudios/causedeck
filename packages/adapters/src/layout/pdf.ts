// PDF layout reader (#370, ADR 0015): the text layer of a PDF the lawyer supplied, as a
// `LayoutDocument`. pdfjs reads the bytes as data only: no URL, no rendering, no annotation layer,
// no scripting sandbox, so JavaScript in the document never runs (spike §6). A page without a text
// layer (a scan) reports `textCoverage` 0 and the caller falls back to OCR (#45).
import type { BBox, LayoutDocument } from '../types.ts';

type Matrix = number[];

interface Run {
  /** The run as pdfjs reports it, surrounding spaces included (word offsets count them). */
  text: string;
  x: number;
  /** Baseline, top-left origin. */
  baseline: number;
  width: number;
  height: number;
}

type LayoutPage = LayoutDocument['pages'][number];

const round = (value: number) => Math.round(value * 100) / 100;

/** Multiplies two PDF transform matrices (`[a, b, c, d, e, f]`), as pdfjs's `Util.transform`. */
function multiply(m1: Matrix, m2: Matrix): Matrix {
  const [a1 = 1, b1 = 0, c1 = 0, d1 = 1, e1 = 0, f1 = 0] = m1;
  const [a2 = 1, b2 = 0, c2 = 0, d2 = 1, e2 = 0, f2 = 0] = m2;
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ];
}

function union(boxes: BBox[]): BBox {
  const left = Math.min(...boxes.map((b) => b.x));
  const top = Math.min(...boxes.map((b) => b.y));
  const right = Math.max(...boxes.map((b) => b.x + b.width));
  const bottom = Math.max(...boxes.map((b) => b.y + b.height));
  return { x: round(left), y: round(top), width: round(right - left), height: round(bottom - top) };
}

const runBox = (run: Run): BBox => ({
  x: round(run.x),
  y: round(run.baseline - run.height),
  width: round(run.width),
  height: round(run.height),
});

/** Runs sharing a baseline (within half a glyph height) form a line, read left to right. */
function groupLines(runs: Run[]): Run[][] {
  const sorted = [...runs].sort((a, b) => a.baseline - b.baseline || a.x - b.x);
  const lines: { baseline: number; runs: Run[] }[] = [];
  for (const run of sorted) {
    const last = lines.at(-1);
    const tolerance = Math.max(1, run.height / 2);
    if (last !== undefined && Math.abs(run.baseline - last.baseline) <= tolerance) {
      last.runs.push(run);
    } else {
      lines.push({ baseline: run.baseline, runs: [run] });
    }
  }
  return lines.map((line) => line.runs.sort((a, b) => a.x - b.x));
}

/** Runs that touch are one word split by the PDF; a visible gap is a space. */
function lineText(runs: Run[]): string {
  let text = '';
  let right = Number.NEGATIVE_INFINITY;
  for (const run of runs) {
    if (text !== '' && run.x - right > run.height * 0.1) text += ' ';
    text += run.text.trim();
    right = run.x + run.width;
  }
  return text;
}

/** Each whitespace-split word of a run, its x and width proportional to its character offset. */
function wordsOf(run: Run): LayoutPage['items'] {
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
}

function pageLayout(page: number, width: number, height: number, runs: Run[]): LayoutPage {
  const grouped = groupLines(runs);
  const lines = grouped.map((line) => ({ text: lineText(line), bbox: union(line.map(runBox)) }));
  const words = grouped.flatMap((line) => line.flatMap(wordsOf));
  const area = width * height;
  const covered = lines.reduce((sum, line) => sum + line.bbox.width * line.bbox.height, 0);
  // A page with any text keeps a non-zero coverage, so only a page without a text layer reads 0.
  const textCoverage =
    lines.length === 0 || area === 0
      ? 0
      : Math.max(0.0001, Math.min(1, Math.round((covered / area) * 10_000) / 10_000));
  return {
    page,
    width: round(width),
    height: round(height),
    text: lines.map((line) => line.text).join('\n'),
    items: lines,
    words,
    textCoverage,
  };
}

/**
 * Reads the text layer of a PDF into a `LayoutDocument`: per page, its lines and words with
 * top-left-origin bboxes in PDF points, the reading-order text and `textCoverage`. `data` is
 * copied, so the caller's buffer stays usable.
 */
export async function layoutFromPdf(data: Uint8Array): Promise<LayoutDocument> {
  // Loaded on first use, so importing the package (apps/web does) never pulls pdfjs in.
  const { getDocument, VerbosityLevel } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = getDocument({
    data: data.slice(),
    enableXfa: false,
    disableFontFace: true,
    useSystemFonts: false,
    useWorkerFetch: false,
    stopAtErrors: false,
    verbosity: VerbosityLevel.ERRORS,
  });
  try {
    const doc = await task.promise;
    const pages: LayoutPage[] = [];
    for (let number = 1; number <= doc.numPages; number += 1) {
      const page = await doc.getPage(number);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const runs: Run[] = [];
      for (const item of content.items) {
        if (!('str' in item) || item.str.trim() === '') continue;
        const [, , c = 0, d = 0, x = 0, baseline = 0] = multiply(
          viewport.transform,
          item.transform as Matrix,
        );
        runs.push({
          text: item.str,
          x,
          baseline,
          width: item.width * viewport.scale,
          height: Math.hypot(c, d),
        });
      }
      pages.push(pageLayout(number, viewport.width, viewport.height, runs));
      page.cleanup();
    }
    return { pages };
  } finally {
    await task.destroy();
  }
}
