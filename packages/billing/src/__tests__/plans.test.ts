import { describe, expect, it } from 'vitest';

import {
  checkPlanConfig,
  CLERK_SEAT_PRICE_PAISE,
  exceedsUpiMandateCap,
  getPlan,
  MIN_CHAMBER_SEATS,
  PLAN_CATALOGUE,
  UPI_AUTOPAY_MANDATE_CAP_PAISE,
  type Plan,
} from '../plans';

const fixed = (over: Partial<Plan>): Plan => ({
  id: 'test',
  name: 'Test',
  kind: 'dedicated',
  interval: 'year',
  pricePaise: 0,
  perSeat: false,
  clerkSeatPricePaise: null,
  minSeats: 1,
  active: true,
  limits: {
    maxActiveMatters: null,
    fairUse: { captureMinutesPerMonth: null, aiBudgetPaisePerMonth: null },
  },
  ...over,
});

describe('plan catalogue', () => {
  it('pins the catalogue numbers (integer paise, ex-GST)', () => {
    expect(
      PLAN_CATALOGUE.map((p) => [
        p.id,
        p.kind,
        p.interval,
        p.pricePaise,
        p.perSeat,
        p.clerkSeatPricePaise,
        p.minSeats,
        p.active,
      ]),
    ).toMatchInlineSnapshot(`
      [
        [
          "junior",
          "junior",
          "month",
          0,
          false,
          null,
          1,
          true,
        ],
        [
          "advocate-monthly-1",
          "advocate",
          "month",
          49900,
          false,
          null,
          1,
          true,
        ],
        [
          "advocate-monthly-2",
          "advocate",
          "month",
          79900,
          false,
          null,
          1,
          true,
        ],
        [
          "advocate-monthly-3",
          "advocate",
          "month",
          119900,
          false,
          null,
          1,
          true,
        ],
        [
          "advocate-annual-1",
          "advocate",
          "year",
          499000,
          false,
          null,
          1,
          true,
        ],
        [
          "advocate-annual-2",
          "advocate",
          "year",
          799000,
          false,
          null,
          1,
          true,
        ],
        [
          "advocate-annual-3",
          "advocate",
          "year",
          1199000,
          false,
          null,
          1,
          true,
        ],
        [
          "chamber-seat-1",
          "chamber",
          "month",
          49900,
          true,
          19900,
          3,
          true,
        ],
        [
          "chamber-seat-2",
          "chamber",
          "month",
          64900,
          true,
          19900,
          3,
          true,
        ],
        [
          "chamber-seat-3",
          "chamber",
          "month",
          89900,
          true,
          19900,
          3,
          true,
        ],
      ]
    `);
  });

  it('stores every price as non-negative integer paise', () => {
    for (const plan of PLAN_CATALOGUE) {
      expect(Number.isSafeInteger(plan.pricePaise), plan.id).toBe(true);
      expect(plan.pricePaise, plan.id).toBeGreaterThanOrEqual(0);
      if (plan.clerkSeatPricePaise !== null) {
        expect(Number.isSafeInteger(plan.clerkSeatPricePaise), plan.id).toBe(true);
      }
    }
  });

  it('has a free Junior plan with 15 active matters and fair-use caps', () => {
    const junior = getPlan('junior');
    expect(junior?.pricePaise).toBe(0);
    expect(junior?.limits.maxActiveMatters).toBe(15);
    expect(junior?.limits.fairUse.captureMinutesPerMonth).not.toBeNull();
    expect(junior?.limits.fairUse.aiBudgetPaisePerMonth).not.toBeNull();
  });

  it('prices each annual advocate plan at 10 months of its monthly tier', () => {
    for (const tier of [1, 2, 3]) {
      const monthly = getPlan(`advocate-monthly-${String(tier)}`);
      const annual = getPlan(`advocate-annual-${String(tier)}`);
      expect(annual?.pricePaise).toBe((monthly?.pricePaise ?? NaN) * 10);
    }
  });

  it('sells chamber plans per seat with a 3-seat minimum and a Rs 199 clerk seat', () => {
    const chamber = PLAN_CATALOGUE.filter((p) => p.kind === 'chamber');
    expect(chamber).toHaveLength(3);
    for (const plan of chamber) {
      expect(plan.perSeat).toBe(true);
      expect(plan.minSeats).toBe(MIN_CHAMBER_SEATS);
      expect(plan.clerkSeatPricePaise).toBe(CLERK_SEAT_PRICE_PAISE);
    }
    expect(MIN_CHAMBER_SEATS).toBe(3);
    expect(CLERK_SEAT_PRICE_PAISE).toBe(19_900);
  });

  it('is frozen, so prices change only in data', () => {
    expect(Object.isFrozen(PLAN_CATALOGUE)).toBe(true);
    for (const plan of PLAN_CATALOGUE) expect(Object.isFrozen(plan)).toBe(true);
  });
});

describe('checkPlanConfig', () => {
  it('reports no invalid plan and no over-cap fixed charge in the catalogue', () => {
    const codes = checkPlanConfig().map((f) => f.code);
    expect(codes).not.toContain('invalid');
    expect(codes).not.toContain('upi-mandate-cap-exceeded');
  });

  it('notes the seat count beyond which a chamber charge exceeds the UPI mandate cap', () => {
    const notes = checkPlanConfig().filter((f) => f.code === 'upi-mandate-cap-seats');
    expect(notes.map((f) => [f.planId, f.maxSeatsWithinCap])).toEqual([
      ['chamber-seat-1', 30],
      ['chamber-seat-2', 23],
      ['chamber-seat-3', 16],
    ]);
    // 17 seats at Rs 899 is above Rs 15,000.
    expect(exceedsUpiMandateCap(17 * 89_900)).toBe(true);
    expect(exceedsUpiMandateCap(16 * 89_900)).toBe(false);
  });

  it('flags a fixed charge above Rs 15,000 and not one at exactly Rs 15,000', () => {
    expect(UPI_AUTOPAY_MANDATE_CAP_PAISE).toBe(1_500_000);
    const over = checkPlanConfig([fixed({ id: 'over', pricePaise: 1_500_001 })]);
    expect(over.map((f) => f.code)).toEqual(['upi-mandate-cap-exceeded']);
    expect(over[0]?.message).toMatch(/mandate cap/);
    expect(checkPlanConfig([fixed({ id: 'at', pricePaise: 1_500_000 })])).toEqual([]);
  });

  it('flags a per-seat plan whose minimum seats already exceed the cap', () => {
    const findings = checkPlanConfig([
      fixed({ id: 'big-seat', perSeat: true, minSeats: 3, pricePaise: 600_000 }),
    ]);
    expect(findings.map((f) => f.code)).toEqual(['upi-mandate-cap-exceeded']);
  });

  it('flags invalid data', () => {
    const findings = checkPlanConfig([
      fixed({ id: 'fraction', pricePaise: 499.5 }),
      fixed({ id: 'negative', pricePaise: -1 }),
      fixed({ id: 'two-seats', perSeat: true, minSeats: 2, pricePaise: 49_900 }),
      fixed({ id: 'dup' }),
      fixed({ id: 'dup' }),
    ]);
    expect(findings.filter((f) => f.code === 'invalid').map((f) => f.planId)).toEqual([
      'fraction',
      'negative',
      'two-seats',
      'dup',
    ]);
  });
});
