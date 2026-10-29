// Limitation inputs (#84): strict objects, unique rule codes, bounded dates.
import { describe, expect, it } from 'vitest';

import { ComputationInput, ComputationResult, LimitationRule, RuleTable } from './limitation';

const rule = {
  code: 'civil.suit_3y',
  title: 'Suit on a contract',
  statute: 'Limitation Act 1963, Art. 55',
  periodValue: 3,
  periodUnit: 'years',
  startEvent: 'cause_of_action',
};
const matterId = '8c5ab3c2-6a7e-4a43-8c4d-3f1b2d9b7a10';

describe('LimitationRule', () => {
  it('accepts a rule and defaults condonable', () => {
    expect(LimitationRule.parse(rule).condonable).toBe(true);
  });
  it('rejects a zero period, a bad code and an unknown key', () => {
    expect(LimitationRule.safeParse({ ...rule, periodValue: 0 }).success).toBe(false);
    expect(LimitationRule.safeParse({ ...rule, code: 'Has-Hyphen' }).success).toBe(false);
    expect(LimitationRule.safeParse({ ...rule, reviewed: true }).success).toBe(false);
  });
});

describe('RuleTable', () => {
  it('accepts unique codes and rejects duplicates and empty tables', () => {
    expect(RuleTable.safeParse({ version: '1', rules: [rule] }).success).toBe(true);
    expect(RuleTable.safeParse({ version: '1', rules: [rule, rule] }).success).toBe(false);
    expect(RuleTable.safeParse({ version: '1', rules: [] }).success).toBe(false);
  });
});

describe('ComputationInput and ComputationResult', () => {
  it('defaults excluded days and rejects a malformed date', () => {
    const input = { matterId, ruleCode: rule.code, startDate: '2026-04-01' };
    expect(ComputationInput.parse(input).excludedDays).toBe(0);
    expect(ComputationInput.safeParse({ ...input, startDate: '1/4/2026' }).success).toBe(false);
  });
  it('requires a known status on a result', () => {
    const result = {
      ruleCode: rule.code,
      startDate: '2026-04-01',
      expiresOn: '2029-04-01',
      status: 'proposed',
    };
    expect(ComputationResult.parse(result).notes).toEqual([]);
    expect(ComputationResult.safeParse({ ...result, status: 'done' }).success).toBe(false);
  });
});
