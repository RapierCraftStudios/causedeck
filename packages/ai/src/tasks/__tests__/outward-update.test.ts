import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { inputHash } from '../../hash.ts';
import { DEFAULT_FIXTURES_DIR } from '../../providers/mock.ts';
import { getTask } from '../registry.ts';

const SAMPLE_INPUTS = {
  en: {
    audience: 'client',
    language: 'en',
    tone: 'formal',
    facts: [{ kind: 'next_date', text: 'The next date is 12 December 2026.', confirmed: true }],
  },
  ta: {
    audience: 'client',
    language: 'ta',
    tone: 'formal',
    facts: [{ kind: 'next_date', text: 'அடுத்த தேதி 12 டிசம்பர் 2026.', confirmed: true }],
  },
  kn: {
    audience: 'client',
    language: 'kn',
    tone: 'formal',
    facts: [{ kind: 'next_date', text: 'ಮುಂದಿನ ದಿನಾಂಕ 12 ಡಿಸೆಂಬರ್ 2026.', confirmed: true }],
  },
} as const;

describe('outward_update task', () => {
  const task = getTask('outward_update');

  it('is a drafting-tier task on Bedrock', () => {
    expect(task.tier).toBe('drafting');
    expect(task.providers).toEqual(['bedrock']);
    expect(task.promptId).toBe('outward_update.v1');
  });

  it('takes facts and a closed audience, language and tone only', () => {
    for (const input of Object.values(SAMPLE_INPUTS)) {
      expect(task.input.safeParse(input).success).toBe(true);
    }
    expect(task.input.safeParse({ ...SAMPLE_INPUTS.en, audience: 'opposing_party' }).success).toBe(
      false,
    );
    expect(task.input.safeParse({ ...SAMPLE_INPUTS.en, facts: [] }).success).toBe(false);
  });

  it.each(['en', 'ta', 'kn'] as const)('has a valid %s mock fixture', (language) => {
    const file = path.join(
      DEFAULT_FIXTURES_DIR,
      'outward_update',
      `${inputHash(SAMPLE_INPUTS[language])}.json`,
    );
    expect(existsSync(file)).toBe(true);
    const fixture = JSON.parse(readFileSync(file, 'utf8')) as { output: unknown };
    expect(task.output.safeParse(fixture.output).success).toBe(true);
  });
});
