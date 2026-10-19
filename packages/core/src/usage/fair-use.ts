// Fair-use caps (#221, #30 part 4): Junior's active matters, OCR pages and STT seconds, read from
// the workspace entitlements (#203). Callers check before starting the work:
//
//   await assertWithinFairUse(ctx, 'ocr.pages', pages);
//   await assertWithinFairUse(ctx, 'matters.active', 1, { current: activeMatters });
//
// OCR and STT caps are per IST month: the period's metered usage counts, and `FAIR_USE_EXCEEDED`
// carries the next period start as `resetAt`. Active matters are a level, not a monthly total, so
// the caller passes the live count and `resetAt` is null. A `null` entitlement means unlimited.
import { getPlan, type LimitKey } from '@causedeck/billing';
import { withWorkspace } from '@causedeck/db';

import { getWorkspaceEntitlements } from '../billing/entitlements.ts';
import type { UsageKey } from './keys.ts';
import { getUsage, type UsageContext } from './meter.ts';
import { nextPeriodStart, USAGE_TIME_ZONE } from './period.ts';

export const FAIR_USE_KEYS = [
  'matters.active',
  'ocr.pages',
  'stt.seconds',
] as const satisfies readonly UsageKey[];
export type FairUseKey = (typeof FAIR_USE_KEYS)[number];

interface FairUseCap {
  entitlement: Extract<LimitKey, 'max_active_matters' | 'ocr_pages' | 'capture_minutes'>;
  /** Metered units per entitlement unit (`capture_minutes` is metered in seconds). */
  unitsPer: number;
  monthly: boolean;
}

export const FAIR_USE_CAPS: Readonly<Record<FairUseKey, FairUseCap>> = Object.freeze({
  'matters.active': { entitlement: 'max_active_matters', unitsPer: 1, monthly: false },
  'ocr.pages': { entitlement: 'ocr_pages', unitsPer: 1, monthly: true },
  'stt.seconds': { entitlement: 'capture_minutes', unitsPer: 60, monthly: true },
});

const RESET_DATE = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: USAGE_TIME_ZONE,
});

function fairUseMessage(key: FairUseKey, cap: number, planName: string, resetAt: Date | null) {
  const resets = resetAt === null ? '' : ` It resets on ${RESET_DATE.format(resetAt)}.`;
  switch (key) {
    case 'matters.active':
      return `You have reached the ${planName} plan's limit of ${String(cap)} active matters. Close a matter or upgrade to add another.`;
    case 'ocr.pages':
      return `You have reached this month's OCR page limit on the ${planName} plan (${String(cap)} pages).${resets}`;
    case 'stt.seconds':
      return `You have reached this month's transcription limit on the ${planName} plan (${String(cap / 60)} minutes).${resets}`;
  }
}

export class FairUseError extends Error {
  readonly code = 'FAIR_USE_EXCEEDED';
  readonly key: FairUseKey;
  /** The cap, in the key's metered units. */
  readonly limit: number;
  readonly used: number;
  readonly requested: number;
  /** When a monthly cap resets (next IST period start); null for active matters. */
  readonly resetAt: Date | null;

  constructor(v: {
    key: FairUseKey;
    limit: number;
    used: number;
    requested: number;
    resetAt: Date | null;
    planName: string;
  }) {
    super(fairUseMessage(v.key, v.limit, v.planName, v.resetAt));
    this.name = 'FairUseError';
    this.key = v.key;
    this.limit = v.limit;
    this.used = v.used;
    this.requested = v.requested;
    this.resetAt = v.resetAt;
  }
}

/** Throw `FAIR_USE_EXCEEDED` unless `amount` more of `key` stays within the workspace's cap. */
export async function assertWithinFairUse(
  ctx: UsageContext,
  key: FairUseKey,
  amount: number,
  opts: { current?: number } = {},
): Promise<void> {
  const cap = (FAIR_USE_CAPS as Partial<Record<string, FairUseCap>>)[key];
  if (cap === undefined) throw new TypeError(`fair use: unknown key ${JSON.stringify(key)}`);
  if (!Number.isSafeInteger(amount) || amount < 1) {
    throw new TypeError('fair use: amount must be a positive safe integer');
  }
  if (
    !cap.monthly &&
    (opts.current === undefined || !Number.isSafeInteger(opts.current) || opts.current < 0)
  ) {
    throw new TypeError(`fair use: ${key} needs the current count as a non-negative integer`);
  }
  const now = ctx.now?.() ?? new Date();
  const { workspaceId } = ctx;
  const entitlements = await withWorkspace(ctx.db, { workspaceId }, (tx) =>
    getWorkspaceEntitlements(tx, workspaceId, now),
  );
  const granted = entitlements[cap.entitlement];
  if (granted === null) return;
  const limit = granted * cap.unitsPer;
  const used = cap.monthly ? await getUsage({ ...ctx, now: () => now }, key) : (opts.current ?? 0);
  if (used + amount <= limit) return;
  throw new FairUseError({
    key,
    limit,
    used,
    requested: amount,
    resetAt: cap.monthly ? nextPeriodStart(now) : null,
    planName: getPlan(entitlements.planId)?.name ?? entitlements.planId,
  });
}
