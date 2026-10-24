// The structured shape of a photographed diary page (#52, docs/product/09 §3). Every entry and every
// date carries an anchor to the OCR line it was read from: `{page, bbox [x0,y0,x1,y1] normalised
// 0..1, quote}`. The gateway task cites numbered lines; `structureDiaryPage` resolves them to these.
import { ANCHOR_QUOTE_MAX } from '@causedeck/db/schema';
import { z } from 'zod';

export const DIARY_ENTRY_KINDS = ['hearing_note', 'task', 'reminder', 'unknown'] as const;
export type DiaryEntryKind = (typeof DIARY_ENTRY_KINDS)[number];

const unit = z.number().min(0).max(1);

export const DiaryAnchorSchema = z.strictObject({
  page: z.number().int().min(1),
  bbox: z.tuple([unit, unit, unit, unit]),
  quote: z.string().min(1).max(ANCHOR_QUOTE_MAX),
});
export type DiaryAnchor = z.output<typeof DiaryAnchorSchema>;

export const DiaryNextDateSchema = z.strictObject({
  /** ISO `YYYY-MM-DD`. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** The words of the line the date was read from; the date must literally appear in them. */
  phrase: z.string().min(1).max(200),
  anchor: DiaryAnchorSchema,
});

export const DiaryEntrySchema = z.strictObject({
  dateText: z.string().max(200).optional(),
  caseRef: z.string().max(200).optional(),
  text: z.string().min(1).max(2000),
  nextDate: DiaryNextDateSchema.optional(),
  kind: z.enum(DIARY_ENTRY_KINDS),
  anchor: DiaryAnchorSchema,
  /** 0..1 model confidence of the entry. */
  confidence: z.number().min(0).max(1).optional(),
});
export type DiaryEntry = z.output<typeof DiaryEntrySchema>;

export const DiaryStructuredSchema = z.strictObject({
  entries: z.array(DiaryEntrySchema).max(200),
});
export type DiaryStructured = z.output<typeof DiaryStructuredSchema>;
