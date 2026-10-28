// Drafting schemas (#766, part 1 of #75): the block tree of a `template` and of a `draft_version`,
// the court format presets, and the draft and export inputs. The lists below are closed on purpose:
// an unknown block type, a slot without a known resolver, or a narrative block without a length cap
// is rejected with an issue at that block's field path (e.g. `blocks.2.children.0.resolver`), so a
// template cannot carry content the engine (#767) cannot render. The db stores the tree as jsonb and
// does not import this package.
import { z } from 'zod';

export const BLOCK_TYPES = [
  'heading',
  'paragraph',
  'section',
  'list',
  'slot',
  'narrative',
  'page_break',
] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];

/** The named data sources a `slot` block is filled from. */
export const SLOT_RESOLVERS = [
  'matter.title',
  'matter.cnr',
  'matter.court',
  'party.petitioner',
  'party.respondent',
  'hearing.next_date',
  'hearing.bench',
  'advocate.name',
  'advocate.enrolment_no',
  'workspace.name',
  'client.name',
  'date.today',
] as const;
export type SlotResolver = (typeof SLOT_RESOLVERS)[number];

export const COURT_PRESETS = [
  'generic',
  'supreme_court',
  'madras_hc',
  'karnataka_hc',
  'delhi_hc',
  'bombay_hc',
  'district_court',
] as const;
export type CourtPreset = (typeof COURT_PRESETS)[number];

