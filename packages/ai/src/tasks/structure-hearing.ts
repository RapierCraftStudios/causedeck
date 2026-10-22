import { z } from 'zod';

import type { TaskDef } from '../types.ts';
import { confidence, hearingProposal } from './shared.ts';

const input = z.object({ transcript: z.string().min(1) });
const output = z.object({ proposals: z.array(hearingProposal), confidence });

export const structureHearing: TaskDef<z.infer<typeof input>, z.infer<typeof output>> = {
  id: 'structure_hearing',
  input,
  output,
  providers: ['bedrock'],
  maxOutputTokens: 1024,
  promptId: 'structure_hearing.v1',
  defaultLevel: 2,
};
