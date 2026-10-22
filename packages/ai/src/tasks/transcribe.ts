import { z } from 'zod';

import type { TaskDef } from '../types.ts';
import { language } from './shared.ts';

const input = z.object({
  audioBase64: z.string().min(1),
  mimeType: z.string().min(1),
  durationSeconds: z.number().min(0),
  language: language.optional(),
});
const output = z.object({ text: z.string(), language });

export const transcribe: TaskDef<z.infer<typeof input>, z.infer<typeof output>> = {
  id: 'transcribe',
  input,
  output,
  providers: ['sarvam'],
  maxOutputTokens: 0,
  promptId: 'transcribe.v1',
  defaultLevel: 2,
};
