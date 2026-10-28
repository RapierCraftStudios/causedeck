import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { strFromU8, unzipSync } from 'fflate';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { caseTypeInfo, karnatakaCaseTypeInfo } from '@causedeck/adapters';
import { SystemTemplateSeedSchema, type Block } from '@causedeck/validators/drafting';

import {
  collectSlots,
  getPreset,
  renderDocx,
  renderPdf,
  SCAFFOLD_BANNER,
  SYSTEM_TEMPLATES,
  walkBlocks,
  type Facts,
} from '../index';

// Synthetic demo data with fictional parties.
const facts: Facts = {
  matter: {
    title: 'Asha Vellore v. Department of Roads',
    cnr: 'TNCH010001232024',
    court: 'Demo High Court',
  },
  parties: { petitioner: 'Asha Vellore', respondent: 'Department of Roads' },
  hearing: { nextDate: '2025-03-12', bench: 'Justice A. Sample' },
  advocate: { name: 'K. Counsel', enrolmentNo: 'MS/1/2020' },
  workspace: { name: 'Counsel Chambers' },
  client: { name: 'Asha Vellore' },
  today: '2025-01-01',
};

const docxText = (bytes: Uint8Array): string => {
  const xml = strFromU8(unzipSync(bytes)['word/document.xml'] ?? new Uint8Array());
  return [...xml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]).join('\n');
};

const textOf = (blocks: readonly Block[]): string[] => {
  const out: string[] = [];
  walkBlocks(blocks, ({ block }) => {
    if (block.type === 'paragraph' || block.type === 'heading') out.push(block.text);
    if (block.type === 'narrative') out.push(block.prompt);
    if (block.type === 'slot' && block.label) out.push(block.label);
    if (block.type === 'section' && block.title) out.push(block.title);
  });
  return out;
};

const byCourt = (preset: string) => SYSTEM_TEMPLATES.filter((t) => t.courtPreset === preset);

