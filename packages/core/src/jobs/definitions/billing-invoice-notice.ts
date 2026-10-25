// `billing.invoice-notice` (#255, #29 part 4): emails the `billing-notice` template (#23) for one
// issued SaaS invoice to the subscription's billing email, and to nobody else ("billing emails go
// only to the billing email on file"). `billing.invoice-render` enqueues it, with ids only, once
// the PDF is stored.
// - skips (logged) when the subscription has no billing email or the address is on the email
//   suppression list; the transport is never called for a suppressed address;
// - sends once per invoice: the singleton key stops duplicate jobs and `once()` stops a redelivered
//   job from sending again;
// - a permanent transport failure (e.g. SES `MessageRejected`) is logged and the job completes; any
//   other failure throws `RetryableError`, which rolls back the `once()` claim, and pg-boss retries.
// Logs carry ids and codes only, never the address.
import { serverEnv } from '@causedeck/config/env';
import { schema } from '@causedeck/db';
import {
  createEmailTransport,
  emailErrorCode,
  isPermanentEmailError,
  isSuppressed,
  preferencesUrl,
  renderEmail,
  type EmailTransport,
} from '@causedeck/notifications/email';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import type { JobContext } from '../context.ts';
import { defineJob, workspaceIdSchema } from '../define.ts';
import { RetryableError } from '../errors.ts';
import { once } from '../idempotency.ts';
import { getProducer } from '../producer.ts';

const { organization, saasInvoice, subscription } = schema;

export const billingInvoiceNoticeSchema = z.object({
  workspaceId: workspaceIdSchema,
  invoiceId: z.uuid(),
});

export type BillingInvoiceNoticePayload = z.output<typeof billingInvoiceNoticeSchema>;

export type InvoiceNoticeOutcome =
  'sent' | 'already_sent' | 'missing' | 'no_billing_email' | 'suppressed' | 'failed';

export interface InvoiceNoticeDeps {
  email: EmailTransport;
  appUrl: string;
}

let defaults: InvoiceNoticeDeps | undefined;

function invoiceNoticeDeps(log: JobContext['log']): InvoiceNoticeDeps {
  if (defaults === undefined) {
    const env = serverEnv();
    defaults = { email: createEmailTransport(env, log), appUrl: env.APP_URL };
  }
  return defaults;
}

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' });

/** Send the notice for one invoice. Exported for tests. */
export async function runBillingInvoiceNotice(
  ctx: JobContext,
  { workspaceId, invoiceId }: BillingInvoiceNoticePayload,
  deps: InvoiceNoticeDeps = invoiceNoticeDeps(ctx.log),
): Promise<InvoiceNoticeOutcome> {
  const fields = { workspaceId, invoiceId };
  const [row] = await ctx.db
    .select({
      number: saasInvoice.number,
      status: saasInvoice.status,
      totalPaise: saasInvoice.totalPaise,
      billingEmail: subscription.billingEmail,
      slug: organization.slug,
    })
    .from(saasInvoice)
    .innerJoin(organization, eq(organization.id, saasInvoice.workspaceId))
    .leftJoin(
      subscription,
      and(
        eq(subscription.id, saasInvoice.subscriptionId),
        eq(subscription.workspaceId, saasInvoice.workspaceId),
      ),
    )
    .where(and(eq(saasInvoice.id, invoiceId), eq(saasInvoice.workspaceId, workspaceId)));

  const done = (outcome: InvoiceNoticeOutcome, extra: object = {}) => {
    ctx.log.info({ ...fields, outcome, ...extra }, 'billing invoice notice');
    return outcome;
  };
  if (!row || row.number === null || row.status === 'draft' || row.status === 'void') {
    return done('missing');
  }
  const to = row.billingEmail?.trim() ?? '';
  if (to === '') return done('no_billing_email');
  if (await isSuppressed(ctx.db, to)) return done('suppressed');

  const number = row.number;
  const href = new URL(`/w/${encodeURIComponent(row.slug)}/billing`, deps.appUrl).toString();
  const result = await once(ctx, invoiceId, async () => {
    const email = await renderEmail('billing-notice', {
      title: `Tax invoice ${number}`,
      body: `Your CauseDeck tax invoice ${number} for ${inr.format(row.totalPaise / 100)} is ready. Download the PDF from the billing page.`,
      href,
      preferencesUrl: preferencesUrl(deps.appUrl),
    });
    try {
      await deps.email.send({ to, ...email, tags: { category: 'billing.notice' } });
      return 'sent' as const;
    } catch (error) {
      const code = emailErrorCode(error);
      if (isPermanentEmailError(error)) {
        ctx.log.warn({ ...fields, code }, 'billing invoice notice rejected');
        return 'failed' as const;
      }
      throw new RetryableError('BILLING_NOTICE_RETRY', `notice failed (${code}); will retry`);
    }
  });
  return done(result.skipped ? 'already_sent' : result.value);
}

/**
 * Send one `billing.invoice-notice` job as the registry's `enqueue` does (schema, singleton key,
 * workspace fairness group). The registry imports the render job, which calls this.
 */
export async function enqueueInvoiceNotice(job: BillingInvoiceNoticePayload): Promise<unknown> {
  const data = billingInvoiceNoticeSchema.parse(job);
  const sender = await getProducer();
  return sender.send('billing.invoice-notice', data, {
    singletonKey: data.invoiceId,
    group: { id: data.workspaceId },
  });
}

export const billingInvoiceNotice = defineJob({
  name: 'billing.invoice-notice',
  schema: billingInvoiceNoticeSchema,
  singleton: { key: (payload) => payload.invoiceId },
  idempotencyKey: (payload) => payload.invoiceId,
  handler: async (ctx, payload) => {
    await runBillingInvoiceNotice(ctx, payload);
  },
});
