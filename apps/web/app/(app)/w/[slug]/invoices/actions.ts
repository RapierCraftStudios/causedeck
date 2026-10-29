'use server';
// Fee server actions (#871, #83 part 4). Each goes through `workspaceAction`: zod input,
// `requireSession`, membership and the advocate-level policy action (`fee.write`, `fee.read` for
// the preview), so a clerk, junior or viewer gets FORBIDDEN before anything runs. The legal-gated
// `invoices.enabled` flag is read first: off means NOT_FOUND, as if the feature did not exist (core
// would answer FORBIDDEN, which would reveal it). These record money only: nothing is sent,
// charged or transferred, and a final invoice is never edited (a correction is a credit note).
// - `createFeeAgreementAction`, `setFeeAgreementStatusAction`: the fee terms for a matter.
// - `previewInvoiceAction`: the priced, non-persisted preview.
// - `saveInvoiceDraftAction`, `discardInvoiceDraftAction`, `issueInvoiceAction`: the invoice draft.
import type { FeePreview } from '@causedeck/core/fees';
import { FeeAgreementInput, InvoiceInput } from '@causedeck/validators/fees';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { feesDeps } from '../../../../../lib/fees/fees-deps.ts';
import { ActionError, type Result } from '../../../../../lib/safe-action.ts';
import {
  WorkspaceScoped,
  workspaceAction,
  type WorkspaceActionCtx,
} from '../../../../../lib/workspace-action.ts';

function actorOf(ctx: WorkspaceActionCtx) {
  return { workspaceId: ctx.workspaceId, userId: ctx.userId };
}

async function requireFlag(ctx: WorkspaceActionCtx): Promise<void> {
  const { isEnabled } = await import('@causedeck/flags/server');
  const on = await isEnabled('invoices.enabled', {
    workspaceId: ctx.workspaceId,
    userId: ctx.userId,
  });
  if (!on) throw new ActionError('NOT_FOUND', '');
}

/** Core's `FeesDisabledError` (its own flag read) is a refusal: FORBIDDEN, a backstop. */
async function guarded<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof Error && error.name === 'FeesDisabledError') {
      throw new ActionError('FORBIDDEN', '');
    }
    throw error;
  }
}

function revalidateFees(): void {
  revalidatePath('/w/[slug]/invoices', 'layout');
}

const SupplierInput = z.strictObject({
  name: z.string().trim().min(1).max(200),
  stateCode: z.string().regex(/^[0-9]{2}$/),
  gstin: z.string().trim().max(15).nullish(),
});

/** What a mutation returns: ids and the number, never the amounts or notes. */
export interface SavedFee {
  id: string;
  number?: string;
  status: string;
}

const WRITE = { action: 'fee.write' } as const;
const READ = { action: 'fee.read' } as const;

const createAgreement = workspaceAction(
  WorkspaceScoped.extend({ agreement: FeeAgreementInput }),
  async (input, ctx): Promise<SavedFee> => {
    await requireFlag(ctx);
    const { createFeeAgreement } = await import('@causedeck/core/fees');
    const result = await guarded(() =>
      createFeeAgreement(feesDeps(ctx.tx), actorOf(ctx), input.agreement),
    );
    revalidateFees();
    return result.status === 'created'
      ? { id: result.agreement.id, status: result.agreement.status }
      : { id: result.proposalId, status: 'proposed' };
  },
  WRITE,
);

export async function createFeeAgreementAction(raw: unknown): Promise<Result<SavedFee>> {
  return createAgreement(raw);
}

const setAgreementStatus = workspaceAction(
  WorkspaceScoped.extend({ agreementId: z.uuid(), status: z.enum(['active', 'ended']) }),
  async (input, ctx): Promise<SavedFee> => {
    await requireFlag(ctx);
    const { setFeeAgreementStatus } = await import('@causedeck/core/fees');
    const row = await guarded(() =>
      setFeeAgreementStatus(feesDeps(ctx.tx), actorOf(ctx), {
        agreementId: input.agreementId,
        status: input.status,
      }),
    );
    revalidateFees();
    return { id: row.id, status: row.status };
  },
  WRITE,
);

export async function setFeeAgreementStatusAction(raw: unknown): Promise<Result<SavedFee>> {
  return setAgreementStatus(raw);
}

const preview = workspaceAction(
  WorkspaceScoped.extend({ invoice: InvoiceInput, supplier: SupplierInput }),
  async (input, ctx): Promise<FeePreview> => {
    await requireFlag(ctx);
    const { prepareFeeInvoice } = await import('@causedeck/core/fees');
    return guarded(() =>
      prepareFeeInvoice(feesDeps(ctx.tx), actorOf(ctx), {
        invoice: input.invoice,
        supplier: input.supplier,
      }),
    );
  },
  READ,
);

export async function previewInvoiceAction(raw: unknown): Promise<Result<FeePreview>> {
  return preview(raw);
}

const saveDraft = workspaceAction(
  WorkspaceScoped.extend({
    invoiceId: z.uuid().optional(),
    invoice: InvoiceInput,
    supplier: SupplierInput,
  }),
  async (input, ctx): Promise<SavedFee> => {
    await requireFlag(ctx);
    const fees = await import('@causedeck/core/fees');
    const deps = feesDeps(ctx.tx);
    const body = { invoice: input.invoice, supplier: input.supplier };
    const row = await guarded(() =>
      input.invoiceId === undefined
        ? fees.createDraftInvoice(deps, actorOf(ctx), body)
        : fees.updateDraftInvoice(deps, actorOf(ctx), { invoiceId: input.invoiceId, ...body }),
    );
    revalidateFees();
    return { id: row.id, status: row.status };
  },
  WRITE,
);

export async function saveInvoiceDraftAction(raw: unknown): Promise<Result<SavedFee>> {
  return saveDraft(raw);
}

const discardDraft = workspaceAction(
  WorkspaceScoped.extend({ invoiceId: z.uuid() }),
  async (input, ctx): Promise<{ id: string }> => {
    await requireFlag(ctx);
    const { discardDraftInvoice } = await import('@causedeck/core/fees');
    await guarded(() =>
      discardDraftInvoice(feesDeps(ctx.tx), actorOf(ctx), { invoiceId: input.invoiceId }),
    );
    revalidateFees();
    return { id: input.invoiceId };
  },
  WRITE,
);

export async function discardInvoiceDraftAction(raw: unknown): Promise<Result<{ id: string }>> {
  return discardDraft(raw);
}

const issue = workspaceAction(
  WorkspaceScoped.extend({
    invoiceId: z.uuid(),
    supplier: SupplierInput,
    acknowledgeUnreviewedGst: z.boolean().optional(),
  }),
  async (input, ctx): Promise<SavedFee> => {
    await requireFlag(ctx);
    const { issueInvoice } = await import('@causedeck/core/fees');
    const row = await guarded(() =>
      issueInvoice(feesDeps(ctx.tx), actorOf(ctx), {
        invoiceId: input.invoiceId,
        supplier: input.supplier,
        ...(input.acknowledgeUnreviewedGst === undefined
          ? {}
          : { acknowledgeUnreviewedGst: input.acknowledgeUnreviewedGst }),
      }),
    );
    revalidateFees();
    return { id: row.id, status: row.status, ...(row.number ? { number: row.number } : {}) };
  },
  WRITE,
);

export async function issueInvoiceAction(raw: unknown): Promise<Result<SavedFee>> {
  return issue(raw);
}