describe('system template registry', () => {
  it('has the catalogue: five kinds for each launch court, two kinds for A0, stable codes', () => {
    const codes = SYSTEM_TEMPLATES.map((t) => t.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const court of ['madras_hc', 'karnataka_hc']) {
      expect(
        byCourt(court)
          .map((t) => t.code.split('.')[1])
          .sort(),
      ).toEqual([
        'certified_copy_application',
        'client_covering_letter',
        'early_listing_memo',
        'memo_of_appearance',
        'mention_memo',
      ]);
    }
    expect(byCourt('generic').map((t) => t.code)).toEqual([
      'generic_a0.adjournment_note',
      'generic_a0.client_covering_letter',
    ]);
    for (const t of SYSTEM_TEMPLATES) {
      expect(SystemTemplateSeedSchema.safeParse(t).success, t.code).toBe(true);
      expect(t.reviewedBy, t.code).toBeNull();
    }
  });

  it.each(SYSTEM_TEMPLATES.map((t) => [t.code, t] as const))(
    'renders %s with its court preset (DOCX text snapshot)',
    async (_code, t) => {
      const preset = getPreset(t.courtPreset);
      expect(preset).toBeDefined();
      if (preset === undefined) return;
      const text = docxText(await renderDocx(t.blocks, preset, facts, { banner: SCAFFOLD_BANNER }));
      expect(text.split('\n')[0]).toBe(SCAFFOLD_BANNER);
      expect(text).not.toContain('[[missing: ' + 'matter');
      expect(text).toMatchSnapshot();
    },
  );

  it('takes case-type labels from the adapter catalogue, not from literals', () => {
    for (const t of SYSTEM_TEMPLATES.filter((x) => x.courtPreset !== 'generic')) {
      const lookup = t.courtPreset === 'madras_hc' ? caseTypeInfo : karnatakaCaseTypeInfo;
      const line = textOf(t.blocks).find((s) => s.startsWith('Matter type: '));
      if (line === undefined) {
        expect(t.code, 'only letters carry no matter type').toMatch(/client_covering_letter$/);
        continue;
      }
      const labels = line.slice('Matter type: '.length).split(', ');
      expect(labels.length, t.code).toBeGreaterThan(0);
      for (const label of labels) {
        const code = label.replace(/[^A-Za-z]/g, '').toUpperCase();
        expect(lookup(code)?.label, `${t.code}: ${label}`).toBe(label);
      }
    }
    const dir = fileURLToPath(new URL('../system-templates', import.meta.url));
    for (const sub of ['madras-hc', 'karnataka-hc', 'generic-a0']) {
      for (const file of readdirSync(join(dir, sub))) {
        const src = readFileSync(join(dir, sub, file), 'utf8');
        expect(src, file).not.toMatch(
          /['"`][^'"`\n]*(W\.P\.|W\.A\.|C\.M\.A\.|R\.F\.A\.|Writ Petition|Writ Appeal|Hon'ble)/,
        );
      }
    }
  });

  it('client covering letters read only the existing-client slot for the recipient', () => {
    const letters = SYSTEM_TEMPLATES.filter((t) => t.code.endsWith('client_covering_letter'));
    expect(letters).toHaveLength(3);
    for (const t of letters) {
      const resolvers = collectSlots(t.blocks).map((s) => s.block.resolver);
      expect(resolvers, t.code).toContain('client.name');
      expect(
        resolvers.filter((r) => r.startsWith('party.')),
        t.code,
      ).toEqual([]);
    }
  });

  it('shows the scaffold banner in DOCX and PDF only when asked, and leaves other output alone', async () => {
    const t = SYSTEM_TEMPLATES[0];
    const preset = getPreset(t?.courtPreset ?? 'generic');
    if (t === undefined || preset === undefined) throw new Error('no template');
    const plain = docxText(await renderDocx(t.blocks, preset, facts));
    expect(plain).not.toContain(SCAFFOLD_BANNER);
    const bannered = docxText(
      await renderDocx(t.blocks, preset, facts, { banner: SCAFFOLD_BANNER }),
    );
    expect(bannered).toContain(SCAFFOLD_BANNER);
    const pdf = await PDFDocument.load(
      await renderPdf(t.blocks, preset, facts, { banner: SCAFFOLD_BANNER }),
    );
    expect(pdf.getPageCount()).toBeGreaterThan(0);
  });

  it('keeps legal citations and authorities out of every template', () => {
    const patterns = [
      /\b\d{4}\s*:\s*[A-Z][A-Za-z.]*\s*:\s*\d+/, // neutral citation, e.g. 2024:KHC:1234
      /\bAIR\s+\d{4}\b/,
      /\(\d{4}\)\s*\d+\s*SCC\b/,
      /\bSCC\s+OnLine\b/,
      /\b(?:Section|Sections|Article|Order|Rule)\s+\d+/i,
      /\b[A-Z][\w.]*\s+v(?:s)?\.?\s+[A-Z]/,
      /\bAct,?\s+(?:19|20)\d{2}\b/,
    ];
    for (const t of SYSTEM_TEMPLATES) {
      for (const s of textOf(t.blocks)) {
        for (const re of patterns) expect(s, `${t.code}: ${re.source}`).not.toMatch(re);
      }
    }
    // The lint itself works.
    expect('as held in 2024:KHC:1234').toMatch(patterns[0] as RegExp);
    expect('Section 138 of the Act').toMatch(patterns[4] as RegExp);
  });

  it('keeps advice, commitments, fee quotes and solicitation out of every template', () => {
    const denied = [
      /\badvis(?:e|ed|ing)\b/i,
      /\badvice\b/i,
      /\brecommend/i,
      /\bguarantee/i,
      /\bassure/i,
      /\bwe (?:will|shall)\b/i,
      /\bI (?:will|shall)\b/i,
      /\bfees?\b/i,
      /\bcharges?\b/i,
      /\binvoice/i,
      /\bretainer\b/i,
      /\bsolicit/i,
      /\bhire us\b/i,
      /\bbest (?:lawyer|advocate)/i,
    ];
    for (const t of SYSTEM_TEMPLATES) {
      for (const s of textOf(t.blocks)) {
        for (const re of denied) {
          const clean = s.replace(/Give no advice, no commitment, no fee and no citation\./, '');
          expect(clean, `${t.code}: ${re.source}`).not.toMatch(re);
        }
      }
    }
    expect('We will guarantee a win').toMatch(denied[3] as RegExp);
  });

  it('switches to a Tamil or Kannada complex-script font in DOCX and embeds glyph fonts in PDF', async () => {
    const preset = getPreset('madras_hc');
    if (preset === undefined) throw new Error('no preset');
    const blocks: Block[] = [{ type: 'paragraph', text: 'வணக்கம் ನಮಸ್ಕಾರ' }];
    for (const [locale, font] of [
      ['ta', 'Noto Sans Tamil'],
      ['kn', 'Noto Sans Kannada'],
    ] as const) {
      const files = unzipSync(await renderDocx(blocks, preset, facts, { locale }));
      expect(strFromU8(files['word/styles.xml'] ?? new Uint8Array())).toContain(font);
    }
    const english = unzipSync(await renderDocx(blocks, preset, facts));
    expect(strFromU8(english['word/styles.xml'] ?? new Uint8Array())).not.toContain('Noto Sans');
    const pdf = strFromU8(await renderPdf(blocks, preset, facts), true);
    expect(pdf).toMatch(/NotoSansTamil/);
    expect(pdf).toMatch(/NotoSansKannada/);
  });
});
