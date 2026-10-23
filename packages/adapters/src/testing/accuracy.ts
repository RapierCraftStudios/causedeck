// Per-source fixture accuracy and its regression gate (#516). `summarizeAccuracy` boils a golden
// report down to the share of fixtures that pass and the mean precision and recall of the scored
// fields; `checkBaseline` compares that with the committed `fixtures/accuracy-baseline.json` and
// names every drop, so a parser change that lowers accuracy fails CI. Raising a baseline is a
// reviewed edit of that file; lowering one needs the same review.
import { z } from 'zod';

import type { GoldenReport } from './golden.ts';

export interface SourceAccuracy {
  adapterId: string;
  cases: number;
  passed: number;
  /** Share of committed cause-list fixtures that match their expected file exactly. */
  caseRate: number;
  /** Mean precision and recall over the scored fields. */
  precision: number;
  recall: number;
}

export const AccuracyBaselineSchema = z.record(
  z.string(),
  z.object({
    caseRate: z.number().min(0).max(1),
    precision: z.number().min(0).max(1),
    recall: z.number().min(0).max(1),
  }),
);
export type AccuracyBaseline = z.infer<typeof AccuracyBaselineSchema>;

const round = (value: number) => Math.round(value * 1000) / 1000;
const mean = (values: number[]) =>
  values.length === 0 ? 1 : round(values.reduce((a, b) => a + b, 0) / values.length);

export function summarizeAccuracy(report: GoldenReport): SourceAccuracy {
  const { cases, fields } = report.public;
  const passed = cases.filter((c) => c.passed).length;
  return {
    adapterId: report.adapterId,
    cases: cases.length,
    passed,
    caseRate: cases.length === 0 ? 1 : round(passed / cases.length),
    precision: mean(fields.map((f) => f.precision)),
    recall: mean(fields.map((f) => f.recall)),
  };
}

/** One line per metric that fell below its baseline, and per source with no baseline entry. */
export function checkBaseline(
  accuracy: readonly SourceAccuracy[],
  baseline: AccuracyBaseline,
): string[] {
  const drops: string[] = [];
  for (const source of accuracy) {
    const floor = baseline[source.adapterId];
    if (floor === undefined) {
      drops.push(`${source.adapterId}: no entry in accuracy-baseline.json`);
      continue;
    }
    for (const metric of ['caseRate', 'precision', 'recall'] as const) {
      if (source[metric] + 1e-9 < floor[metric]) {
        drops.push(
          `${source.adapterId}: ${metric} ${String(source[metric])} is below the baseline ${String(floor[metric])}`,
        );
      }
    }
  }
  return drops;
}

/** A per-source table for the CI log. */
export function formatAccuracy(accuracy: readonly SourceAccuracy[]): string {
  const rows = accuracy.map(
    (a) =>
      `${a.adapterId.padEnd(30)} ${`${String(a.passed)}/${String(a.cases)}`.padStart(7)}  caseRate ${a.caseRate.toFixed(3)}  precision ${a.precision.toFixed(3)}  recall ${a.recall.toFixed(3)}`,
  );
  return ['Fixture accuracy per source', ...rows].join('\n');
}
