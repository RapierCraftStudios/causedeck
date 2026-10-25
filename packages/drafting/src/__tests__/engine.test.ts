import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import type { Block } from '@causedeck/validators/drafting';

import * as api from '../index';
import {
  collectNarratives,
  collectSlots,
  blockKeys,
  type NarrativeBlock,
  draftNarrative,
  exportBlockers,
  getPreset,
  isValidPreset,
  karnatakaHc,
  madrasHc,
  MissingSlotsError,
  NarrativeOutputError,
  PdfTooLargeError,
  renderDocx,
  renderPdf,
  resolveBlocks,
  resolveSlot,
  validateBlockTree,
  type Facts,
  type NarrativePort,
} from '../index';

const facts: Facts = {
  matter: { title: 'Vellore v. Roads', cnr: 'TNCH010001232024', court: 'High Court of Madras' },
  parties: { petitioner: 'Asha Vellore', respondent: 'Department of Roads' },
  hearing: { nextDate: '2025-03-12', bench: 'Justice A. Sample' },
  advocate: { name: 'K. Counsel', enrolmentNo: 'MS/1/2020' },
  workspace: { name: 'Counsel Chambers' },
  today: '2025-01-01',
};

const tree: Block[] = [
  { type: 'heading', level: 1, text: 'PETITION' },
  { type: 'slot', resolver: 'matter.cnr', label: 'CNR' },
  {
    type: 'section',
    title: 'Facts',
    children: [
      { type: 'narrative', id: 'n1', prompt: 'Summarise', maxChars: 200 },
      { type: 'list', children: [{ type: 'paragraph', text: 'item' }] },
    ],
  },
  { type: 'page_break' },
  { type: 'slot', resolver: 'hearing.bench' },
];

describe('blocks', () => {
  it('walks, collects and validates', () => {
    expect(collectSlots(tree).map((s) => s.key)).toEqual(['b.1', 'b.4']);
    expect(collectNarratives(tree).map((n) => n.key)).toEqual(['n1']);
    expect(blockKeys(tree)).toContain('b.2.1.0');
    expect(validateBlockTree(tree).ok).toBe(true);
    const bad = validateBlockTree([{ type: 'slot', resolver: 'nope' }]);
    expect(bad.ok).toBe(false);
  });
});

describe('slots', () => {
  it('resolves every resolver with provenance', () => {
    const r = resolveSlot('party.petitioner', facts);
    expect(r).toEqual({
      value: 'Asha Vellore',
      provenance: { kind: 'fact', source: 'party.petitioner' },
    });
    for (const resolver of [
      'matter.title',
      'matter.cnr',
      'matter.court',
      'party.respondent',
      'hearing.next_date',
      'hearing.bench',
      'advocate.name',
      'advocate.enrolment_no',
      'workspace.name',
      'date.today',
    ] as const) {
      expect(resolveSlot(resolver, facts).provenance.kind).toBe('fact');
    }
  });

  it('marks unresolved slots and blocks export until acknowledged', () => {
    const r = resolveSlot('hearing.bench', { hearing: { bench: '  ' } });
    expect(r.value).toBe('[[missing: hearing.bench]]');
    expect(r.provenance.kind).toBe('missing');
    expect(resolveBlocks(tree, {}).get('b.1')?.value).toBe('[[missing: matter.cnr]]');
    expect(exportBlockers(tree, {}).map((b) => b.resolver)).toEqual([
      'matter.cnr',
      'hearing.bench',
    ]);
    expect(exportBlockers(tree, {}, ['matter.cnr']).map((b) => b.resolver)).toEqual([
      'hearing.bench',
    ]);
    expect(exportBlockers(tree, {}, true)).toEqual([]);
    expect(exportBlockers(tree, facts)).toEqual([]);
  });
});

describe('presets', () => {
  it('are valid, A4, TNR 14pt, 1.5 spacing', () => {
    for (const p of [madrasHc, karnatakaHc]) {
      expect(isValidPreset(p)).toBe(true);
      expect(p).toMatchObject({
        pageSize: 'A4',
        fontFamily: 'Times New Roman',
        fontSizePt: 14,
        lineSpacing: 1.5,
      });
    }
    expect(madrasHc.maxExportBytes).toBe(20 * 1024 * 1024);
    expect(getPreset('madras_hc')).toBe(madrasHc);
    expect(getPreset('karnataka_hc')).toBe(karnatakaHc);
    expect(getPreset('generic')).toBeUndefined();
    expect(isValidPreset({ ...madrasHc, fontSizePt: 1 })).toBe(false);
  });
});

function docxParts(bytes: Uint8Array): Record<string, string> {
  const files = unzipSync(bytes);
  return Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strFromU8(v)]));
}

