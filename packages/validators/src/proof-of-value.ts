// Proof-of-value instrumentation (#86, D-030): the zod inputs of the three in-workspace measures
// (a one-tap preparedness rating after a hearing, a weekly three-item load pulse and a timed
// context test) and the member's opt-out. Ids, small integers, booleans and one optional
// single-line note: no matter name, party name or other free text is ever accepted here.
import { z } from 'zod';

/** The longest optional note on a rating (a `varchar(140)` column). */
export const POV_NOTE_MAX = 140;

/** 1 (not prepared / low) to 5 (fully prepared / high). */
export const PovScale = z.number().int().min(1).max(5);

/** A single-line note, trimmed; a line break is refused, so it cannot carry pasted content. */
export const PovNote = z
  .string()
  .trim()
  .max(POV_NOTE_MAX)
  .refine((value) => !/[\r\n]/.test(value), 'A note is one line');

/** The five standard questions about an unfamiliar matter, in the order they are asked. */
export const CONTEXT_TEST_QUESTIONS = [
  'current_stage',
  'last_order',
  'next_date',
  'open_obligations',
  'key_documents',
] as const;
export type ContextTestQuestion = (typeof CONTEXT_TEST_QUESTIONS)[number];
export const ContextTestQuestionId = z.enum(CONTEXT_TEST_QUESTIONS);

/** A preparedness rating for the member's own appearance at a hearing. */
export const PreparednessRating = z
  .object({
    hearingId: z.string().uuid(),
    rating: PovScale,
    note: PovNote.optional(),
  })
  .strict();
export type PreparednessRatingInput = z.infer<typeof PreparednessRating>;

/** The member skipped the tap for a hearing. */
export const PreparednessSkip = z.object({ hearingId: z.string().uuid() }).strict();
export type PreparednessSkipInput = z.infer<typeof PreparednessSkip>;

/** The weekly pulse: mental demand, worry about forgetting, effort to prepare. */
export const LoadPulse = z
  .object({ demand: PovScale, worry: PovScale, effort: PovScale })
  .strict();
export type LoadPulseInput = z.infer<typeof LoadPulse>;

/** One question answered in a context test run: the tester's own correctness mark. */
export const ContextTestAnswer = z
  .object({
    question: ContextTestQuestionId,
    correct: z.boolean(),
    /** Milliseconds from the start of the run to this answer. */
    atMs: z.number().int().min(0).max(24 * 60 * 60 * 1000),
  })
  .strict();
export type ContextTestAnswerEntry = z.infer<typeof ContextTestAnswer>;

/** Start a timed run on a matter the owner chose. */
export const ContextTestStart = z.object({ matterId: z.string().uuid() }).strict();
export type ContextTestStartInput = z.infer<typeof ContextTestStart>;

/** Answer one standard question of a running test. */
export const ContextTestAnswerInput = ContextTestAnswer.extend({
  runId: z.string().uuid(),
}).strict();
export type ContextTestAnswerInputType = z.infer<typeof ContextTestAnswerInput>;

/** Finish a running test. */
export const ContextTestFinish = z.object({ runId: z.string().uuid() }).strict();

/** A stored run: the five answers with the stopwatch time. */
export const ContextTestRun = z
  .object({
    id: z.string().uuid(),
    matterId: z.string().uuid(),
    startedAt: z.date(),
    finishedAt: z.date().nullable(),
    elapsedMs: z.number().int().min(0).nullable(),
    questions: z.array(ContextTestAnswer).max(CONTEXT_TEST_QUESTIONS.length),
  })
  .strict();
export type ContextTestRunRecord = z.infer<typeof ContextTestRun>;

/** A member's prompt preference; `false` stops every prompt immediately. */
export const PovPrefs = z.object({ promptsEnabled: z.boolean() }).strict();
export type PovPrefsInput = z.infer<typeof PovPrefs>;

/** Delete one of the member's own ratings. */
export const PovDeleteRating = z.object({ ratingId: z.string().uuid() }).strict();
