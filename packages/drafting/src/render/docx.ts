import {
  AlignmentType,
  Document,
  Footer,
  Header,
  HeadingLevel,
  PageNumber,
  Packer,
  Paragraph,
  TextRun,
  type ISectionOptions,
} from 'docx';
import type { Block } from '@causedeck/validators/drafting';

import { missingMarker, resolveSlot, type Facts } from '../slots';
import type { CourtFormatPreset } from '../presets/index';
import { assertExportable, isAiAssisted, type RenderOptions } from './common';

const TWIPS_PER_MM = 56.6929;
const mmToTwips = (mm: number): number => Math.round(mm * TWIPS_PER_MM);

const PAGE_MM = {
  A4: { width: 210, height: 297 },
  Legal: { width: 215.9, height: 355.6 },
  Letter: { width: 215.9, height: 279.4 },
} as const;

const HEADINGS = [
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_2,
  HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4,
  HeadingLevel.HEADING_5,
  HeadingLevel.HEADING_6,
] as const;

function toParagraphs(
  blocks: readonly Block[],
  facts: Facts,
  opts: RenderOptions,
  prefix: string,
): Paragraph[] {
  const out: Paragraph[] = [];
  blocks.forEach((block, index) => {
    const key = block.id ?? `${prefix}.${String(index)}`;
    const childPrefix = `${prefix}.${String(index)}`;
    switch (block.type) {
      case 'heading':
        out.push(
          new Paragraph({
            heading: HEADINGS[block.level - 1] ?? HeadingLevel.HEADING_6,
            text: block.text,
          }),
        );
        break;
      case 'paragraph':
        out.push(new Paragraph({ text: block.text }));
        break;
      case 'page_break':
        out.push(new Paragraph({ children: [new TextRun({ break: 1 })], pageBreakBefore: true }));
        break;
      case 'slot': {
        const value = resolveSlot(block.resolver, facts).value;
        out.push(
          new Paragraph({
            children: [new TextRun(block.label === undefined ? value : `${block.label}: ${value}`)],
          }),
        );
        break;
      }
      case 'narrative':
        out.push(
          new Paragraph({
            text: opts.narratives?.[key]?.text ?? missingMarker(`narrative:${key}`),
          }),
        );
        break;
      case 'section':
        if (block.title !== undefined) {
          out.push(new Paragraph({ heading: HeadingLevel.HEADING_2, text: block.title }));
        }
        out.push(...toParagraphs(block.children, facts, opts, childPrefix));
        break;
      case 'list':
        out.push(...toParagraphs(block.children, facts, opts, childPrefix));
        break;
    }
  });
  return out;
}

/** Renders the tree as a DOCX. Throws MissingSlotsError when unresolved slots are not acknowledged. */
export async function renderDocx(
  blocks: readonly Block[],
  preset: CourtFormatPreset,
  facts: Facts,
  opts: RenderOptions = {},
): Promise<Uint8Array> {
  assertExportable(blocks, facts, opts);
  const page = PAGE_MM[preset.pageSize];
  const number = new Paragraph({
    alignment:
      preset.pageNumbering === 'footer_center' ? AlignmentType.CENTER : AlignmentType.RIGHT,
    children: [new TextRun({ children: [PageNumber.CURRENT] })],
  });
  const section: ISectionOptions = {
    properties: {
      page: {
        size: { width: mmToTwips(page.width), height: mmToTwips(page.height) },
        margin: {
          top: mmToTwips(preset.marginsMm.top),
          right: mmToTwips(preset.marginsMm.right),
          bottom: mmToTwips(preset.marginsMm.bottom),
          left: mmToTwips(preset.marginsMm.left),
        },
      },
    },
    ...(preset.pageNumbering.startsWith('footer')
      ? { footers: { default: new Footer({ children: [number] }) } }
      : preset.pageNumbering === 'header_right'
        ? { headers: { default: new Header({ children: [number] }) } }
        : {}),
    children: toParagraphs(blocks, facts, opts, 'b'),
  };
  const size = preset.fontSizePt * 2;
  const doc = new Document({
    creator: 'CauseDeck',
    customProperties: [{ name: 'AI-assisted', value: String(isAiAssisted(blocks, opts)) }],
    styles: {
      default: {
        document: {
          run: { font: preset.fontFamily, size },
          paragraph: { spacing: { line: Math.round(preset.lineSpacing * 240) } },
        },
        heading1: { run: { font: preset.fontFamily, size, bold: true } },
        heading2: { run: { font: preset.fontFamily, size, bold: true } },
        heading3: { run: { font: preset.fontFamily, size, bold: true } },
        heading4: { run: { font: preset.fontFamily, size, bold: true } },
        heading5: { run: { font: preset.fontFamily, size, bold: true } },
        heading6: { run: { font: preset.fontFamily, size, bold: true } },
      },
    },
    sections: [section],
  });
  return new Uint8Array(await Packer.toBuffer(doc));
}
