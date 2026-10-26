import { describe, expect, it } from 'vitest';

import {
  CloseEnquiryInput,
  ENQUIRY_STATUSES,
  EnquiryRetentionMonthsSchema,
  LogEnquiryInput,
  UpdateEnquiryInput,
} from './enquiry.ts';

describe('enquiry validators', () => {
  it('limits statuses to the six lifecycle states', () => {
    expect([...ENQUIRY_STATUSES]).toEqual([
      'logged',
      'checked',
      'accepted_as_matter',
      'declined',
      'referred',
      'closed',
    ]);
  });

  it('defaults channel and parties, and rejects unknown keys', () => {
    const parsed = LogEnquiryInput.parse({ enquirerName: 'A. Rao', summary: 'Tenancy dispute' });
    expect(parsed.channel).toBe('other');
    expect(parsed.parties).toEqual([]);
    expect(LogEnquiryInput.safeParse({ enquirerName: 'A', summary: 's', reply: 'x' }).success).toBe(
      false,
    );
  });

  it('requires E.164 phones and a known party side', () => {
    expect(
      LogEnquiryInput.safeParse({ enquirerName: 'A', summary: 's', phone: '98765' }).success,
    ).toBe(false);
    expect(
      LogEnquiryInput.safeParse({
        enquirerName: 'A',
        summary: 's',
        parties: [{ name: 'B', side: 'both' }],
      }).success,
    ).toBe(false);
  });

  it('cannot set accepted_as_matter or closed through an update', () => {
    const enquiryId = '11111111-1111-4111-8111-111111111111';
    expect(UpdateEnquiryInput.safeParse({ enquiryId, status: 'accepted_as_matter' }).success).toBe(
      false,
    );
    expect(UpdateEnquiryInput.safeParse({ enquiryId, status: 'closed' }).success).toBe(false);
    expect(UpdateEnquiryInput.safeParse({ enquiryId, status: 'declined' }).success).toBe(true);
    expect(CloseEnquiryInput.safeParse({ enquiryId }).success).toBe(true);
  });

  it('bounds the retention setting to 1..120 months', () => {
    expect(EnquiryRetentionMonthsSchema.safeParse(12).success).toBe(true);
    expect(EnquiryRetentionMonthsSchema.safeParse(0).success).toBe(false);
    expect(EnquiryRetentionMonthsSchema.safeParse(121).success).toBe(false);
  });
});
