'use server';
// Billing page server actions (#257). Each goes through `workspaceAction` (zod input,
// `requireSession`, membership) with the owner-only `billing.manage` permission asserted by `guard`
// before the handler runs, so a non-owner gets FORBIDDEN. The handlers call the database adapter
// (`@causedeck/core/billing` subscription actions) on the workspace-scoped transaction `ctx.tx`
// with the process-wide billing service (`lib/billing-provider.ts`).
//
// Expected failures come back as data (`{ error }`), translated by the dialogs: an invalid GSTIN
// (`invalidGstinFormat` or `invalidGstinChecksum`), an invalid change (`invalid`), a change the
// subscription's state does not allow (`notAllowed`) and a provider that cannot do it
// (`unsupported`, Razorpay cannot withdraw a scheduled cancellation). Errors are matched by name, so
// this module never loads the provider SDK eagerly.
import type { Transaction } from '@causedeck/db';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import type { Result } from '../../../../../lib/safe-action.ts';
import { WorkspaceScoped, workspaceAction } from '../../../../../lib/workspace-action.ts';

const SeatCounts = {
  seats: z.number().int().min(1).max(10_000),
  clerkSeats: z.number().int().min(0).max(10_000),
};

const ChangeSeats = WorkspaceScoped.extend({ slug: z.string().min(1), ...SeatCounts });
const ChangePlan = ChangeSeats.extend({ planId: z.string().min(1).max(64) });
const Quote = WorkspaceScoped.extend({ planId: z.string().min(1).max(64), ...SeatCounts });
const SlugOnly = WorkspaceScoped.extend({ slug: z.string().min(1) });
const SaveGstin = SlugOnly.extend({ gstin: z.string().max(32) });

export type BillingActionError =
  'invalidGstinFormat' | 'invalidGstinChecksum' | 'invalid' | 'notAllowed' | 'unsupported';

export type BillingActionOutcome<T = object> =
  ({ error?: undefined } & T) | { error: BillingActionError };

/** The confirm-step summary. Amounts in integer paise and formatted (`formatInr`). */
export interface QuoteView {
  basePaise: number;
  gstPaise: number;
  totalPaise: number;
  prorationPaise: number;
  prorationGstPaise: number;
  prorationTotalPaise: number;
  effective: 'now' | 'period_end';
  formatted: {
    base: string;
    gst: string;
    total: string;
    proration: string;
    prorationGst: string;
    prorationTotal: string;
    effectiveDate: string;
  };
}

const errorName = (error: unknown) => (error instanceof Error ? error.name : '');

/** A known billing failure as its `BillingActionError`; anything else is rethrown. */
async function toOutcome(error: unknown, gstin?: string): Promise<{ error: BillingActionError }> {
  switch (errorName(error)) {
    case 'InvalidGstinError': {
      const { GSTIN_PATTERN } = await import('@causedeck/billing/gstin');
      const value = (gstin ?? '').trim().toUpperCase();
      return { error: GSTIN_PATTERN.test(value) ? 'invalidGstinChecksum' : 'invalidGstinFormat' };
    }
    case 'BillingServiceError':
      return { error: 'invalid' };
    case 'IllegalTransitionError':
      return { error: 'notAllowed' };
    case 'BillingProviderError': {
      const code = (error as { code?: unknown }).code;
      if (code === 'unsupported') return { error: 'unsupported' };
      if (code === 'invalid_state') return { error: 'notAllowed' };
      if (code === 'invalid_input') return { error: 'invalid' };
      throw error;
    }
    default:
      throw error;
  }
}

async function context(ctx: { tx: Transaction; workspaceId: string; userId: string }) {
  const { billingServiceFor } = await import('../../../../../lib/billing-provider.ts');
  return {
    tx: ctx.tx,
    workspaceId: ctx.workspaceId,
    actorUserId: ctx.userId,
    service: billingServiceFor,
  };
}

const refresh = (slug: string) => {
  revalidatePath(`/w/${slug}/billing`);
};

