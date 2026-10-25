// The gold evaluation as a test (#46): `pnpm --filter @causedeck/intelligence eval` runs this file
// and prints the per-field table; `pnpm test` runs it with the rest. Real orders (#119) are scored
// separately when ADAPTER_PRIVATE_FIXTURES_DIR is set.
import { describe, expect, it } from 'vitest';

import { formatReport, runGoldEval, runPrivateEval, TARGETS } from '../../eval/run.ts';
import { GOLD_KINDS, GOLD_SIZE, generateGoldSet } from '../../eval/gold/generate.ts';

describe('gold set', () => {
  it('has at least 60 orders, adversarial ones included, and is deterministic', () => {
    const orders = generateGoldSet();
    expect(orders.length).toBeGreaterThanOrEqual(60);
    expect(orders).toHaveLength(GOLD_SIZE);
    expect(new Set(orders.map((o) => o.kind))).toEqual(new Set(GOLD_KINDS));
    expect(orders.filter((o) => o.adversarial).length).toBeGreaterThanOrEqual(20);
    expect(generateGoldSet()).toEqual(orders);
    expect(new Set(orders.map((o) => o.id)).size).toBe(orders.length);
  });
});

describe('gold evaluation (recorded provider)', () => {
  it('meets the accuracy targets with zero hallucinated dates and valid anchors', async () => {
    const report = await runGoldEval();
    console.log(`\n${formatReport(report)}\n`);
    const rate = (field: string): number => report.fields.find((f) => f.field === field)?.rate ?? 0;
    expect(report.hallucinatedDates).toBe(0);
    expect(rate('anchor validity')).toBe(TARGETS.anchorValidity);
    expect(rate('next date')).toBeGreaterThanOrEqual(TARGETS.nextDate);
    expect(rate('directions recall')).toBeGreaterThanOrEqual(TARGETS.directionsRecall);
    expect(rate('bench')).toBeGreaterThanOrEqual(TARGETS.bench);
    expect(rate('case numbers')).toBeGreaterThanOrEqual(TARGETS.caseNumbers);
    expect(report.failures).toEqual([]);
    expect(report.passed).toBe(true);
  });

  it('does not let a model-invented order date through', async () => {
    const orders = generateGoldSet().slice(0, 1);
    const first = orders[0];
    if (first === undefined) throw new Error('empty gold set');
    // A recorded model that invents the order date: the validator must not let it through, and
    // the scorer counts any date that reaches the output without a literal behind it.
    first.model.orderDate = {
      date: '2031-01-01',
      page: 1,
      quote: first.pages[0]?.text.split('\n')[4] ?? '',
    };
    const report = await runGoldEval(orders);
    expect(report.hallucinatedDates).toBe(0);
  });
});

describe('private fixtures (#119)', () => {
  // eslint-disable-next-line no-process-env -- the eval reads one optional path, as documented.
  const dir = process.env['ADAPTER_PRIVATE_FIXTURES_DIR'];
  it.skipIf(dir === undefined || dir === '')('reports safety counts separately', async () => {
    const report = await runPrivateEval(dir ?? '');
    console.log(`Private fixtures: ${JSON.stringify(report)}`);
    expect(report.hallucinatedDates).toBe(0);
    expect(report.anchorsInvalid).toBe(0);
  });
});
