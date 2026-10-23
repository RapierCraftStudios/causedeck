import { z } from 'zod';

import type { TaskDef } from '../types.ts';
import { confidence, hearingProposal, isoDate } from './shared.ts';

/** Most numbered OCR lines one call may carry (a handful of pages). */
export const STRUCTURE_DIARY_MAX_LINES = 600;

/** One numbered OCR line of a diary page photo (#52); the model cites lines by `n`. */
const line = z.object({
  n: z.number().int().min(1),
  page: z.number().int().min(1),
  text: z.string().min(1).max(2000),
});

const input = z.object({
  text: z.string().min(1),
  lines: z.array(line).max(STRUCTURE_DIARY_MAX_LINES).optional(),
});

const nextDate = z.object({
  /** An ISO date whose digits or words appear literally in `phrase`. */
  date: isoDate,
  phrase: z.string().min(1).max(200),
  line: z.number().int().min(1),
});

/** A diary entry cited to the numbered line it was read from (#52). */
const entry = z.object({
  dateText: z.string().max(200).nullish(),
  caseRef: z.string().max(200).nullish(),
  text: z.string().min(1).max(2000),
  nextDate: nextDate.nullish(),
  kind: z.enum(['hearing_note', 'task', 'reminder', 'unknown']),
  line: z.number().int().min(1),
  confidence: confidence.optional(),
});

const output = z.object({
  proposals: z.array(hearingProposal).default([]),
  entries: z.array(entry).max(200).default([]),
  confidence,
});

export type StructureDiaryInput = z.infer<typeof input>;
export type StructureDiaryOutput = z.infer<typeof output>;
export type StructureDiaryEntry = z.infer<typeof entry>;

export const structureDiary: TaskDef<StructureDiaryInput, StructureDiaryOutput> = {
  id: 'structure_diary',
  input,
  output,
  providers: ['bedrock'],
  maxOutputTokens: 2048,
  promptId: 'structure_diary.v1',
  defaultLevel: 2,
};
