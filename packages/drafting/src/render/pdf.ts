import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

// @pdf-lib/fontkit shapes Indic syllables with a Babel-transpiled generator that needs a global
// regeneratorRuntime; load it first (same as packages/intelligence/src/synthetic/make-docs.ts).
import 'regenerator-runtime/runtime.js';
import fontkit from '@pdf-lib/fontkit';
import type { Block } from '@causedeck/validators/drafting';
import { PDFDocument, type PDFFont } from 'pdf-lib';

import { collectNarratives } from '../blocks';
import { resolveSlot, type Facts } from '../slots';
import type { CourtFormatPreset } from '../presets/index';
import { assertExportable, type RenderOptions } from './common';

const require = createRequire(import.meta.url);
const fontFile = (script: string, subset: string): string =>
  require.resolve(
    `@fontsource/noto-sans-${script}/files/noto-sans-${script}-${subset}-400-normal.woff`,
  );

const PT_PER_MM = 72 / 25.4;
const PAGE_MM = {
  A4: { width: 210, height: 297 },
  Legal: { width: 215.9, height: 355.6 },
  Letter: { width: 215.9, height: 279.4 },
} as const;

export class PdfTooLargeError extends Error {
  constructor(
    readonly bytes: number,
    readonly maxBytes: number,
  ) {
    super(`PDF is ${String(bytes)} bytes; the limit is ${String(maxBytes)}`);
    this.name = 'PdfTooLargeError';
  }
}

export interface PdfOptions extends RenderOptions {
  /** Overrides the preset's cap; used by tests and by courts with other limits. */
  maxExportBytes?: number;
}

type Script = 'latin' | 'tamil' | 'kannada';
function scriptOf(word: string): Script {
  for (const ch of word) {
    const c = ch.codePointAt(0) ?? 0;
    if (c >= 0x0b80 && c <= 0x0bff) return 'tamil';
    if (c >= 0x0c80 && c <= 0x0cff) return 'kannada';
  }
  return 'latin';
}

interface Line {
  text: string;
  heading: boolean;
}

function lines(blocks: readonly Block[], facts: Facts, opts: RenderOptions): Line[] {
  const narrativeKeys = new Map(collectNarratives(blocks).map((n) => [n.block, n.key]));
  const out: Line[] = [];
  const visit = (list: readonly Block[]): void => {
    for (const block of list) {
      switch (block.type) {
        case 'heading':
          out.push({ text: block.text, heading: true });
          break;
        case 'paragraph':
          out.push({ text: block.text, heading: false });
          break;
        case 'page_break':
          out.push({ text: '\f', heading: false });
          break;
        case 'slot': {
          const value = resolveSlot(block.resolver, facts).value;
          out.push({
            text: block.label === undefined ? value : `${block.label}: ${value}`,
            heading: false,
          });
          break;
        }
        case 'narrative': {
          const key = narrativeKeys.get(block) ?? '';
          out.push({
            text: opts.narratives?.[key]?.text ?? `[[missing: narrative:${key}]]`,
            heading: false,
          });
          break;
        }
        case 'section':
          if (block.title !== undefined) out.push({ text: block.title, heading: true });
          visit(block.children);
          break;
        case 'list':
          visit(block.children);
          break;
      }
    }
  };
  visit(blocks);
  return out;
}

/** Renders a searchable PDF with embedded Noto fonts. Throws PdfTooLargeError above the cap. */
export async function renderPdf(
  blocks: readonly Block[],
  preset: CourtFormatPreset,
  facts: Facts,
  opts: PdfOptions = {},
): Promise<Uint8Array> {
  assertExportable(blocks, facts, opts);
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const fonts: Record<Script, PDFFont> = {
    latin: await pdf.embedFont(await readFile(fontFile('tamil', 'latin')), { subset: true }),
    tamil: await pdf.embedFont(await readFile(fontFile('tamil', 'tamil')), { subset: true }),
    kannada: await pdf.embedFont(await readFile(fontFile('kannada', 'kannada')), { subset: true }),
  };
  const size = preset.fontSizePt;
  const leading = size * preset.lineSpacing;
  const dims = PAGE_MM[preset.pageSize];
  const pageW = dims.width * PT_PER_MM;
  const pageH = dims.height * PT_PER_MM;
  const left = preset.marginsMm.left * PT_PER_MM;
  const right = pageW - preset.marginsMm.right * PT_PER_MM;
  const top = pageH - preset.marginsMm.top * PT_PER_MM;
  const bottom = preset.marginsMm.bottom * PT_PER_MM;
  const space = fonts.latin.widthOfTextAtSize(' ', size);

  let page = pdf.addPage([pageW, pageH]);
  let y = top - size;
  const newPage = (): void => {
    page = pdf.addPage([pageW, pageH]);
    y = top - size;
  };

  for (const line of lines(blocks, facts, opts)) {
    if (line.text === '\f') {
      newPage();
      continue;
    }
    let x = left;
    for (const word of line.text.split(/\s+/).filter((w) => w !== '')) {
      const font = fonts[scriptOf(word)];
      const width = font.widthOfTextAtSize(word, size);
      if (x > left && x + width > right) {
        x = left;
        y -= leading;
      }
      if (y < bottom) newPage();
      page.drawText(word, { x, y, size, font });
      x += width + space;
    }
    y -= leading * (line.heading ? 1.5 : 1.2);
    if (y < bottom) newPage();
  }

  const bytes = await pdf.save({ useObjectStreams: false });
  const cap = opts.maxExportBytes ?? preset.maxExportBytes;
  if (cap !== undefined && bytes.byteLength > cap)
    throw new PdfTooLargeError(bytes.byteLength, cap);
  return bytes;
}
