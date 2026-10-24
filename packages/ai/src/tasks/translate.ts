import { z } from 'zod';

import type { TaskDef } from '../types.ts';
import { language } from './shared.ts';

const input = z.object({
  text: z.string().min(1),
  sourceLanguage: language,
  targetLanguage: language,
});
const output = z.object({ text: z.string() });

export const translate: TaskDef<z.infer<typeof input>, z.infer<typeof output>> = {
  id: 'translate',
  input,
  output,
  providers: ['sarvam', 'bedrock'],
  maxOutputTokens: 2048,
  promptId: 'translate.v1',
  defaultLevel: 1,
};
