// The voice eval gate (#541): next-date accuracy >= 98%, directions recall >= 90%, zero
// hallucinated dates, over >= 40 synthetic transcripts each of en, ta, kn and mixed speech.
import { describe, expect, it } from 'vitest';

import { LANGUAGES, loadFixtures, ruleStructurer, scoreLanguage } from './eval.ts';
import { validateHearing } from '../../src/structure/hearing.ts';

describe.each(LANGUAGES)('voice eval: %s', (language) => {
  it('has at least 40 synthetic transcripts', () => {
    expect(loadFixtures(language).length).toBeGreaterThanOrEqual(40);
  });

  it('meets the next-date, directions and hallucination thresholds', () => {
    const score = scoreLanguage(language);
    expect(score.nextDateCorrect / score.total).toBeGreaterThanOrEqual(0.98);
    expect(score.directionsFound / score.directionsExpected).toBeGreaterThanOrEqual(0.9);
    expect(score.hallucinatedDates).toBe(0);
  });

  it('rejects a date the model invents for every transcript', () => {
    for (const fixture of loadFixtures(language)) {
      const raw = ruleStructurer(fixture.text, fixture.hearingDate);
      if (raw.nextDate === undefined) continue;
      const forged = { ...raw, nextDate: { ...raw.nextDate, date: '2031-01-01' } };
      const result = validateHearing(forged, {
        transcript: fixture.text,
        hearingDate: fixture.hearingDate,
      });
      expect(result.structured.nextDate, fixture.id).toBeUndefined();
      expect(result.needsYou?.reasons, fixture.id).toContain('next_date_dropped');
    }
  });
});
