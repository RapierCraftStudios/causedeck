import { describe, expect, it } from 'vitest';

import { FEE_GST_CONFIG, computeGst, feeGstMode } from '../fees/gst';

const base = { taxablePaise: 10_003, supplierState: '27', placeOfSupply: '27' } as const;

describe('computeGst (fees)', () => {
  it('regular intra-state splits CGST/SGST with the odd paisa on SGST', () => {
    const r = computeGst({ ...base, treatment: 'regular' });
    expect(r).toMatchObject({ cgst: 900, sgst: 901, igst: 0, rcmPaise: 0, total: 10_003 + 1801 });
  });
  it('regular inter-state is all IGST', () => {
    const r = computeGst({ ...base, placeOfSupply: '29', treatment: 'forward_charge' });
    expect(r).toMatchObject({ cgst: 0, sgst: 0, igst: 1801, total: 11_804 });
  });
  it('rcm computes the tax but leaves it out of the total', () => {
    const r = computeGst({ ...base, treatment: 'reverse_charge' });
    expect(r).toMatchObject({ igst: 0, rcmPaise: 1801, total: 10_003 });
  });
  it('exempt and unregistered charge nothing', () => {
    for (const treatment of ['exempt', 'nil_rated', 'pure_agent', 'unregistered'] as const) {
      expect(computeGst({ ...base, treatment })).toMatchObject({ total: 10_003, rcmPaise: 0 });
    }
  });
  it('rejects bad amounts and state codes', () => {
    expect(() => computeGst({ ...base, taxablePaise: 1.5, treatment: 'regular' })).toThrow(
      RangeError,
    );
    expect(() => computeGst({ ...base, taxablePaise: -1, treatment: 'regular' })).toThrow(
      RangeError,
    );
    expect(() => computeGst({ ...base, placeOfSupply: '99', treatment: 'regular' })).toThrow(
      RangeError,
    );
  });
  it('maps every validators treatment and keeps the config unreviewed', () => {
    expect(feeGstMode('out_of_scope')).toBe('exempt');
    expect(FEE_GST_CONFIG.reviewed).toBe(false);
    for (const rule of Object.values(FEE_GST_CONFIG.treatments)) expect(rule.reviewed).toBe(false);
  });
});
