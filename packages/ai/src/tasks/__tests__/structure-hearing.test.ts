import { describe, expect, it } from 'vitest';

import { structureHearing } from '../structure-hearing.ts';
import { transcribe } from '../transcribe.ts';

describe('structure_hearing', () => {
  it('takes the transcript, hearing date and language hints', () => {
    const input = {
      transcript: 'Next hearing on the 14th.',
      hearingDate: '2026-10-23',
      languageHints: ['en' as const],
    };
    expect(structureHearing.input.safeParse(input).success).toBe(true);
    expect(structureHearing.input.safeParse({ transcript: '' }).success).toBe(false);
  });

  it('returns spanned fields and refuses output without spans', () => {
    const span = { start: 0, end: 4 };
    const ok = {
      outcome: { text: 'adjourned', span },
      nextDate: { date: '2026-11-14', phrase: 'the 14th', span },
      directions: [{ text: 'file', dueExpression: null, span }],
      tasks: [{ title: 'call', span }],
      confidence: 0.9,
    };
    expect(structureHearing.output.safeParse(ok).success).toBe(true);
    expect(
      structureHearing.output.safeParse({ ...ok, outcome: { text: 'adjourned' } }).success,
    ).toBe(false);
  });
});

describe('transcribe', () => {
  it('keeps the old output valid and accepts timed, language-tagged segments', () => {
    expect(transcribe.output.safeParse({ text: 'hi', language: 'en' }).success).toBe(true);
    const segments = [{ startMs: 0, endMs: 900, language: 'ta', text: 'hi' }];
    expect(transcribe.output.safeParse({ text: 'hi', language: 'ta', segments }).success).toBe(
      true,
    );
    const bad = { text: 'hi', language: 'ta', segments: [{ text: 'hi' }] };
    expect(transcribe.output.safeParse(bad).success).toBe(false);
  });
});
