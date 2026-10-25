// Subscription state machine (#28 part 3, #202). Pure: no I/O and no clock reads, so every
// transition is a function of (snapshot, event, now) and is table-tested. Provider webhooks (#204)
// and dunning (#205) feed it events; callers persist the returned snapshot.
//
//   created ──activated|charged──▶ active ──payment_failed──▶ past_due ──halted──▶ grace
//                                   ▲  │                         │                  │
//                                   │  └──halted─────────────────┼──────────────────┤
//                                   └──────────charged───────────┴──────────────────┤
//                                                                     grace_expired │
//   active ◀──resumed── paused ◀──paused── active                                   ▼
//   any live state ──cancelled──▶ cancelled                                     downgraded
//
// `cancelled` and `downgraded` are terminal: a workspace starts a new subscription instead.
// `grace` keeps full access until `graceUntil` (GRACE_PERIOD_DAYS after the halt); `downgraded`
// drops to read-only Junior limits (#203), never deleting data.
//
// The DB status enum (`plans.ts` SUBSCRIPTION_STATUSES) has no `created`, `grace` or `downgraded`,
// so `toSubscriptionStatus` / `fromSubscriptionRow` map them: created ↔ trialing, grace ↔
// past_due with `grace_until` set, downgraded ↔ expired.
import type { SubscriptionStatus } from './plans';
import type { RazorpayWebhookEvent } from './provider/types';

export const SUBSCRIPTION_STATES = [
  'created',
  'active',
  'past_due',
  'grace',
  'downgraded',
  'cancelled',
  'paused',
] as const;
export type SubscriptionState = (typeof SUBSCRIPTION_STATES)[number];

export const TERMINAL_STATES: readonly SubscriptionState[] = ['cancelled', 'downgraded'];

/** Full access continues for this many days after the provider halts the subscription. */
export const GRACE_PERIOD_DAYS = 7;

const DAY_MS = 86_400_000;

export interface SeatCounts {
  seats: number;
  clerkSeats: number;
}

export interface SubscriptionSnapshot {
  state: SubscriptionState;
  planId: string;
  seats: number;
  clerkSeats: number;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  graceUntil: Date | null;
  cancelAtPeriodEnd: boolean;
  /** A seat decrease scheduled for the next cycle; applied on the next `charged`. */
  pendingSeats: Readonly<SeatCounts> | null;
  providerSubscriptionId: string | null;
  providerCustomerId: string | null;
}

/** A new billing period from the provider. Null bounds keep the current period. */
interface PeriodEvent {
  periodStart: Date | null;
  periodEnd: Date | null;
  /** The provider's (paid seat) quantity for the new period. */
  quantity?: number;
}

export type SubscriptionEvent =
  | ({ type: 'activated' } & PeriodEvent)
  | ({ type: 'charged' } & PeriodEvent)
  | { type: 'payment_failed' }
  | { type: 'halted' }
  | { type: 'paused' }
  | { type: 'resumed' }
  | { type: 'cancelled' }
  | { type: 'completed' }
  | { type: 'grace_expired' }
  | ({ type: 'seats_changed'; effective: 'now' | 'period_end' } & SeatCounts)
  | { type: 'plan_changed'; planId: string }
  | { type: 'cancel_requested'; atPeriodEnd: boolean }
  | { type: 'cancel_withdrawn' };

export type SubscriptionEventType = SubscriptionEvent['type'];

export const SUBSCRIPTION_EVENT_TYPES: readonly SubscriptionEventType[] = [
  'activated',
  'charged',
  'payment_failed',
  'halted',
  'paused',
  'resumed',
  'cancelled',
  'completed',
  'grace_expired',
  'seats_changed',
  'plan_changed',
  'cancel_requested',
  'cancel_withdrawn',
];

type Moves = Partial<Record<SubscriptionEventType, SubscriptionState>>;

const LIVE_CHANGES = (state: SubscriptionState): Moves => ({
  seats_changed: state,
  plan_changed: state,
  cancelled: 'cancelled',
});

/**
 * Legal moves: state → event → next state. A pair missing here is illegal. Two moves depend on the
 * event as well: `cancel_requested` with `atPeriodEnd: false` is a `cancelled`, and `charged` with
 * `cancelAtPeriodEnd` set ends the subscription (`cancelled`).
 */
