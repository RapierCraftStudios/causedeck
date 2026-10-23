import { z } from 'zod';

import type { TaskDef } from '../types.ts';
import { confidence, language } from './shared.ts';

const input = z.object({
  contentBase64: z.string().min(1),
  mimeType: z.string().min(1),
  pageCount: z.number().int().min(1),
  language: language.optional(),
});
/** One OCR line with its box `[x0, y0, x1, y1]` normalised 0..1 over the page image. */
const ocrLine = z.object({
  text: z.string(),
  bbox: z.tuple([
    z.number().min(0).max(1),
    z.number().min(0).max(1),
    z.number().min(0).max(1),
    z.number().min(0).max(1),
  ]),
  conf: confidence,
});

const output = z.object({
  pages: z.array(
    z.object({
      page: z.number().int().min(1),
      text: z.string(),
      /** Line boxes when the provider reports them (#52); absent otherwise. */
      lines: z.array(ocrLine).optional(),
      /** Per-page 0-1 confidence when the provider reports one; else the overall `confidence`. */
      confidence: confidence.optional(),
    }),
  ),
  confidence,
});

export const ocr: TaskDef<z.infer<typeof input>, z.infer<typeof output>> = {
  id: 'ocr',
  input,
  output,
  providers: ['sarvam'],
  maxOutputTokens: 0,
  promptId: 'ocr.v1',
  defaultLevel: 2,
};
