import { z } from 'zod';

import type { TaskDef } from '../types.ts';
import { isoDate } from './shared.ts';

// The query plan of a fact-pattern search over the judgment corpus (#896, ADR 0051 §Query pipeline
// step 1). The advocate's description is turned into filters (subject areas, statutes, courts, court
// level, dates, outcome), a short fact description for the vector arm and keywords for the lexical
// arm. The vocabularies live in `@causedeck/intelligence` (this package does not depend on it): the
// caller validates every field against them again, so a value outside a list is dropped there, never
// trusted from here. The input is the advocate's own words; no matter record reaches this task.
const input = z.object({
  query: z.string().min(1).max(4000),
});

const output = z.object({
  factDescription: z.string().max(1500),
  keywords: z.array(z.string().max(80)).max(16),
  subjectAreas: z.array(z.string().max(80)).max(6),
  statutes: z
    .array(z.object({ statute: z.string().max(200), section: z.string().max(50) }))
    .max(12),
  courts: z.array(z.string().max(20)).max(6),
  courtLevel: z.enum(['supreme_court', 'high_court', 'other']).nullable(),
  dateFrom: isoDate.nullable(),
  dateTo: isoDate.nullable(),
  outcome: z.enum(['allowed', 'partly_allowed', 'dismissed', 'remanded', 'disposed']).nullable(),
  /** The date of the alleged offence or cause of action, used to pick the IPC or the BNS family. */
  offenceDate: isoDate.nullable(),
});

export const planResearchQuery: TaskDef<z.infer<typeof input>, z.infer<typeof output>> = {
  id: 'plan_research_query',
  input,
  output,
  providers: ['bedrock'],
  maxOutputTokens: 700,
  promptId: 'plan_research_query.v1',
  defaultLevel: 1,
};
