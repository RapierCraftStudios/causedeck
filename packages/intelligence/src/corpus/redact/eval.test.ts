import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { evaluate, renderReport } from './eval.ts';

const REPORT = new URL('./EVALUATION.md', import.meta.url);

describe('redaction evaluation (#892)', () => {
  const result = evaluate();

  it('covers at least 30 labelled judgments', () => {
    expect(result.judgments).toBeGreaterThanOrEqual(30);
  });

  it('keeps person-name recall at or above 0.98', () => {
    expect(result.failures.filter((f) => f.includes('person survived'))).toEqual([]);
    expect(result.recall).toBeGreaterThanOrEqual(0.98);
  });

  it('over-redacts judges, advocates and bodies at most 2%', () => {
    expect(result.failures.filter((f) => f.includes('kept text'))).toEqual([]);
    expect(result.overRedaction).toBeLessThanOrEqual(0.02);
  });

  it('masks every sensitive title and leaves no victim or minor identifier', () => {
    expect(result.sensitiveWithMaskedTitle).toBe(result.sensitiveJudgments);
    expect(result.victimIdentifiersLeaked).toBe(0);
  });

  it('matches the committed report', () => {
    const report = renderReport(result);
    // Prettier pads table cells; compare the content, not the padding.
    const flat = (t: string): string =>
      t
        .replace(/-{3,}/g, '---')
        .replace(/[ \t]+/g, ' ')
        .replace(/ \|/g, '|');
    expect(flat(readFileSync(REPORT, 'utf8'))).toBe(flat(report));
  });
});
