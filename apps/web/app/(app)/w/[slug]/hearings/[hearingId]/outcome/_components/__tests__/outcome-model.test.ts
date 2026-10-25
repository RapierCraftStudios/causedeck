/* eslint-disable unicorn/filename-case -- the route segment `[hearingId]` is fixed by the issue's path */
import type { OutcomeProposal } from '@causedeck/validators/hearing-outcome';
import { describe, expect, it } from 'vitest';

import { blocker, parseTypedDate, toConfirmation, type OutcomeDraft } from '../outcome-model.ts';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const proposal = {
  hearingId: id(1),
  matterId: id(2),
  proceedingId: id(3),
  heldOn: '2026-03-02',
  state: 'ready',
  conflict: {
    currentListingId: id(4),
    currentDate: '2026-04-01',
    currentSource: 'Cause list',
    proposedListingId: null,
    proposedDate: '2026-04-10',
  },
  obligations: [id(5), id(6), id(7)].map((proposalId) => ({
    proposalId,
    description: 'File reply',
    dueDate: null,
    basis: null,
    anchorId: null,
    quote: null,
    ownerMemberId: null,
  })),
  tasks: [],
  transcriptRef: null,
  language: 'en',
  confirmed: false,
} as OutcomeProposal;

const draft = (over: Partial<OutcomeDraft> = {}): OutcomeDraft => ({
  summary: 'Adjourned',
  adjournmentReason: '',
  stageAfter: '',
  resolution: { kind: 'none' },
  obligations: Object.fromEntries(
    proposal.obligations.map((o) => [o.proposalId, { action: 'confirm' as const }]),
  ),
  tasks: {},
  ...over,
});

describe('parseTypedDate', () => {
  it('accepts a real dd/mm/yyyy and rejects the rest', () => {
    expect(parseTypedDate('05/03/2026')).toBe('2026-03-05');
    expect(parseTypedDate('31/02/2026')).toBeNull();
    expect(parseTypedDate('2026-03-05')).toBeNull();
  });
});

describe('blocker', () => {
  it('blocks until the next date is resolved, never from the proposal alone', () => {
    expect(blocker(proposal, draft({ resolution: { kind: 'unresolved' } }))).toBe('nextDate');
    expect(blocker(proposal, draft({ resolution: { kind: 'deferred' } }))).toBeNull();
    expect(blocker(proposal, draft())).toBeNull();
  });

  it('needs a choice while the confirmed proposal date conflicts', () => {
    const resolution = { kind: 'value', value: '2026-04-10', source: 'proposal' } as const;
    expect(blocker(proposal, draft({ resolution }))).toBe('conflict');
    expect(blocker(proposal, draft({ resolution, conflictChoice: 'current' }))).toBeNull();
  });

  it('needs every direction decided and a reason for a dismissal', () => {
    expect(blocker(proposal, draft({ obligations: {} }))).toBe('obligation');
    const [first] = proposal.obligations;
    const dismissed = {
      ...draft().obligations,
      [first?.proposalId ?? '']: { action: 'dismiss' as const },
    };
    expect(blocker(proposal, draft({ obligations: dismissed }))).toBe('obligation');
    dismissed[first?.proposalId ?? ''] = { action: 'dismiss', reason: 'Not applicable' };
    expect(blocker(proposal, draft({ obligations: dismissed }))).toBeNull();
  });

  it('needs the typed note', () => {
    expect(blocker(proposal, draft({ summary: ' ' }))).toBe('summary');
  });
});

describe('toConfirmation', () => {
  it('carries the date resolution and the decisions', () => {
    const out = toConfirmation(
      proposal,
      draft({ resolution: { kind: 'value', value: '2026-04-10', source: 'manual' } }),
    );
    expect(out.nextDate).toEqual({ kind: 'date', date: '2026-04-10', source: 'manual' });
    expect(out.obligations).toHaveLength(3);
  });
});
