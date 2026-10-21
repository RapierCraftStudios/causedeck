// Dunning policy (#28 part 6, #205). Pure: no I/O and no clock reads. The daily
// `system.billing.dunning-tick` job reads each `past_due` subscription, asks `planDunning` what is
// due and carries it out: a provider retry, a state-machine event and the `billing.notice` stages.
//
//   day 0  payment fails ─▶ past_due        notice `payment_failed`
//   day 1, 3, 5, 7       ─▶ retry 1..4       notice `retry_<k>`
//   day 8 (still unpaid) ─▶ halted ─▶ grace  notice `grace_started` (GRACE_PERIOD_DAYS full access)
//   grace_until          ─▶ grace_expired ─▶ downgraded   notice `downgraded` (read-only Junior)
//
// The provider may halt the subscription earlier (`subscription.halted` webhook); grace then
// starts from that halt. A charge at any point (`subscription.charged`) ends dunning. Nothing here
// deletes data: a downgraded workspace keeps everything, read-only.
import {
  GRACE_PERIOD_DAYS,
  type SubscriptionEvent,
  type SubscriptionSnapshot,
} from './state-machine';

/** Days after the first failed charge on which dunning retries the payment. */
export const DUNNING_RETRY_DAYS = [1, 3, 5, 7] as const;

/** Day the subscription enters grace when still unpaid: one day after the last retry, so its result can arrive. */
export const DUNNING_HALT_DAY = 8;

export const DUNNING_STAGES = [
  'payment_failed',
  'retry_1',
  'retry_2',
  'retry_3',
  'retry_4',
  'grace_started',
  'downgraded',
] as const;
export type DunningStage = (typeof DUNNING_STAGES)[number];

const DAY_MS = 86_400_000;

export interface DunningInput {
  snapshot: SubscriptionSnapshot;
  /** When the subscription entered dunning (`subscription.dunning_started_at`). */
  dunningStartedAt: Date | null;
  /** Retries made so far in this episode (`subscription.dunning_attempts`). */
  attempts: number;
  now: Date;
}

export interface DunningPlan {
  /** Retry the payment through the provider now. */
  retry: boolean;
  /** The retry number (1-based) to record when `retry` is set. */
  attempt: number | null;
  /** The state-machine event to apply, if any. */
  event: Extract<SubscriptionEvent, { type: 'halted' } | { type: 'grace_expired' }> | null;
  /** Notice stages to send (idempotent through `dunningDedupeKey`). */
  notices: DunningStage[];
}

const NOTHING: DunningPlan = Object.freeze({
  retry: false,
  attempt: null,
  event: null,
  notices: [],
});

/** What is due for one subscription at `now`. */
export function planDunning(input: DunningInput): DunningPlan {
  const { snapshot, dunningStartedAt, now } = input;
  if (dunningStartedAt === null) return NOTHING;
  const attempts = Math.max(0, input.attempts);

  if (snapshot.state === 'grace') {
    if (snapshot.graceUntil !== null && now.getTime() >= snapshot.graceUntil.getTime()) {
      return {
        retry: false,
        attempt: null,
        event: { type: 'grace_expired' },
        notices: ['grace_started', 'downgraded'],
      };
    }
    return { retry: false, attempt: null, event: null, notices: ['grace_started'] };
  }
  if (snapshot.state !== 'past_due') return NOTHING;

  const elapsed = now.getTime() - dunningStartedAt.getTime();
  const notices: DunningStage[] = ['payment_failed'];

  // The highest retry that is due, so a late tick skips ahead instead of retrying several times.
  let due = 0;
  DUNNING_RETRY_DAYS.forEach((day, i) => {
    if (elapsed >= day * DAY_MS) due = i + 1;
  });
  if (due > attempts) {
    notices.push(`retry_${String(due)}` as DunningStage);
    return { retry: true, attempt: due, event: null, notices };
  }

  if (attempts >= DUNNING_RETRY_DAYS.length && elapsed >= DUNNING_HALT_DAY * DAY_MS) {
    notices.push('grace_started');
    return { retry: false, attempt: null, event: { type: 'halted' }, notices };
  }
  return { retry: false, attempt: null, event: null, notices };
}

/** The notification `dedupeKey` for a stage of one dunning episode. */
export function dunningDedupeKey(
  subscriptionId: string,
  dunningStartedAt: Date,
  stage: DunningStage,
): string {
  return `billing.dunning:${subscriptionId}:${String(dunningStartedAt.getTime())}:${stage}`;
}

export interface DunningNoticeCopy {
  title: string;
  body: string;
}

/** The in-app and email copy for a stage. No amounts or payment details. */
export function dunningNoticeCopy(
  stage: DunningStage,
  { planName }: { planName: string },
): DunningNoticeCopy {
  switch (stage) {
    case 'payment_failed':
      return {
        title: 'Your subscription payment did not go through',
        body: `We could not collect the payment for your ${planName} plan. We will retry it over the next 7 days. Nothing changes in your workspace meanwhile.`,
      };
    case 'retry_1':
    case 'retry_2':
    case 'retry_3':
    case 'retry_4': {
      const n = Number(stage.slice('retry_'.length));
      return {
        title: `Payment retry ${String(n)} of ${String(DUNNING_RETRY_DAYS.length)}`,
        body: `We retried the payment for your ${planName} plan. If it does not go through, check your UPI Autopay mandate in billing settings.`,
      };
    }
    case 'grace_started':
      return {
        title: `Your workspace has a ${String(GRACE_PERIOD_DAYS)}-day grace period`,
        body: `The payment for your ${planName} plan could not be collected. Your workspace keeps full access for ${String(GRACE_PERIOD_DAYS)} days. After that it becomes read-only. No data is deleted.`,
      };
    case 'downgraded':
      return {
        title: 'Your workspace is now read-only',
        body: `The grace period for your ${planName} plan has ended, so the workspace is on Junior limits and read-only. No data is deleted. Start a new subscription to restore full access.`,
      };
  }
}
