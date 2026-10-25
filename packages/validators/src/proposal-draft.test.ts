import { describe, expect, it } from 'vitest';

import { PROPOSAL_KINDS, ProposalDraftSchema } from './proposal-draft';

const base = {
  kind: 'task',
  source: { type: 'manual', input: 'form' },
  payload: { title: 'Call the client' },
} as const;

describe('ProposalDraftSchema', () => {
  it('accepts a minimal draft and defaults anchors to none', () => {
    const parsed = ProposalDraftSchema.parse(base);
    expect(parsed.anchors).toEqual([]);
  });

  it('rejects a kind that is not in the closed list', () => {
    for (const kind of ['send_email', 'e_file', 'pay_fee', 'insert_citation']) {
      expect(ProposalDraftSchema.safeParse({ ...base, kind }).success, kind).toBe(false);
    }
  });

  it('registers hearing_outcome and accepts a voice hearing draft', () => {
    expect(PROPOSAL_KINDS).toContain('hearing_outcome');
    const parsed = ProposalDraftSchema.safeParse({
      kind: 'hearing_outcome',
      source: { type: 'ai', input: 'voice' },
      payload: { outcome: 'adjourned' },
    });
    expect(parsed.success).toBe(true);
  });

  it('has no kind that sends, files, pays, advises or cites', () => {
    const banned =
      /(^|_)(send|file|e_file|pay|advise|accept_engagement|insert_citation|generate_citation|auto_reply)(_|$)/;
    expect(PROPOSAL_KINDS.filter((kind) => banned.test(kind))).toEqual([]);
  });

  it('rejects unknown keys, an out-of-range confidence and a malformed pattern key', () => {
    expect(ProposalDraftSchema.safeParse({ ...base, extra: 1 }).success).toBe(false);
    expect(ProposalDraftSchema.safeParse({ ...base, confidence: 1.2 }).success).toBe(false);
    expect(ProposalDraftSchema.safeParse({ ...base, patternKey: 'Bad Key' }).success).toBe(false);
  });
});
