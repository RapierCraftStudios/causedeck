import { z } from 'zod';

export const LANGUAGES = ['en', 'hi', 'ta', 'kn', 'te', 'ml', 'mr', 'bn', 'gu'] as const;
export const language = z.enum(LANGUAGES);

/** 0-1 model confidence. */
export const confidence = z.number().min(0).max(1);

/** An ISO calendar date, `YYYY-MM-DD`. */
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** A source span the model quoted from: page and character range, never the text itself. */
export const sourceRef = z.object({
  page: z.number().int().min(1),
  start: z.number().int().min(0),
  end: z.number().int().min(0),
});

/** A hearing or diary entry the lawyer confirms before it is saved. */
export const hearingProposal = z.object({
  matterHint: z.string().nullable(),
  date: isoDate.nullable(),
  outcome: z.string().nullable(),
  nextDate: isoDate.nullable(),
  notes: z.string().nullable(),
});
