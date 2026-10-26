import { describe, expect, it } from 'vitest';

import {
  ApplyFixRequestSchema,
  ConsistencyReportSchema,
  FindingSchema,
} from './consistency';

const finding = {
  id: 'name.mismatch:b.0:4',
  severity: 'error',
  rule: 'name.mismatch',
  span: { blockKey: 'b.0', start: 4, end: 9 },
  expected: 'Ramesh Kumar',
  found: 'Ramesh Kumaar',
  provenance: { fact: 'party.petitioner', sourceType: 'manual', sourceRef: null, anchorId: null },
} as const;

describe('consistency schemas', () => {
  it('accepts a finding with span and provenance and rejects one without', () => {
    expect(FindingSchema.safeParse(finding).success).toBe(true);
    const { provenance: _p, ...bare } = finding;
    expect(FindingSchema.safeParse(bare).success).toBe(false);
    expect(FindingSchema.safeParse({ ...finding, span: { blockKey: 'b', start: 5, end: 1 } }).success).toBe(
      false,
    );
  });

  it('validates a report', () => {
    const report = {
      draftVersionId: '3f1f3b2e-8d38-4d2f-9d57-0d7f2d5a1c11',
      graphRevision: 'a'.repeat(64),
      findings: [finding],
      counts: { error: 1, warn: 0, info: 0 },
    };
    expect(ConsistencyReportSchema.safeParse(report).success).toBe(true);
    expect(ConsistencyReportSchema.safeParse({ ...report, graphRevision: 'x' }).success).toBe(false);
  });

  it('applyFix needs the literal confirm: true', () => {
    const base = { draftVersionId: '3f1f3b2e-8d38-4d2f-9d57-0d7f2d5a1c11', findingId: 'f' };
    expect(ApplyFixRequestSchema.safeParse({ ...base, confirm: true }).success).toBe(true);
    expect(ApplyFixRequestSchema.safeParse(base).success).toBe(false);
    expect(ApplyFixRequestSchema.safeParse({ ...base, confirm: false }).success).toBe(false);
    expect(ApplyFixRequestSchema.safeParse({ ...base, confirm: 'true' }).success).toBe(false);
  });
});
