import { describe, expect, it } from 'vitest';

import {
  AcknowledgeHandoverInput,
  ChangeSummary,
  HandoverBody,
  NONE_RECORDED,
  SaveHandoverInput,
  ViewMarker,
} from './continuity';

const id = '00000000-0000-4000-8000-000000000001';
const noProvenance = {
  text: 'x',
  label: null,
  page_no: null,
  quote: null,
  source_type: 'document',
  source_ref: null,
  anchor_id: null,
  confidence: null,
  confirmation_state: 'confirmed',
};
const body = {
  matter_id: id,
  generated_at: '2026-10-26T00:00:00.000Z',
  synopsis: null,
  stages: [],
  last_orders: [],
  open_obligations: [],
  coming_up: [],
  key_documents: [],
  open_questions: [],
  open_questions_label: NONE_RECORDED,
};

describe('continuity schemas (#71)', () => {
  it('accepts an empty body labelled None recorded', () => {
    expect(HandoverBody.safeParse(body).success).toBe(true);
  });

  it('refuses a line without provenance', () => {
    expect(HandoverBody.safeParse({ ...body, key_documents: [noProvenance] }).success).toBe(false);
  });

  it('refuses more than three orders', () => {
    const order = { order_id: id, order_date: '2026-10-01', lines: [] };
    expect(
      HandoverBody.safeParse({ ...body, last_orders: [order, order, order, order] }).success,
    ).toBe(false);
  });

  it('refuses unknown keys, so no share or email field can ride along', () => {
    expect(
      SaveHandoverInput.safeParse({ matterId: id, recipientMemberId: id, shareLink: 'x' }).success,
    ).toBe(false);
    expect(AcknowledgeHandoverInput.safeParse({ handoverId: id, email: 'a@b.c' }).success).toBe(
      false,
    );
  });

  it('defaults the edits and questions on save', () => {
    const parsed = SaveHandoverInput.parse({ matterId: id, recipientMemberId: id });
    expect(parsed).toMatchObject({ edits: {}, openQuestions: [] });
  });

  it('parses a change summary and a view marker', () => {
    expect(
      ChangeSummary.safeParse({
        matter_id: id,
        since: body.generated_at,
        days_ago: 12,
        groups: [],
        total: 0,
      }).success,
    ).toBe(true);
    expect(
      ViewMarker.safeParse({
        matter_id: id,
        previous_viewed_at: null,
        viewed_at: body.generated_at,
        recorded: true,
      }).success,
    ).toBe(true);
  });
});
