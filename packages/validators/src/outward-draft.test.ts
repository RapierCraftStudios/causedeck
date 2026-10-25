import { describe, expect, it } from 'vitest';

import { DraftEdit, DraftRequest, ShareRecord } from './outward-draft';

const uuid = '11111111-1111-4111-8111-111111111111';
const base = { matterId: uuid, hearingId: uuid, audience: 'senior_counsel' } as const;

describe('outward draft inputs', () => {
  it('needs a hearing or an order and rejects unknown keys', () => {
    expect(DraftRequest.safeParse(base).success).toBe(true);
    expect(DraftRequest.safeParse({ ...base, orderId: uuid, hearingId: undefined }).success).toBe(
      true,
    );
    expect(DraftRequest.safeParse({ ...base, hearingId: undefined }).success).toBe(false);
    expect(DraftRequest.safeParse({ ...base, send: true }).success).toBe(false);
  });

  it('requires the client contact for a client audience and only then', () => {
    expect(DraftRequest.safeParse({ ...base, audience: 'client' }).success).toBe(false);
    expect(
      DraftRequest.safeParse({ ...base, audience: 'client', clientPersonId: uuid }).success,
    ).toBe(true);
    expect(DraftRequest.safeParse({ ...base, clientPersonId: uuid }).success).toBe(false);
  });

  it('rejects a third-party audience, an unknown language and an unknown tone', () => {
    expect(DraftRequest.safeParse({ ...base, audience: 'opposing_party' }).success).toBe(false);
    expect(DraftRequest.safeParse({ ...base, language: 'hi' }).success).toBe(false);
    expect(DraftRequest.safeParse({ ...base, tone: 'casual' }).success).toBe(false);
    for (const language of ['en', 'ta', 'kn']) {
      expect(DraftRequest.safeParse({ ...base, language }).success).toBe(true);
    }
  });

  it('validates edits and share records', () => {
    expect(DraftEdit.safeParse({ draftId: uuid, body: '  ' }).success).toBe(false);
    expect(DraftEdit.safeParse({ draftId: uuid, body: 'Hello' }).success).toBe(true);
    expect(ShareRecord.safeParse({ draftId: uuid, channel: 'mailto' }).success).toBe(true);
    expect(ShareRecord.safeParse({ draftId: uuid, channel: 'smtp' }).success).toBe(false);
  });
});
