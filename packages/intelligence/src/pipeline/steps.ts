// The pipeline's pure steps: format sniffing, page assembly, text status, outcome and simhash.
// Nothing here touches the network, the database or storage.
import type { DocumentTextStatus } from '@causedeck/db/schema';
import type { CaptureNeedsYouReason } from '@causedeck/validators';

import { detectLanguage } from '../language/detect.ts';
import { coverage, isGarbled, normaliseText } from '../text/quality.ts';
import type { OcrLine } from '../ocr/line-boxes.ts';
import type { OcrLanguage, OcrPageResult } from '../ocr/ocr.ts';

export type InputFormat = 'pdf' | 'docx' | 'text' | 'image' | 'unsupported';

const startsWith = (bytes: Uint8Array, magic: readonly number[]): boolean =>
  magic.every((byte, i) => bytes[i] === byte);

/** The real format by magic bytes (the declared MIME is only a tiebreaker for text and DOCX). */
export function sniffFormat(bytes: Uint8Array, mime: string): InputFormat {
  const head = bytes.subarray(0, 1024);
  if (head.length === 0) return 'unsupported';
  if (startsWith(head, [0x25, 0x50, 0x44, 0x46])) return 'pdf';
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47]) || startsWith(head, [0xff, 0xd8, 0xff])) {
    return 'image';
  }
  if (startsWith(head, [0x52, 0x49, 0x46, 0x46]) && startsWith(head.subarray(8), [0x57, 0x45])) {
    return 'image';
  }
  if (startsWith(head, [0x50, 0x4b, 0x03, 0x04])) {
    return mime.includes('wordprocessingml') ? 'docx' : 'unsupported';
  }
  if (mime.startsWith('text/')) return 'text';
  return 'unsupported';
}

/** The MIME the renderer is opened with, from the sniffed bytes. */
export function renderMime(bytes: Uint8Array, format: InputFormat): string {
  if (format === 'pdf') return 'application/pdf';
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47])) return 'image/png';
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  return 'image/webp';
}

export interface PageDraft {
  pageNo: number;
  text: string;
  textSource: 'layer' | 'ocr' | null;
  ocrConfidence: number | null;
  lang: string | null;
  /** OCR line boxes of an OCR-read page, when the provider reported them (#52). */
  ocrLines?: OcrLine[] | undefined;
}

/** Page numbers whose text layer is empty, thin or garbled. */
export function weakPages(
  layer: readonly { pageNo: number; text: string }[],
  options: { minPageChars: number; languageHint?: OcrLanguage | null | undefined },
): number[] {
  return layer
    .filter(
      ({ text }) =>
        coverage(text) < options.minPageChars ||
        isGarbled(text, { languageHint: options.languageHint }),
    )
    .map((page) => page.pageNo);
}

/**
 * Pages from the text layer and OCR results. A weak page keeps its layer text only when it is
 * usable (thin but sound); a garbled layer is dropped, never guessed at.
 */
export function assemblePages(
  layer: readonly { pageNo: number; text: string }[],
  ocr: ReadonlyMap<number, OcrPageResult>,
  options: { languageHint?: OcrLanguage | null | undefined },
): PageDraft[] {
  return layer.map(({ pageNo, text }) => {
    const read = ocr.get(pageNo);
    if (read !== undefined) {
      const clean = normaliseText(read.text);
      return {
        pageNo,
        text: clean,
        textSource: 'ocr',
        ocrConfidence: read.confidence,
        lang: detectLanguage(clean),
        ...(read.lines === undefined || read.lines.length === 0 ? {} : { ocrLines: read.lines }),
      };
    }
    const clean = normaliseText(text);
    const keep = clean !== '' && !isGarbled(text, { languageHint: options.languageHint });
    return {
      pageNo,
      text: keep ? clean : '',
      textSource: keep ? 'layer' : null,
      ocrConfidence: null,
      lang: keep ? detectLanguage(clean) : null,
    };
  });
}

export type SkipReason = 'ai_blocked' | 'sensitive_matter';

export interface TextStatusInput {
  pages: readonly PageDraft[];
  /** Pages that needed OCR. */
  weak: readonly number[];
  ocrRan: boolean;
  skipReason: SkipReason | null;
}

/** `layer`, `ocr`, `skipped` (OCR was needed and not allowed) or `failed` (OCR found nothing). */
export function textStatusOf({
  pages,
  weak,
  ocrRan,
  skipReason,
}: TextStatusInput): DocumentTextStatus {
  const hasText = pages.some((page) => page.text !== '');
  if (weak.length === 0) return hasText ? 'layer' : 'failed';
  if (skipReason !== null) return 'skipped';
  if (!ocrRan) return 'failed';
  return hasText ? 'ocr' : 'failed';
}

/** OCR pages under the floor, or read as empty. */
export function lowConfidencePages(pages: readonly PageDraft[], floor: number): number[] {
  return pages
    .filter(
      (page) =>
        page.textSource === 'ocr' && ((page.ocrConfidence ?? 0) < floor || page.text === ''),
    )
    .map((page) => page.pageNo);
}

/** The capture needs the lawyer when there is no usable text or OCR was unsure. */
export function needsYouReason(input: {
  pages: readonly PageDraft[];
  lowConfidence: readonly number[];
}): CaptureNeedsYouReason | null {
  if (input.lowConfidence.length > 0) return 'unreadable';
  return input.pages.some((page) => page.text !== '') ? null : 'unreadable';
}

const MASK_64 = 0xffffffffffffffffn;
const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;

function fnv64(value: string): bigint {
  let hash = FNV_OFFSET;
  for (const byte of new TextEncoder().encode(value)) {
    hash ^= BigInt(byte);
    hash = (hash * FNV_PRIME) & MASK_64;
  }
  return hash;
}

/** 64-bit simhash of word trigrams, as 16 hex characters; `null` for text with no words. */
export function simhash(text: string): string | null {
  const words = (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).slice(0, 20000);
  if (words.length === 0) return null;
  const shingles: string[] = [];
  if (words.length < 3) shingles.push(words.join(' '));
  for (let i = 0; i + 3 <= words.length; i += 1) shingles.push(words.slice(i, i + 3).join(' '));
  const votes = new Array<number>(64).fill(0);
  for (const shingle of shingles) {
    const hash = fnv64(shingle);
    for (let bit = 0; bit < 64; bit += 1) {
      votes[bit] = (votes[bit] ?? 0) + ((hash >> BigInt(bit)) & 1n ? 1 : -1);
    }
  }
  let result = 0n;
  for (let bit = 0; bit < 64; bit += 1) if ((votes[bit] ?? 0) > 0) result |= 1n << BigInt(bit);
  return result.toString(16).padStart(16, '0');
}

export function hammingDistance(a: string, b: string): number {
  let diff = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let count = 0;
  while (diff > 0n) {
    count += Number(diff & 1n);
    diff >>= 1n;
  }
  return count;
}
