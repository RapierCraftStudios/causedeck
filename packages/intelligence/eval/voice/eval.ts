// The voice structuring eval (#541) over the synthetic transcripts in `fixtures/voice/`. The
// structurer here is a rule-based stand-in for the model (cue words per language), so the eval
// scores what this package owns: the span checks, the spoken-date parser and the validation of a
// reading. Real-speech validation with lawyer-recorded samples is a later human gate.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateHearing, type RawHearing } from '../../src/structure/hearing.ts';
import { foldText } from '../../src/structure/schema.ts';
import { findSpokenDates } from '../../src/structure/spoken-dates.ts';

export const LANGUAGES = ['en', 'ta', 'kn', 'mixed'] as const;
export type FixtureLanguage = (typeof LANGUAGES)[number];

export interface VoiceFixture {
  id: string;
  language: FixtureLanguage;
  hearingDate: string;
  text: string;
  expected: {
    nextDate: { date: string; phrase: string };
    directions: { text: string; dueDate: string | null }[];
    tasks: string[];
  };
}

const fixtureRoot = join(dirname(fileURLToPath(import.meta.url)), '../../fixtures/voice');

export function loadFixtures(language: FixtureLanguage): VoiceFixture[] {
  const dir = join(fixtureRoot, language);
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => JSON.parse(readFileSync(join(dir, name), 'utf8')) as VoiceFixture);
}

const CUES = {
  nextDate: ['next hearing', 'அடுத்த விசாரணை', 'ಮುಂದಿನ ವಿಚಾರಣೆ'],
  direction: ['directed', 'உத்தரவிட்டது', 'ಆದೇಶಿಸಿತು'],
  outcome: ['adjourned', 'ஒத்திவைக்கப்பட்டது', 'ಮುಂದೂಡಲಾಯಿತು'],
  task: ['remind me to', 'நினைவூட்டு', 'ನೆನಪಿಸು'],
} as const;

interface Sentence {
  text: string;
  start: number;
}

function sentences(text: string): Sentence[] {
  return [...text.matchAll(/[^.]+\./gu)].map((m) => ({
    text: m[0].trim(),
    start: m.index + m[0].indexOf(m[0].trim()),
  }));
}

const has = (sentence: Sentence, cues: readonly string[]): boolean =>
  cues.some((cue) => sentence.text.toLowerCase().includes(cue));

/** A cue-word reading of a transcript, shaped like the gateway's `structure_hearing` output. */
export function ruleStructurer(text: string, hearingDate: string): RawHearing {
  const raw: Required<Pick<RawHearing, 'directions' | 'tasks'>> & RawHearing = {
    directions: [],
    tasks: [],
    confidence: 0.9,
  };
  for (const sentence of sentences(text)) {
    const span = { start: sentence.start, end: sentence.start + sentence.text.length };
    const [date] = findSpokenDates(sentence.text, hearingDate);
    if (has(sentence, CUES.nextDate) && date !== undefined) {
      const start = sentence.start + date.span.start;
      raw.nextDate = {
        date: date.date,
        phrase: date.phrase,
        span: { start, end: start + date.phrase.length },
      };
    } else if (has(sentence, CUES.direction)) {
      raw.directions.push({ text: sentence.text, dueExpression: date?.phrase ?? null, span });
    } else if (has(sentence, CUES.task)) {
      raw.tasks.push({ title: sentence.text, span });
    } else if (has(sentence, CUES.outcome) && raw.outcome === undefined) {
      raw.outcome = { text: sentence.text, span };
    }
  }
  return raw;
}

export interface EvalScore {
  language: FixtureLanguage;
  total: number;
  nextDateCorrect: number;
  directionsExpected: number;
  directionsFound: number;
  /** Accepted dates the transcript does not state (must be 0). */
  hallucinatedDates: number;
}

export function scoreLanguage(language: FixtureLanguage): EvalScore {
  const fixtures = loadFixtures(language);
  const score: EvalScore = {
    language,
    total: fixtures.length,
    nextDateCorrect: 0,
    directionsExpected: 0,
    directionsFound: 0,
    hallucinatedDates: 0,
  };
  for (const fixture of fixtures) {
    const input = { transcript: fixture.text, hearingDate: fixture.hearingDate };
    const result = validateHearing(ruleStructurer(fixture.text, fixture.hearingDate), input);
    const { structured } = result;
    if (structured.nextDate?.date === fixture.expected.nextDate.date) score.nextDateCorrect += 1;
    const stated = new Set(findSpokenDates(fixture.text, fixture.hearingDate).map((d) => d.date));
    const accepted = [
      ...(structured.nextDate === undefined ? [] : [structured.nextDate.date]),
      ...structured.directions.flatMap((d) => (d.dueDate === undefined ? [] : [d.dueDate])),
    ];
    score.hallucinatedDates += accepted.filter((date) => !stated.has(date)).length;
    for (const expected of fixture.expected.directions) {
      score.directionsExpected += 1;
      const found = structured.directions.some(
        (d) => foldText(fixture.text.slice(d.span.start, d.span.end)) === foldText(expected.text),
      );
      if (found) score.directionsFound += 1;
    }
  }
  return score;
}
