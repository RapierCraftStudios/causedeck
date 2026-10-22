import { z } from 'zod';

import type { TaskDef } from '../types.ts';
import { confidence, language } from './shared.ts';

const input = z.object({
  contentBase64: z.string().min(1),
  mimeType: z.string().min(1),
  pageCount: z.number().int().min(1),
  language: language.optional(),
});
const output = z.object({
  pages: z.array(z.object({ page: z.number().int().min(1), text: z.string() })),
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
