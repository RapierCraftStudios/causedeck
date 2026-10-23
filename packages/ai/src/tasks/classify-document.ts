import { z } from 'zod';

import type { TaskDef } from '../types.ts';
import { confidence } from './shared.ts';

export const DOCUMENT_TYPES = [
  'order',
  'judgment',
  'cause_list',
  'pleading',
  'ia',
  'annexure',
  'correspondence',
  'registry_memo',
  'other',
] as const;

const input = z.object({ text: z.string().min(1), pageCount: z.number().int().min(1).optional() });
const output = z.object({ documentType: z.enum(DOCUMENT_TYPES), confidence });

export const classifyDocument: TaskDef<z.infer<typeof input>, z.infer<typeof output>> = {
  id: 'classify_document',
  input,
  output,
  providers: ['bedrock'],
  maxOutputTokens: 256,
  promptId: 'classify_document.v1',
  defaultLevel: 2,
};
