// #1119 mutation check: with the quote check removed from `answerQuery` (checkAnswer always reports a
// match), the adversarial cases come back verified and the quality gate fails on falseVerified.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createMockEmbedProvider,
  createMockRerankProvider,
  createRerankGateway,
} from '@causedeck/ai';
import { describe, expect, it, vi } from 'vitest';

import { buildQualityReport, gateQuality } from './runner.ts';
import { baselineSchema, thresholdsSchema, type Answer } from './types.ts';

vi.mock('./faithfulness.ts', () => ({
  checkAnswer: (answer: Answer) => {
    const n = answer.quotes.length;
    return { quotes: n, quotesMatching: n, citations: n, citationsExisting: n };
  },
}));

const FIXTURES = fileURLToPath(new URL('../../../../../fixtures/research-eval', import.meta.url));
const read = (file: string): unknown => JSON.parse(readFileSync(path.join(FIXTURES, file), 'utf8'));
const mock = createMockEmbedProvider();

describe('mutation: answerQuery without its quote check', () => {
  it('fails the gate naming falseVerified', async () => {
    const report = await buildQualityReport({
      syntheticDir: FIXTURES,
      embed: async (texts) => (await mock.embed(texts)).vectors,
      reranker: createRerankGateway({ providers: [createMockRerankProvider()] }),
    });
    expect(report.synthetic.metrics.falseVerified).toBeGreaterThan(0);
    const failures = gateQuality(
      report,
      baselineSchema.parse(read('baseline.json')),
      thresholdsSchema.parse(read('thresholds.json')),
    );
    expect(failures.some((f) => f.startsWith('falseVerified is'))).toBe(true);
  });
});
