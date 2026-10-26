import type { Brief, BriefLine } from '@causedeck/validators';
import { describe, expect, it } from 'vitest';

import { computeReadiness } from '../readiness.ts';

const id = '00000000-0000-4000-8000-000000000001';
const line = (state: BriefLine['confirmation_state']): BriefLine => ({
  text: 'x',
  label: null,
  page_no: 1,
  quote: 'x',
  source_type: 'document',
  source_ref: null,
  anchor_id: id,
  confidence: 0.9,
  confirmation_state: state,
});

function brief(over: Partial<Brief> = {}): Brief {
  return {
    listing_id: id,
    matter_id: id,
    proceeding_id: id,
    assembled_at: '2026-10-25T00:00:00.000Z',
    sensitive: false,
    ai_used: false,
    stage: line('confirmed'),
    last_order: [line('confirmed')],
    obligations: { open: [], closed_count: 0 },
    carry: [],
    synopsis: null,
    last_hearing: null,
    court_notes: null,
    context: [],
    prepared: null,
    note: null,
    carry_reviewed: true,
    ...over,
  };
}

describe('computeReadiness (R7)', () => {
  it('scores 100 with no reasons when every segment holds', () => {
    expect(computeReadiness(brief())).toMatchObject({ score: 100, reasons: [] });
  });

  it('gives a reason per missing segment and 25 points per segment', () => {
    const r = computeReadiness(
      brief({
        stage: null,
        last_order: [line('proposed')],
        carry_reviewed: false,
        obligations: {
          open: [
            {
              obligation_id: id,
              text: 'counter not yet filed; due 20 Oct',
              owner_member_id: null,
              due_date: '2026-10-20',
              status: 'open',
              overdue: true,
              source_type: 'document',
              source_ref: null,
              anchor_id: id,
              confidence: null,
              confirmation_state: 'confirmed',
            },
          ],
          closed_count: 0,
        },
      }),
    );
    expect(r.score).toBe(0);
    expect(r.reasons.map((x) => x.segment).sort()).toEqual([
      'carry_reviewed',
      'last_order_confirmed',
      'obligations_reconciled',
      'stage_known',
    ]);
    expect(r.reasons.every((x) => x.reason.length > 0)).toBe(true);
  });

  it('reports a missing order distinctly', () => {
    const r = computeReadiness(brief({ last_order: [] }));
    expect(r.score).toBe(75);
    expect(r.reasons[0]?.reason).toMatch(/No order/);
  });
});
