import { describe, expect, it } from 'vitest';

import {
  Brief,
  BriefLine,
  ContextPassage,
  MarkPreparedInput,
  Readiness,
  SetBriefNoteInput,
  SetCarryItemInput,
} from './brief';

const id = '11111111-1111-4111-8111-111111111111';

const line = {
  text: 'Counter to be filed',
  label: null,
  page_no: 2,
  quote: 'file the counter',
  source_type: 'document',
  source_ref: null,
  anchor_id: id,
  confidence: 0.9,
  confirmation_state: 'confirmed',
};

describe('brief schemas', () => {
  it('requires provenance on a line unless it is manual', () => {
    expect(BriefLine.safeParse(line).success).toBe(true);
    expect(BriefLine.safeParse({ ...line, anchor_id: null }).success).toBe(false);
    expect(BriefLine.safeParse({ ...line, anchor_id: null, source_ref: 'listing:1' }).success).toBe(
      true,
    );
    expect(
      BriefLine.safeParse({ ...line, anchor_id: null, source_type: 'manual', confidence: null })
        .success,
    ).toBe(true);
  });

  it('rejects unknown keys and out-of-range confidence', () => {
    expect(BriefLine.safeParse({ ...line, extra: 1 }).success).toBe(false);
    expect(BriefLine.safeParse({ ...line, confidence: 1.2 }).success).toBe(false);
  });

  it('caps the context at five passages', () => {
    const passage = { document_id: id, anchor_id: null, page_no: 1, quote: 'q' };
    expect(ContextPassage.safeParse(passage).success).toBe(true);
    const base = {
      listing_id: id,
      matter_id: id,
      proceeding_id: id,
      assembled_at: '2026-10-25T00:00:00.000Z',
      sensitive: false,
      ai_used: false,
      stage: null,
      last_order: [],
      obligations: { open: [], closed_count: 0 },
      carry: [],
      synopsis: null,
      last_hearing: null,
      court_notes: null,
      prepared: null,
      note: null,
      carry_reviewed: false,
    };
    expect(Brief.safeParse({ ...base, context: Array(5).fill(passage) }).success).toBe(true);
    expect(Brief.safeParse({ ...base, context: Array(6).fill(passage) }).success).toBe(false);
  });

  it('bounds the readiness score', () => {
    const segments = {
      stage_known: true,
      last_order_confirmed: true,
      obligations_reconciled: true,
      carry_reviewed: true,
    };
    expect(Readiness.safeParse({ score: 100, segments, reasons: [] }).success).toBe(true);
    expect(Readiness.safeParse({ score: 101, segments, reasons: [] }).success).toBe(false);
  });

  it('validates the inputs', () => {
    expect(MarkPreparedInput.safeParse({ listingId: id }).success).toBe(true);
    expect(MarkPreparedInput.safeParse({ listingId: 'x' }).success).toBe(false);
    expect(SetCarryItemInput.safeParse({ listingId: id, action: 'add', label: ' ' }).success).toBe(
      false,
    );
    expect(
      SetCarryItemInput.safeParse({ listingId: id, action: 'tick', key: 'doc:1', ticked: true })
        .success,
    ).toBe(true);
    expect(SetBriefNoteInput.safeParse({ listingId: id, note: null }).success).toBe(true);
  });
});