export const TRANSITIONS: Readonly<Record<SubscriptionState, Readonly<Moves>>> = Object.freeze({
  created: { ...LIVE_CHANGES('created'), activated: 'active', charged: 'active' },
  active: {
    ...LIVE_CHANGES('active'),
    charged: 'active',
    payment_failed: 'past_due',
    halted: 'grace',
    paused: 'paused',
    completed: 'cancelled',
    cancel_requested: 'active',
    cancel_withdrawn: 'active',
  },
  past_due: {
    ...LIVE_CHANGES('past_due'),
    charged: 'active',
    payment_failed: 'past_due',
    halted: 'grace',
    completed: 'cancelled',
    cancel_requested: 'past_due',
  },
  grace: {
    ...LIVE_CHANGES('grace'),
    charged: 'active',
    grace_expired: 'downgraded',
    completed: 'cancelled',
    cancel_requested: 'grace',
  },
  paused: { resumed: 'active', cancelled: 'cancelled' },
  downgraded: {},
  cancelled: {},
});

export class IllegalTransitionError extends Error {
  readonly code = 'ILLEGAL_TRANSITION';
  readonly from: SubscriptionState;
  readonly event: SubscriptionEventType;

  constructor(from: SubscriptionState, event: SubscriptionEventType, reason?: string) {
    super(`Illegal subscription transition: ${event} from ${from}${reason ? ` (${reason})` : ''}`);
    this.name = 'IllegalTransitionError';
    this.from = from;
    this.event = event;
  }
}

/** The next state for a legal move, or `null`. Ignores event-dependent outcomes. */
export function nextState(
  state: SubscriptionState,
  event: SubscriptionEventType,
): SubscriptionState | null {
  return TRANSITIONS[state][event] ?? null;
}

function assertSeatCounts(counts: SeatCounts): void {
  if (!Number.isSafeInteger(counts.seats) || counts.seats < 1) {
    throw new RangeError('seats must be an integer of at least 1');
  }
  if (!Number.isSafeInteger(counts.clerkSeats) || counts.clerkSeats < 0) {
    throw new RangeError('clerkSeats must be a non-negative integer');
  }
}

function freezeSnapshot(snapshot: SubscriptionSnapshot): SubscriptionSnapshot {
  if (snapshot.pendingSeats) Object.freeze(snapshot.pendingSeats);
  return Object.freeze(snapshot);
}

/** Apply one event. Returns a new frozen snapshot; throws `IllegalTransitionError` when illegal. */
export function transition(
  snapshot: SubscriptionSnapshot,
  event: SubscriptionEvent,
  now: Date,
): SubscriptionSnapshot {
  if (event.type === 'cancel_requested' && !event.atPeriodEnd) {
    return transition(snapshot, { type: 'cancelled' }, now);
  }
  const from = snapshot.state;
  const to = nextState(from, event.type);
  if (to === null) throw new IllegalTransitionError(from, event.type);

  const next: SubscriptionSnapshot = { ...snapshot, state: to };
  switch (event.type) {
    case 'activated':
    case 'charged': {
      next.currentPeriodStart = event.periodStart ?? snapshot.currentPeriodStart;
      next.currentPeriodEnd = event.periodEnd ?? snapshot.currentPeriodEnd;
      next.graceUntil = null;
      if (event.type === 'charged' && snapshot.pendingSeats) {
        next.seats = snapshot.pendingSeats.seats;
        next.clerkSeats = snapshot.pendingSeats.clerkSeats;
        next.pendingSeats = null;
      } else if (event.quantity !== undefined) {
        assertSeatCounts({ seats: event.quantity, clerkSeats: snapshot.clerkSeats });
        next.seats = event.quantity;
      }
      if (event.type === 'charged' && snapshot.cancelAtPeriodEnd) {
        return endSubscription(next);
      }
      break;
    }
    case 'halted':
      next.graceUntil = new Date(now.getTime() + GRACE_PERIOD_DAYS * DAY_MS);
      break;
    case 'grace_expired':
      if (snapshot.graceUntil === null || now.getTime() < snapshot.graceUntil.getTime()) {
        throw new IllegalTransitionError(from, event.type, 'grace period has not ended');
      }
      break;
    case 'cancelled':
    case 'completed':
      return endSubscription(next);
    case 'seats_changed': {
      const counts = { seats: event.seats, clerkSeats: event.clerkSeats };
      assertSeatCounts(counts);
      if (event.effective === 'now') {
        next.seats = counts.seats;
        next.clerkSeats = counts.clerkSeats;
        next.pendingSeats = null;
      } else {
        next.pendingSeats = counts;
      }
      break;
    }
    case 'plan_changed':
      if (event.planId.length === 0) throw new RangeError('planId must not be empty');
      next.planId = event.planId;
      break;
    case 'cancel_requested':
      next.cancelAtPeriodEnd = true;
      break;
    case 'cancel_withdrawn':
      next.cancelAtPeriodEnd = false;
      break;
    case 'payment_failed':
    case 'paused':
    case 'resumed':
      break;
  }
  return freezeSnapshot(next);
}

