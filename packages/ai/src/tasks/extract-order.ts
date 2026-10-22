import { z } from 'zod';

import type { TaskDef } from '../types.ts';
import { confidence, isoDate, sourceRef } from './shared.ts';

const input = z.object({ text: z.string().min(1), pageCount: z.number().int().min(1).optional() });
const output = z.object({
  orderDate: isoDate.nullable(),
  nextHearingDate: isoDate.nullable(),
  directions: z.array(z.object({ summary: z.string(), source: sourceRef.nullable() })),
  confidence,
});

export const extractOrder: TaskDef<z.infer<typeof input>, z.infer<typeof output>> = {
  id: 'extract_order',
  input,
  output,
  providers: ['bedrock'],
  maxOutputTokens: 1024,
  promptId: 'extract_order.v1',
  defaultLevel: 2,
};
