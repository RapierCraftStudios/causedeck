import { z } from 'zod';

import type { TaskDef } from '../types.ts';
import { language } from './shared.ts';

const input = z.object({
  audioBase64: z.string().min(1),
  mimeType: z.string().min(1),
  durationSeconds: z.number().min(0),
  language: language.optional(),
  /** Languages the speaker may use (profile languages plus the forum's language profile). */
  languageHints: z.array(language).max(9).optional(),
});
/** One stretch of speech: millisecond bounds in the audio, with its own language tag. */
export const transcriptSegment = z.object({
  startMs: z.number().int().min(0),
  endMs: z.number().int().min(0),
  language,
  text: z.string(),
});
const output = z.object({
  text: z.string(),
  language,
  segments: z.array(transcriptSegment).optional(),
});

export const transcribe: TaskDef<z.infer<typeof input>, z.infer<typeof output>> = {
  id: 'transcribe',
  input,
  output,
  providers: ['sarvam'],
  maxOutputTokens: 0,
  promptId: 'transcribe.v1',
  defaultLevel: 2,
};