describe('docx', () => {
  it('styles.xml matches the golden snapshot', async () => {
    const parts = docxParts(await renderDocx(tree, madrasHc, facts));
    expect(parts['word/styles.xml']).toMatchSnapshot();
  });

  it('sets AI-assisted only while a model narrative is unrewritten', async () => {
    const flag = async (n?: { modelDrafted: boolean; rewritten: boolean }): Promise<string> => {
      const bytes = await renderDocx(tree, karnatakaHc, facts, {
        narratives: n === undefined ? {} : { n1: { text: 'Body', ...n } },
      });
      const parts = docxParts(bytes);
      return (
        /AI-assisted[\s\S]*?<vt:lpwstr>(\w+)</.exec(parts['docProps/custom.xml'] ?? '')?.[1] ?? ''
      );
    };
    expect(await flag({ modelDrafted: true, rewritten: false })).toBe('true');
    expect(await flag({ modelDrafted: true, rewritten: true })).toBe('false');
    expect(await flag({ modelDrafted: false, rewritten: false })).toBe('false');
    expect(await flag()).toBe('false');
  });

  it('refuses unresolved slots unless acknowledged', async () => {
    await expect(renderDocx(tree, madrasHc, {})).rejects.toBeInstanceOf(MissingSlotsError);
    const ok = await renderDocx(tree, madrasHc, {}, { acknowledgeMissing: true });
    expect(docxParts(ok)['word/document.xml']).toContain('[[missing: matter.cnr]]');
  });
});

describe('pdf', () => {
  it('embeds Tamil and Kannada text', async () => {
    const blocks: Block[] = [
      { type: 'paragraph', text: 'Petition ஆணை ಆದೇಶ' },
      { type: 'page_break' },
      { type: 'paragraph', text: 'Second page' },
    ];
    const bytes = await renderPdf(blocks, karnatakaHc, {});
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(2);
    expect(Buffer.from(bytes).includes('ToUnicode')).toBe(true);
  });

  it('wraps and paginates long text', async () => {
    const long = Array.from({ length: 900 }, (_, i) => `word${String(i)}`).join(' ');
    const bytes = await renderPdf(
      [
        { type: 'heading', level: 1, text: 'H' },
        { type: 'paragraph', text: long },
        ...tree.slice(2, 3),
      ],
      madrasHc,
      facts,
      { narratives: { n1: { text: 'x', modelDrafted: false, rewritten: false } } },
    );
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(1);
  });

  it('throws a typed error above the cap', async () => {
    const blocks: Block[] = [{ type: 'paragraph', text: 'hello' }];
    await expect(renderPdf(blocks, madrasHc, {}, { maxExportBytes: 10 })).rejects.toBeInstanceOf(
      PdfTooLargeError,
    );
    await expect(renderPdf(blocks, madrasHc, {})).resolves.toBeInstanceOf(Uint8Array);
  });
});

describe('narrative', () => {
  const block = (collectNarratives(tree)[0] as { block: NarrativeBlock }).block;
  const ctx = { workspaceId: 'w1', purpose: 'draft.narrative' };
  const portReturning = (output: unknown, seen: unknown[] = []): NarrativePort => ({
    run: (taskId, input, c) => {
      seen.push({ taskId, input, c });
      return Promise.resolve({ output });
    },
  });

  it('calls draft_narrative india-only by default and marks the text model-drafted', async () => {
    const seen: { taskId: string; input: { facts: Record<string, string> }; c: object }[] = [];
    const out = await draftNarrative(portReturning({ text: 'Drafted.' }, seen), block, facts, ctx);
    expect(out).toEqual({ text: 'Drafted.', modelDrafted: true, rewritten: false });
    expect(seen[0]?.taskId).toBe('draft_narrative');
    expect(seen[0]?.c).toMatchObject({ indiaOnly: true });
    expect(seen[0]?.input.facts['matter.cnr']).toBe('TNCH010001232024');
    await draftNarrative(portReturning({ text: 'x' }, seen), block, facts, {
      ...ctx,
      indiaOnly: false,
    });
    expect(seen[1]?.c).toMatchObject({ indiaOnly: false });
  });

  it('rejects invalid, empty and over-long output', async () => {
    for (const output of [{}, { text: '  ' }, { text: 'x'.repeat(201) }]) {
      await expect(draftNarrative(portReturning(output), block, facts, ctx)).rejects.toBeInstanceOf(
        NarrativeOutputError,
      );
    }
  });
});

describe('static API', () => {
  it('exposes no send, file or submit function', () => {
    expect(Object.keys(api).filter((k) => /send|file|submit/i.test(k))).toEqual([]);
  });

  it('uses no any in the sources', () => {
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory()
          ? e.name === '__tests__'
            ? []
            : walk(join(dir, e.name))
          : [join(dir, e.name)],
      );
    const src = new URL('..', import.meta.url).pathname;
    for (const f of walk(src).filter((p) => p.endsWith('.ts') && !p.endsWith('.test.ts'))) {
      expect(readFileSync(f, 'utf8'), f).not.toMatch(/:\s*any\b|\bas any\b|<any>/);
    }
  });
});
