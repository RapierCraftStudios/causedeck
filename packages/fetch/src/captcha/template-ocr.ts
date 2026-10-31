// The in-house OCR engine behind the `OcrEngine` port (#1078, part of #492): no native dependency
// and no model. A captcha PNG is binarised (Otsu), cut into glyphs at empty columns, each glyph is
// reduced to a fixed grid of ink fractions and matched to the nearest template. Templates come from
// `trainGlyphTemplates` over a labelled set, so the engine is only as good as the set: it reads
// clean, separated, fixed-font captchas, and returns `null` (never a guess) for touching glyphs,
// a wrong glyph count, a non-PNG or a low-confidence match, which the solver chain then sends to
// the paid tier. First-try accuracy on the real labelled set is measured by `measureAccuracy`
// and stays a human deliverable (#492).
import { decodePng, type GrayImage } from './png.ts';
import type { OcrEngine } from './solver.ts';

export const GLYPH_COLS = 8;
export const GLYPH_ROWS = 12;

/** Serializable templates: each character with one or more feature vectors. */
export interface GlyphTemplates {
  cols: number;
  rows: number;
  glyphs: Record<string, number[][]>;
}

export interface SegmentationOptions {
  /** Columns with at most this many ink pixels count as empty. Default 0. */
  gapInk?: number;
  /** A glyph narrower than this many columns, or with fewer ink pixels than `minInkPixels`, is noise. */
  minWidth?: number;
  minInkPixels?: number;
}

function otsu(gray: Uint8Array): number {
  const hist = new Array<number>(256).fill(0);
  for (const v of gray) hist[v] = (hist[v] ?? 0) + 1;
  const total = gray.length;
  let sum = 0;
  for (let i = 0; i < 256; i += 1) sum += i * (hist[i] ?? 0);
  let sumB = 0;
  let weightB = 0;
  let best = 0;
  let threshold = 127;
  for (let t = 0; t < 256; t += 1) {
    weightB += hist[t] ?? 0;
    if (weightB === 0) continue;
    const weightF = total - weightB;
    if (weightF === 0) break;
    sumB += t * (hist[t] ?? 0);
    const between = weightB * weightF * (sumB / weightB - (sum - sumB) / weightF) ** 2;
    if (between > best) {
      best = between;
      threshold = t;
    }
  }
  return threshold;
}

/** Ink mask (1 = ink); the minority tone is ink, so light-on-dark images read the same. */
export function binarise(image: GrayImage): Uint8Array {
  const threshold = otsu(image.gray);
  const mask = new Uint8Array(image.gray.length);
  let ink = 0;
  for (let i = 0; i < mask.length; i += 1) {
    const dark = (image.gray[i] ?? 255) <= threshold ? 1 : 0;
    mask[i] = dark;
    ink += dark;
  }
  if (ink * 2 > mask.length)
    for (let i = 0; i < mask.length; i += 1) mask[i] = mask[i] === 1 ? 0 : 1;
  return mask;
}

interface Box {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

export function segmentGlyphs(
  image: GrayImage,
  mask: Uint8Array,
  options: SegmentationOptions = {},
): Box[] {
  const { width, height } = image;
  const gapInk = options.gapInk ?? 0;
  const minWidth = options.minWidth ?? 2;
  const minInk = options.minInkPixels ?? 6;
  const columnInk = new Array<number>(width).fill(0);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1)
      columnInk[x] = (columnInk[x] ?? 0) + (mask[y * width + x] ?? 0);
  }
  const boxes: Box[] = [];
  let start = -1;
  const close = (end: number): void => {
    if (start < 0) return;
    const x0 = start;
    start = -1;
    let y0 = height;
    let y1 = -1;
    let ink = 0;
    for (let y = 0; y < height; y += 1) {
      for (let x = x0; x <= end; x += 1) {
        if (mask[y * width + x] === 1) {
          ink += 1;
          y0 = Math.min(y0, y);
          y1 = Math.max(y1, y);
        }
      }
    }
    if (end - x0 + 1 >= minWidth && ink >= minInk && y1 >= y0) boxes.push({ x0, x1: end, y0, y1 });
  };
  for (let x = 0; x < width; x += 1) {
    if ((columnInk[x] ?? 0) > gapInk) {
      if (start < 0) start = x;
    } else close(x - 1);
  }
  close(width - 1);
  return boxes;
}

