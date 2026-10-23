// OCR line boxes (#52): the `[{text, bbox, conf}]` a page keeps in `document_page.ocr_lines`.
// A box is `[x0, y0, x1, y1]` normalised 0..1 over the page image, so it survives any rescale.
import type { AnchorBbox, OcrLine } from '@causedeck/db/schema';

export type { OcrLine };

export type LineBox = OcrLine['bbox'];

/** True for a box with four finite numbers in 0..1 and a positive area. */
export function isValidBox(box: readonly number[]): box is LineBox {
  const [x0 = 0, y0 = 0, x1 = 0, y1 = 0] = box;
  return (
    box.length === 4 &&
    box.every((v) => Number.isFinite(v) && v >= 0 && v <= 1) &&
    x1 > x0 &&
    y1 > y0
  );
}

/** The lines a provider reported that carry text and a valid box, in reading order (top, then left). */
export function normaliseLines(lines: readonly OcrLine[] | undefined): OcrLine[] {
  if (lines === undefined) return [];
  return lines
    .filter((line) => line.text.trim() !== '' && isValidBox(line.bbox))
    .map((line) => ({
      text: line.text.trim(),
      bbox: line.bbox,
      conf: Math.min(1, Math.max(0, line.conf)),
    }))
    .sort((a, b) => a.bbox[1] - b.bbox[1] || a.bbox[0] - b.bbox[0]);
}

/** The stored `anchor.bbox` shape (normalised) for a line box. */
export function toAnchorBbox(box: LineBox): AnchorBbox {
  return { x: box[0], y: box[1], width: box[2] - box[0], height: box[3] - box[1] };
}

/** Mean confidence of the lines, or null with none. */
export function meanConfidence(lines: readonly OcrLine[]): number | null {
  if (lines.length === 0) return null;
  return lines.reduce((sum, line) => sum + line.conf, 0) / lines.length;
}