function endSubscription(next: SubscriptionSnapshot): SubscriptionSnapshot {
  return freezeSnapshot({
    ...next,
    state: 'cancelled',
    cancelAtPeriodEnd: false,
    pendingSeats: null,
    graceUntil: null,
  });
}

function toDate(unixSeconds: number | null | undefined): Date | null {
  return unixSeconds === null || unixSeconds === undefined ? null : new Date(unixSeconds * 1000);
}

/** Map a Razorpay webhook body to a state-machine event; `null` for events that change nothing. */
export function fromProviderEvent(body: RazorpayWebhookEvent): SubscriptionEvent | null {
  const entity = body.payload.subscription?.entity;
  const period = (): PeriodEvent => ({
    periodStart: toDate(entity?.current_start),
    periodEnd: toDate(entity?.current_end),
    ...(entity ? { quantity: entity.quantity } : {}),
  });
  switch (body.event) {
    case 'subscription.activated':
      return { type: 'activated', ...period() };
    case 'subscription.charged':
      return { type: 'charged', ...period() };
    case 'subscription.pending':
    case 'payment.failed':
      return { type: 'payment_failed' };
    case 'subscription.halted':
      return { type: 'halted' };
    case 'subscription.paused':
      return { type: 'paused' };
    case 'subscription.resumed':
      return { type: 'resumed' };
    case 'subscription.cancelled':
      return { type: 'cancelled' };
    case 'subscription.completed':
      return { type: 'completed' };
    default:
      // `payment.captured` (the charge arrives as `subscription.charged`) and unknown events.
      return null;
  }
}

/** Apply a provider webhook body. Events that change nothing return the snapshot unchanged. */
export function applyProviderEvent(
  snapshot: SubscriptionSnapshot,
  body: RazorpayWebhookEvent,
  now: Date,
): SubscriptionSnapshot {
  const event = fromProviderEvent(body);
  return event === null ? snapshot : transition(snapshot, event, now);
}

const STATUS_BY_STATE: Record<SubscriptionState, SubscriptionStatus> = {
  created: 'trialing',
  active: 'active',
  past_due: 'past_due',
  grace: 'past_due',
  downgraded: 'expired',
  cancelled: 'cancelled',
  paused: 'paused',
};

/** The `subscription.status` column value for a state (grace is past_due with `grace_until`). */
export function toSubscriptionStatus(state: SubscriptionState): SubscriptionStatus {
  return STATUS_BY_STATE[state];
}

/** The `subscription` row fields the state machine reads. */
export interface SubscriptionRowLike {
  status: SubscriptionStatus;
  planId: string;
  seats: number;
  clerkSeats: number;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  graceUntil: Date | null;
  cancelAtPeriodEnd: boolean;
  providerSubscriptionId: string | null;
  providerCustomerId: string | null;
  pendingSeats?: SeatCounts | null;
}

/** Rebuild a snapshot from a stored row; the inverse of `toSubscriptionStatus`. */
export function fromSubscriptionRow(row: SubscriptionRowLike): SubscriptionSnapshot {
  const state: SubscriptionState =
    row.status === 'trialing'
      ? 'created'
      : row.status === 'expired'
        ? 'downgraded'
        : row.status === 'past_due' && row.graceUntil !== null
          ? 'grace'
          : row.status;
  return freezeSnapshot({
    state,
    planId: row.planId,
    seats: row.seats,
    clerkSeats: row.clerkSeats,
    currentPeriodStart: row.currentPeriodStart,
    currentPeriodEnd: row.currentPeriodEnd,
    graceUntil: row.graceUntil,
    cancelAtPeriodEnd: row.cancelAtPeriodEnd,
    pendingSeats: row.pendingSeats ? { ...row.pendingSeats } : null,
    providerSubscriptionId: row.providerSubscriptionId,
    providerCustomerId: row.providerCustomerId,
  });
}
