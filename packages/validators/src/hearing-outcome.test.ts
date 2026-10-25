import { describe, expect, it } from 'vitest';

import {
  ManualOutcomeInput,
  OutcomeConfirmation,
  OutcomeProposal,
  nextDateRejection,
} from './hearing-outcome';

const id = '11111111-1111-4111-8111-111111111111';
const base = {
  hearingId: id,
  outcome: 'Adjourned for arguments',
  nextDate: { kind: 'none' },
} as const;

describe('OutcomeConfirmation', () => {
  it('needs an explicit next date resolution', () => {
    const withoutDate = { hearingId: base.hearingId, outcome: base.outcome };
    expect(OutcomeConfirmation.safeParse(withoutDate).success).toBe(false);
    expect(OutcomeConfirmation.safeParse(base).success).toBe(true);
    expect(
      OutcomeConfirmation.safeParse({ ...base, nextDate: { kind: 'to_be_notified' } }).success,
    ).toBe(true);
  });

  it('needs a reason to dismiss an obligation, and a description for a typed one', () => {
    const dismiss = { proposalId: id, action: 'dismiss' };
    expect(OutcomeConfirmation.safeParse({ ...base, obligations: [dismiss] }).success).toBe(false);
    expect(
      OutcomeConfirmation.safeParse({
        ...base,
        obligations: [{ ...dismiss, reason: 'not applicable' }],
      }).success,
    ).toBe(true);
    expect(
      OutcomeConfirmation.safeParse({ ...base, obligations: [{ action: 'confirm' }] }).success,
    ).toBe(false);
  });

  it('the manual path takes no proposals', () => {
    expect(ManualOutcomeInput.safeParse(base).success).toBe(true);
    expect(ManualOutcomeInput.safeParse({ ...base, obligations: [] }).success).toBe(false);
  });
});

describe('nextDateRejection', () => {
  const proposed = { kind: 'date', date: '2026-11-10', source: 'proposal' } as const;

  it('rejects a proposal date absent from every anchored source, with a visible reason', () => {
    expect(nextDateRejection(proposed, ['2026-11-03'])).toMatch(/Enter it yourself/);
    expect(nextDateRejection(proposed, [])).not.toBeNull();
  });

  it('accepts an anchored date and a manual one', () => {
    expect(nextDateRejection(proposed, ['2026-11-10'])).toBeNull();
    expect(nextDateRejection({ ...proposed, source: 'manual' }, [])).toBeNull();
    expect(nextDateRejection({ kind: 'none' }, [])).toBeNull();
  });
});

describe('OutcomeProposal', () => {
  const proposal = {
    hearingId: id,
    matterId: id,
    proceedingId: id,
    heldOn: '2026-10-12',
    state: 'ready',
    transcriptRef: null,
    language: 'en',
  };

  it('refuses a next date line without an anchor', () => {
    const line = { value: '2026-11-03', quote: null, source: 'voice' };
    expect(OutcomeProposal.safeParse({ ...proposal, nextDate: line }).success).toBe(false);
    expect(
      OutcomeProposal.safeParse({ ...proposal, nextDate: { ...line, anchorId: id } }).success,
    ).toBe(true);
  });
});