/** The glyph in `box` as GLYPH_ROWS x GLYPH_COLS ink fractions. */
export function glyphFeatures(image: GrayImage, mask: Uint8Array, box: Box): number[] {
  const w = box.x1 - box.x0 + 1;
  const h = box.y1 - box.y0 + 1;
  const out: number[] = [];
  for (let r = 0; r < GLYPH_ROWS; r += 1) {
    const ya = box.y0 + Math.floor((r * h) / GLYPH_ROWS);
    const yb =
      box.y0 +
      Math.max(Math.floor(((r + 1) * h) / GLYPH_ROWS), Math.floor((r * h) / GLYPH_ROWS) + 1);
    for (let c = 0; c < GLYPH_COLS; c += 1) {
      const xa = box.x0 + Math.floor((c * w) / GLYPH_COLS);
      const xb =
        box.x0 +
        Math.max(Math.floor(((c + 1) * w) / GLYPH_COLS), Math.floor((c * w) / GLYPH_COLS) + 1);
      let ink = 0;
      let n = 0;
      for (let y = ya; y < Math.min(yb, box.y1 + 1); y += 1) {
        for (let x = xa; x < Math.min(xb, box.x1 + 1); x += 1) {
          ink += mask[y * image.width + x] ?? 0;
          n += 1;
        }
      }
      out.push(n === 0 ? 0 : ink / n);
    }
  }
  return out;
}

function glyphsOf(bytes: Uint8Array, options: SegmentationOptions): number[][] | null {
  const image = decodePng(bytes);
  if (image === null) return null;
  const mask = binarise(image);
  return segmentGlyphs(image, mask, options).map((box) => glyphFeatures(image, mask, box));
}

/**
 * Build templates from labelled PNG samples. A sample whose glyph count differs from its label's
 * length (touching or broken glyphs) is skipped and reported, never forced.
 */
export function trainGlyphTemplates(
  samples: readonly { image: Uint8Array; label: string }[],
  options: SegmentationOptions = {},
): { templates: GlyphTemplates; used: number; skipped: number } {
  const glyphs: Record<string, number[][]> = {};
  let used = 0;
  let skipped = 0;
  for (const sample of samples) {
    const label = sample.label.trim();
    const features = glyphsOf(sample.image, options);
    if (features === null || features.length !== label.length) {
      skipped += 1;
      continue;
    }
    used += 1;
    Array.from(label).forEach((char, i) => {
      const vector = features[i];
      if (vector !== undefined) (glyphs[char] ??= []).push(vector);
    });
  }
  return { templates: { cols: GLYPH_COLS, rows: GLYPH_ROWS, glyphs }, used, skipped };
}

export interface TemplateOcrOptions extends SegmentationOptions {
  /** Accepted glyph counts; anything else is unreadable. Default 4 to 8 (eCourts). */
  minLength?: number;
  maxLength?: number;
}

const distance = (a: readonly number[], b: readonly number[]): number => {
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum += Math.abs((a[i] ?? 0) - (b[i] ?? 0));
  return sum / a.length;
};

/** The OCR engine over trained templates. Confidence is one minus the mean glyph distance. */
export function createTemplateOcrEngine(
  templates: GlyphTemplates,
  options: TemplateOcrOptions = {},
): OcrEngine {
  const min = options.minLength ?? 4;
  const max = options.maxLength ?? 8;
  const entries = Object.entries(templates.glyphs);
  return {
    recognize(image) {
      if (entries.length === 0 || templates.cols !== GLYPH_COLS || templates.rows !== GLYPH_ROWS) {
        return Promise.resolve(null);
      }
      const features = glyphsOf(image, options);
      if (features === null || features.length < min || features.length > max) {
        return Promise.resolve(null);
      }
      let text = '';
      let total = 0;
      for (const vector of features) {
        let bestChar = '';
        let best = Infinity;
        for (const [char, vectors] of entries) {
          for (const template of vectors) {
            const d = distance(vector, template);
            if (d < best) {
              best = d;
              bestChar = char;
            }
          }
        }
        text += bestChar;
        total += best;
      }
      // A distance of 0.5 (half the grid wrong) is no match at all.
      const confidence = Math.max(0, 1 - total / features.length / 0.5);
      return Promise.resolve({ text, confidence });
    },
  };
}
