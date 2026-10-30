// Role accuracy on the labelled set (#893): macro-F1 of at least 0.75 over at least 20 judgments.
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { evaluateRoles } from './segment-eval.ts';
import { SEGMENT_FIXTURES } from './segment-fixtures.ts';

describe('segment role accuracy', () => {
  const result = evaluateRoles();

  it('is measured on at least 20 judgments', () => {
    expect(SEGMENT_FIXTURES.length).toBeGreaterThanOrEqual(20);
    expect(result.judgments).toBe(SEGMENT_FIXTURES.length);
  });

  it('reaches a macro-F1 of at least 0.75', () => {
    expect(result.macroF1).toBeGreaterThanOrEqual(0.75);
  });

  it('is reported in SEGMENT-EVALUATION.md', () => {
    const report = readFileSync(path.join(import.meta.dirname, 'SEGMENT-EVALUATION.md'), 'utf8');
    expect(report).toContain(`measured macro-F1 ${result.macroF1.toFixed(3)}`);
    for (const s of result.perRole.filter((r) => r.support > 0))
      expect(report).toContain(
        `| ${s.role} | ${String(s.support)} | ${s.precision.toFixed(3)} | ${s.recall.toFixed(3)} | ${s.f1.toFixed(3)} |`,
      );
  });
});