export const EXPORT_FORMATS = ['docx', 'pdf'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export const TEMPLATE_KINDS = [
  'notice',
  'petition',
  'affidavit',
  'reply',
  'memo',
  'other',
] as const;
export const DRAFT_STATUSES = ['draft', 'final'] as const;
export const DRAFTING_LOCALES = ['en', 'kn', 'ta'] as const;

/** Bounds on a block tree, so a template cannot be used to exhaust the renderer. */
export const MAX_BLOCK_DEPTH = 6;
export const MAX_BLOCK_COUNT = 500;
export const MAX_NARRATIVE_CHARS = 20_000;
export const MAX_TEXT_CHARS = 10_000;

export type Block =
  | { type: 'heading'; id?: string; level: number; text: string }
  | { type: 'paragraph'; id?: string; text: string }
  | { type: 'page_break'; id?: string }
  | { type: 'slot'; id?: string; resolver: SlotResolver; label?: string }
  | { type: 'narrative'; id?: string; prompt: string; maxChars: number }
  | { type: 'section'; id?: string; title?: string; children: Block[] }
  | { type: 'list'; id?: string; ordered?: boolean; children: Block[] };

const blockId = z.string().min(1).max(64).exactOptional();
const text = z.string().max(MAX_TEXT_CHARS);

export const BlockSchema: z.ZodType<Block> = z.lazy(() =>
  z.discriminatedUnion('type', [
    z
      .object({
        type: z.literal('heading'),
        id: blockId,
        level: z.number().int().min(1).max(6),
        text: text.min(1),
      })
      .strict(),
    z.object({ type: z.literal('paragraph'), id: blockId, text }).strict(),
    z.object({ type: z.literal('page_break'), id: blockId }).strict(),
    z
      .object({
        type: z.literal('slot'),
        id: blockId,
        resolver: z.enum(SLOT_RESOLVERS),
        label: z.string().max(200).exactOptional(),
      })
      .strict(),
    z
      .object({
        type: z.literal('narrative'),
        id: blockId,
        prompt: text.min(1),
        maxChars: z.number().int().min(1).max(MAX_NARRATIVE_CHARS),
      })
      .strict(),
    z
      .object({
        type: z.literal('section'),
        id: blockId,
        title: z.string().max(300).exactOptional(),
        children: z.array(BlockSchema),
      })
      .strict(),
    z
      .object({
        type: z.literal('list'),
        id: blockId,
        ordered: z.boolean().exactOptional(),
        children: z.array(BlockSchema),
      })
      .strict(),
  ]),
);

function measure(blocks: readonly Block[], depth: number): { count: number; depth: number } {
  let count = 0;
  let deepest = depth;
  for (const block of blocks) {
    count += 1;
    if (block.type === 'section' || block.type === 'list') {
      const inner = measure(block.children, depth + 1);
      count += inner.count;
      deepest = Math.max(deepest, inner.depth);
    }
  }
  return { count, depth: deepest };
}

/** A bounded list of top-level blocks: at most MAX_BLOCK_COUNT blocks nested MAX_BLOCK_DEPTH deep. */
export const BlockTreeSchema = z.array(BlockSchema).superRefine((blocks, ctx) => {
  const { count, depth } = measure(blocks, 1);
  if (count > MAX_BLOCK_COUNT) {
    ctx.addIssue({ code: 'custom', message: `at most ${String(MAX_BLOCK_COUNT)} blocks` });
  }
  if (depth > MAX_BLOCK_DEPTH) {
    ctx.addIssue({ code: 'custom', message: `at most ${String(MAX_BLOCK_DEPTH)} levels deep` });
  }
});

export const TemplateSchema = z
  .object({
    code: z.string().regex(/^[a-z][a-z0-9_]*(\.[a-z0-9_-]+)*$/, 'a lowercase dotted slug'),
    name: z.string().min(1).max(200),
    kind: z.enum(TEMPLATE_KINDS),
    courtPreset: z.enum(COURT_PRESETS),
    blocks: BlockTreeSchema,
    locale: z.enum(DRAFTING_LOCALES).default('en'),
    version: z.number().int().min(1).default(1),
    enabled: z.boolean().default(true),
  })
  .strict();
export type Template = z.infer<typeof TemplateSchema>;

/** A system template as seeded: the template plus its semantic version, checksum and reviewer. */
export const SystemTemplateSeedSchema = z
  .object({
    code: TemplateSchema.shape.code,
    name: TemplateSchema.shape.name,
    kind: TemplateSchema.shape.kind,
    courtPreset: TemplateSchema.shape.courtPreset,
    blocks: TemplateSchema.shape.blocks,
    locale: TemplateSchema.shape.locale,
    /** Semantic version of the wording, e.g. `1.0.0`. */
    semver: z.string().regex(/^\d+\.\d+\.\d+$/, 'a semantic version'),
    /** sha256 hex of the code, kind, preset, locale, semver and blocks. */
    checksum: z.string().regex(/^[0-9a-f]{64}$/, 'a lowercase sha256 hex digest'),
    /** Null until a practising advocate has reviewed the wording; the banner shows until then. */
    reviewedBy: z.string().min(1).max(200).nullable(),
  })
  .strict();
export type SystemTemplateSeed = z.infer<typeof SystemTemplateSeedSchema>;

export const FormatPresetSchema = z
  .object({
    key: z.enum(COURT_PRESETS),
    pageSize: z.enum(['A4', 'Legal', 'Letter']),
    marginsMm: z
      .object({
        top: z.number().min(0).max(100),
        right: z.number().min(0).max(100),
        bottom: z.number().min(0).max(100),
        left: z.number().min(0).max(100),
      })
      .strict(),
    fontFamily: z.string().min(1).max(100),
    fontSizePt: z.number().min(6).max(24),
    lineSpacing: z.number().min(1).max(3),
    pageNumbering: z.enum(['none', 'footer_center', 'footer_right', 'header_right']),
  })
  .strict();
export type FormatPreset = z.infer<typeof FormatPresetSchema>;

export const DraftSchema = z
  .object({
    templateId: z.uuid(),
    matterId: z.uuid().exactOptional(),
    title: z.string().min(1).max(300),
    status: z.enum(DRAFT_STATUSES).default('draft'),
  })
  .strict();
export type Draft = z.infer<typeof DraftSchema>;

export const DraftVersionSchema = z
  .object({
    draftId: z.uuid(),
    versionNo: z.number().int().min(1),
    content: BlockTreeSchema,
    contentSha256: z.string().regex(/^[0-9a-f]{64}$/, 'a lowercase sha256 hex digest'),
  })
  .strict();
export type DraftVersion = z.infer<typeof DraftVersionSchema>;

export const ExportRequestSchema = z
  .object({
    draftVersionId: z.uuid(),
    format: z.enum(EXPORT_FORMATS),
  })
  .strict();
export type ExportRequest = z.infer<typeof ExportRequestSchema>;
