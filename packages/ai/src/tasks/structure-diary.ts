import { z } from 'zod';

import type { TaskDef } from '../types.ts';
import { confidence, hearingProposal } from './shared.ts';

const input = z.object({ text: z.string().min(1) });
const output = z.object({ proposals: z.array(hearingProposal), confidence });

export const structureDiary: TaskDef<z.infer<typeof input>, z.infer<typeof output>> = {
  id: 'structure_diary',
  input,
  output,
  providers: ['bedrock'],
  maxOutputTokens: 1024,
  promptId: 'structure_diary.v1',
  defaultLevel: 2,
};