/** The summary for changing to `planId` with these seats (the current plan for a seat change). */
export const quoteChange: (
  raw: unknown,
) => Promise<Result<BillingActionOutcome<{ quote: QuoteView }>>> = workspaceAction(
  Quote,
  async (input, ctx) => {
    const [{ quoteSubscriptionChange }, { formatDate, formatInr }] = await Promise.all([
      import('@causedeck/core/billing'),
      import('@causedeck/i18n'),
    ]);
    try {
      const quote = await quoteSubscriptionChange(ctx.tx, ctx.workspaceId, {
        planId: input.planId,
        seats: input.seats,
        clerkSeats: input.clerkSeats,
      });
      return {
        quote: {
          basePaise: quote.basePaise,
          gstPaise: quote.gstPaise,
          totalPaise: quote.totalPaise,
          prorationPaise: quote.prorationPaise,
          prorationGstPaise: quote.prorationGstPaise,
          prorationTotalPaise: quote.prorationTotalPaise,
          effective: quote.effective,
          formatted: {
            base: formatInr(quote.basePaise),
            gst: formatInr(quote.gstPaise),
            total: formatInr(quote.totalPaise),
            proration: formatInr(quote.prorationPaise),
            prorationGst: formatInr(quote.prorationGstPaise),
            prorationTotal: formatInr(quote.prorationTotalPaise),
            effectiveDate: formatDate(quote.effectiveDate),
          },
        },
      };
    } catch (error) {
      if (errorName(error) === 'WorkspaceError') return { error: 'invalid' as const };
      return toOutcome(error);
    }
  },
  { action: 'billing.manage' },
);

export const changeSeats: (raw: unknown) => Promise<Result<BillingActionOutcome>> = workspaceAction(
  ChangeSeats,
  async (input, ctx) => {
    const { changeSubscriptionSeats } = await import('@causedeck/core/billing');
    try {
      await changeSubscriptionSeats(await context(ctx), {
        seats: input.seats,
        clerkSeats: input.clerkSeats,
      });
    } catch (error) {
      return toOutcome(error);
    }
    refresh(input.slug);
    return {};
  },
  { action: 'billing.manage' },
);

export const changePlan: (raw: unknown) => Promise<Result<BillingActionOutcome>> = workspaceAction(
  ChangePlan,
  async (input, ctx) => {
    const { changeSubscriptionPlan } = await import('@causedeck/core/billing');
    try {
      await changeSubscriptionPlan(await context(ctx), {
        planId: input.planId,
        seats: input.seats,
        clerkSeats: input.clerkSeats,
      });
    } catch (error) {
      return toOutcome(error);
    }
    refresh(input.slug);
    return {};
  },
  { action: 'billing.manage' },
);

export const cancelAtPeriodEnd: (raw: unknown) => Promise<Result<BillingActionOutcome>> =
  workspaceAction(
    SlugOnly,
    async (input, ctx) => {
      const { cancelSubscriptionAtPeriodEnd } = await import('@causedeck/core/billing');
      try {
        await cancelSubscriptionAtPeriodEnd(await context(ctx));
      } catch (error) {
        return toOutcome(error);
      }
      refresh(input.slug);
      return {};
    },
    { action: 'billing.manage' },
  );

/** Resume a paused subscription, or keep one that was set to cancel at period end. */
export const resumeSubscription: (raw: unknown) => Promise<Result<BillingActionOutcome>> =
  workspaceAction(
    SlugOnly,
    async (input, ctx) => {
      const core = await import('@causedeck/core/billing');
      try {
        await core.resumeSubscription(await context(ctx));
      } catch (error) {
        return toOutcome(error);
      }
      refresh(input.slug);
      return {};
    },
    { action: 'billing.manage' },
  );

/** Save (or clear, when empty) the GSTIN. Future invoices only; issued ones never change. */
export const saveGstin: (
  raw: unknown,
) => Promise<Result<BillingActionOutcome<{ gstin: string | null }>>> = workspaceAction(
  SaveGstin,
  async (input, ctx) => {
    const { setSubscriptionGstin } = await import('@causedeck/core/billing');
    try {
      const gstin = await setSubscriptionGstin(await context(ctx), input.gstin);
      refresh(input.slug);
      return { gstin };
    } catch (error) {
      return toOutcome(error, input.gstin);
    }
  },
  { action: 'billing.manage' },
);
