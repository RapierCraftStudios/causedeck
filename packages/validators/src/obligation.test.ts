import { describe, expect, it } from 'vitest';

import {
  AllocateRegistryNumberInput,
  CloseInput,
  ObligationInput,
  ObligationPatch,
  QueueQuery,
} from './obligation';

const uuid = '11111111-1111-4111-8111-111111111111';
const base = {
  matterId: uuid,
  source: 'internal',
  description: 'File the counter affidavit',
  dueDate: '2026-11-05',
  ownerMemberId: uuid,
  provenance: { sourceType: 'manual' },
} as const;

describe('obligation inputs', () => {
  it('requires provenance and a source for a non-manual fact', () => {
    expect(ObligationInput.safeParse(base).success).toBe(true);
    expect(ObligationInput.safeParse({ ...base, provenance: undefined }).success).toBe(false);
    expect(ObligationInput.safeParse({ ...base, provenance: { sourceType: 'ai' } }).success).toBe(
      false,
    );
    expect(
      ObligationInput.safeParse({ ...base, provenance: { sourceType: 'ai', sourceRef: 'order p2' } })
        .success,
    ).toBe(true);
  });

  it('accepts an undated task and rejects a missing due date key', () => {
    expect(ObligationInput.safeParse({ ...base, dueDate: null }).success).toBe(true);
    const { dueDate: _dueDate, ...without } = base;
    expect(ObligationInput.safeParse(without).success).toBe(false);
  });

  it('needs a reason to reschedule', () => {
    expect(ObligationPatch.safeParse({ dueDate: '2026-11-09' }).success).toBe(false);
    expect(ObligationPatch.safeParse({ dueDate: '2026-11-09', reason: 'Court adjourned' }).success)
      .toBe(true);
    expect(ObligationPatch.safeParse({}).success).toBe(false);
  });

  it('needs words to close as not applicable', () => {
    expect(CloseInput.safeParse({ reason: 'not_applicable' }).success).toBe(false);
    expect(CloseInput.safeParse({ reason: 'not_applicable', note: '  ' }).success).toBe(false);
    expect(CloseInput.safeParse({ reason: 'not_applicable', note: 'Superseded' }).success).toBe(
      true,
    );
    expect(CloseInput.safeParse({ reason: 'lawyer_action' }).success).toBe(true);
    expect(CloseInput.safeParse({ reason: 'whatever' }).success).toBe(false);
  });

  it('rejects unknown keys and an empty registry allocation', () => {
    expect(QueueQuery.safeParse({ nope: 1 }).success).toBe(false);
    expect(AllocateRegistryNumberInput.safeParse({ proceedingId: uuid }).success).toBe(false);
    expect(AllocateRegistryNumberInput.safeParse({ proceedingId: uuid, srNo: 'SR 12' }).success)
      .toBe(true);
  });
});
