// OCR line boxes -> numbered lines and anchors (#52). The model cites a line by number; the anchor
// is the line's own box and text, so an anchor can only point at something the OCR read.
import { toAnchorBbox, type OcrLine } from '../ocr/line-boxes.ts';
import type { DiaryAnchor } from './schema.ts';

export interface DiaryPage {
  page: number;
  text: string;
  /** Mean OCR confidence of the page, when known. */
  confidence: number | null;
  lines: readonly OcrLine[];
}

export interface NumberedLine {
  /** 1-based over the whole batch, in page then reading order. */
  n: number;
  page: number;
  text: string;
  bbox: OcrLine['bbox'];
  conf: number;
}

export function numberLines(pages: readonly DiaryPage[]): NumberedLine[] {
  const lines: NumberedLine[] = [];
  for (const page of [...pages].sort((a, b) => a.page - b.page)) {
    for (const line of page.lines) {
      lines.push({
        n: lines.length + 1,
        page: page.page,
        text: line.text,
        bbox: line.bbox,
        conf: line.conf,
      });
    }
  }
  return lines;
}

export function anchorOf(line: NumberedLine): DiaryAnchor {
  return { page: line.page, bbox: line.bbox, quote: line.text };
}

/** A stable key of an anchor, for de-duplication and the stored `anchor.id` lookup. */
export function anchorKey(anchor: Pick<DiaryAnchor, 'page' | 'bbox'>): string {
  return `${String(anchor.page)}:${anchor.bbox.join(',')}`;
}

/** The `anchor` row fields (`image_region`) of a diary anchor. */
export function anchorRow(anchor: DiaryAnchor): {
  pageNo: number;
  quote: string;
  bbox: ReturnType<typeof toAnchorBbox>;
  kind: 'image_region';
} {
  return {
    pageNo: anchor.page,
    quote: anchor.quote,
    bbox: toAnchorBbox(anchor.bbox),
    kind: 'image_region',
  };
}
