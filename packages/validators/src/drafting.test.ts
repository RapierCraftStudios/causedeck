import { describe, expect, it } from 'vitest';

import {
  BlockSchema,
  DraftVersionSchema,
  ExportRequestSchema,
  FormatPresetSchema,
  MAX_BLOCK_DEPTH,
  TemplateSchema,
  type Block,
} from './drafting';

const template = (blocks: unknown) => ({
  code: 'in.notice.legal',
  name: 'Legal notice',
  kind: 'notice',
  courtPreset: 'generic',
  blocks,
});

const paths = (result: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) =>
  (result.error?.issues ?? []).map((i) => i.path.join('.'));

describe('BlockSchema', () => {
  it('accepts a valid nested tree', () => {
    const tree = [
      { type: 'heading', level: 1, text: 'Notice' },
      { type: 'slot', resolver: 'matter.title' },
      {
        type: 'section',
        title: 'Facts',
        children: [
          { type: 'paragraph', text: 'It is stated that' },
          { type: 'narrative', prompt: 'Summarise the facts', maxChars: 2000 },
          { type: 'list', ordered: true, children: [{ type: 'paragraph', text: 'One' }] },
        ],
      },
    ];
    expect(TemplateSchema.safeParse(template(tree)).success).toBe(true);
  });

  it('rejects an unknown block type at its field path', () => {
    const result = TemplateSchema.safeParse(
      template([{ type: 'paragraph', text: '' }, { type: 'video' }]),
    );
    expect(result.success).toBe(false);
    expect(paths(result)).toContain('blocks.1.type');
  });

  it('rejects a slot without a resolver and one with an unknown resolver', () => {
    const missing = BlockSchema.safeParse({ type: 'slot' });
    expect(paths(missing)).toContain('resolver');
    const unknown = TemplateSchema.safeParse(
      template([{ type: 'slot', resolver: 'matter.secret_notes' }]),
    );
    expect(paths(unknown)).toContain('blocks.0.resolver');
  });

  it('rejects a narrative without a length cap or with an unbounded one', () => {
    expect(paths(BlockSchema.safeParse({ type: 'narrative', prompt: 'Write' }))).toContain(
      'maxChars',
    );
    expect(
      paths(BlockSchema.safeParse({ type: 'narrative', prompt: 'Write', maxChars: 1_000_000 })),
    ).toContain('maxChars');
    expect(
      paths(BlockSchema.safeParse({ type: 'narrative', prompt: 'Write', maxChars: 0 })),
    ).toContain('maxChars');
  });

  it('reports a bad block nested in a section at its full path', () => {
    const result = TemplateSchema.safeParse(
      template([
        { type: 'section', children: [{ type: 'paragraph', text: 'ok' }, { type: 'slot' }] },
      ]),
    );
    expect(paths(result)).toContain('blocks.0.children.1.resolver');
  });

  it('rejects unknown keys and a tree nested beyond the depth bound', () => {
    expect(BlockSchema.safeParse({ type: 'paragraph', text: 'x', html: '<b>' }).success).toBe(
      false,
    );
    let deep: Block = { type: 'paragraph', text: 'leaf' };
    for (let i = 0; i < MAX_BLOCK_DEPTH; i += 1) deep = { type: 'section', children: [deep] };
    const result = TemplateSchema.safeParse(template([deep]));
    expect(result.success).toBe(false);
    expect(paths(result)).toContain('blocks');
  });
});

describe('other drafting schemas', () => {
  const id = '3f1c9a52-7d6e-4b8a-9c1d-2e5f6a7b8c9d';

  it('validates a draft version digest and an export request', () => {
    const version = { draftId: id, versionNo: 1, content: [], contentSha256: 'a'.repeat(64) };
    expect(DraftVersionSchema.safeParse(version).success).toBe(true);
    expect(paths(DraftVersionSchema.safeParse({ ...version, contentSha256: 'XYZ' }))).toContain(
      'contentSha256',
    );
    expect(ExportRequestSchema.safeParse({ draftVersionId: id, format: 'pdf' }).success).toBe(true);
    expect(paths(ExportRequestSchema.safeParse({ draftVersionId: id, format: 'rtf' }))).toContain(
      'format',
    );
  });

  it('validates a format preset', () => {
    const preset = {
      key: 'madras_hc',
      pageSize: 'A4',
      marginsMm: { top: 25, right: 25, bottom: 25, left: 38 },
      fontFamily: 'Times New Roman',
      fontSizePt: 14,
      lineSpacing: 1.5,
      pageNumbering: 'footer_center',
    };
    expect(FormatPresetSchema.safeParse(preset).success).toBe(true);
    expect(FormatPresetSchema.safeParse({ ...preset, key: 'karnataka_hc' }).success).toBe(true);
    expect(FormatPresetSchema.safeParse({ ...preset, fontSizePt: 2 }).success).toBe(false);
  });
});
