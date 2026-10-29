import { describe, expect, it } from 'vitest';

import {
  CONTEXT_TEST_QUESTIONS,
  ContextTestAnswerInput,
  LoadPulse,
  PovPrefs,
  PreparednessRating,
} from './proof-of-value';

const HEARING = '00000000-0000-4000-8000-000000000001';

describe('proof-of-value validators (#86)', () => {
  it('accepts 1 to 5 and refuses anything else', () => {
    expect(PreparednessRating.safeParse({ hearingId: HEARING, rating: 5 }).success).toBe(true);
    for (const rating of [0, 6, 2.5, '3'])
      expect(PreparednessRating.safeParse({ hearingId: HEARING, rating }).success).toBe(false);
  });

  it('caps the note at 140 characters on one line', () => {
    const base = { hearingId: HEARING, rating: 3 };
    expect(PreparednessRating.safeParse({ ...base, note: 'x'.repeat(140) }).success).toBe(true);
    expect(PreparednessRating.safeParse({ ...base, note: 'x'.repeat(141) }).success).toBe(false);
    expect(PreparednessRating.safeParse({ ...base, note: 'a\nb' }).success).toBe(false);
  });

  it('is strict: an unknown (content) key is an error', () => {
    expect(LoadPulse.safeParse({ demand: 1, worry: 2, effort: 3, matterName: 'x' }).success).toBe(
      false,
    );
    expect(LoadPulse.safeParse({ demand: 1, worry: 2, effort: 3 }).success).toBe(true);
  });

  it('knows the five standard questions', () => {
    expect(CONTEXT_TEST_QUESTIONS).toHaveLength(5);
    const ok = ContextTestAnswerInput.safeParse({
      runId: HEARING,
      question: 'next_date',
      correct: true,
      atMs: 1200,
    });
    expect(ok.success).toBe(true);
    expect(ContextTestAnswerInput.safeParse({ runId: HEARING, question: 'x' }).success).toBe(false);
  });

  it('PovPrefs is one boolean', () => {
    expect(PovPrefs.safeParse({ promptsEnabled: false }).success).toBe(true);
    expect(PovPrefs.safeParse({}).success).toBe(false);
  });
});
