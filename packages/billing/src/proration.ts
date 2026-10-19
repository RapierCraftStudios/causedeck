// Seat proration (#28 part 3, #202). A seat increase mid-cycle is charged immediately for the rest
// of the period; a decrease is never refunded and takes effect at the next cycle.
//
// Rule, per line (paid seats, clerk seats):
//   amount = round_half_up(added seats × unit price × remaining seconds / period seconds)
// in integer paise, computed with bigint so nothing is ever a float. The time basis is the actual
// period (`periodEnd - periodStart` in whole seconds), so 28/29/30/31-day months and leap years
// are exact. Each line is rounded on its own and the lines are summed.
import type { Plan } from './plans';
import type { SeatCounts } from './state-machine';

/** `numerator / denominator` rounded half up, for non-negative operands. */
export function roundHalfUpDiv(numerator: bigint, denominator: bigint): bigint {
  if (numerator < 0n || denominator <= 0n) {
    throw new RangeError('roundHalfUpDiv needs a non-negative numerator and positive denominator');
  }
  return (2n * numerator + denominator) / (2n * denominator);
}

export interface ProrationLine {
  kind: 'seat' | 'clerk_seat';
  /** Seats added (0 for a decrease). */
  quantity: number;
  unitPricePaise: number;
  amountPaise: number;
}

export interface ProrationResult {
  amountPaise: number;
  lines: ProrationLine[];
  remainingSeconds: number;
  periodSeconds: number;
}

export interface ProrateSeatIncreaseInput {
  plan: Pick<Plan, 'pricePaise' | 'clerkSeatPricePaise'>;
  from: SeatCounts;
  to: SeatCounts;
  periodStart: Date;
  periodEnd: Date;
  at: Date;
}

const wholeSeconds = (ms: number): number => Math.floor(ms / 1000);

/** The immediate charge for raising seats from `from` to `to` at `at` within the period. */
export function prorateSeatIncrease(input: ProrateSeatIncreaseInput): ProrationResult {
  const { plan, from, to, periodStart, periodEnd, at } = input;
  const start = periodStart.getTime();
  const end = periodEnd.getTime();
  if (!(end > start)) throw new RangeError('periodEnd must be after periodStart');
  if (at.getTime() < start || at.getTime() > end) {
    throw new RangeError('the change must fall within the current period');
  }
  const periodSeconds = wholeSeconds(end - start);
  const remainingSeconds = Math.min(Math.max(wholeSeconds(end - at.getTime()), 0), periodSeconds);

  const clerkAdded = Math.max(0, to.clerkSeats - from.clerkSeats);
  if (to.clerkSeats > 0 && plan.clerkSeatPricePaise === null) {
    throw new RangeError('this plan has no clerk seats');
  }

  const line = (kind: ProrationLine['kind'], quantity: number, unit: number): ProrationLine => ({
    kind,
    quantity,
    unitPricePaise: unit,
    amountPaise: Number(
      roundHalfUpDiv(
        BigInt(quantity) * BigInt(unit) * BigInt(remainingSeconds),
        BigInt(periodSeconds),
      ),
    ),
  });

  const lines = [line('seat', Math.max(0, to.seats - from.seats), plan.pricePaise)];
  if (plan.clerkSeatPricePaise !== null) {
    lines.push(line('clerk_seat', clerkAdded, plan.clerkSeatPricePaise));
  }
  const amountPaise = lines.reduce((sum, l) => sum + l.amountPaise, 0);
  if (!Number.isSafeInteger(amountPaise)) throw new RangeError('proration overflow');
  return { amountPaise, lines, remainingSeconds, periodSeconds };
}
