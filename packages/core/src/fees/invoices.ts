// Fee invoice services (#83 part 3). Lifecycle: a draft is editable; `prepareFeeInvoice` is the
// non-persisted priced preview ("prepared"); `issueInvoice` allocates the gapless `FE/YY-YY/NNNNNN`
// number and makes the invoice final, after which it is immutable (only payments and credit notes
// follow; a correction is a credit entry, never an edit, ADR 0048). While the GST config is
// unreviewed (`reviewed: false`, #120) only an owner can issue, and only with an explicit
// acknowledgement, which is audited. Records money only: nothing is sent or moved.
import {
  FEE_GST_CONFIG,
  numberInvoice,
  prepareInvoice,
  type FeeSupplier,
  type PreparedFeeInvoice,
} from '@causedeck/billing/fees';
import { financialYear } from '@causedeck/billing/invoice/numbering';
import { schema } from '@causedeck/db';
import { InvoiceInput, PaymentRecord } from '@causedeck/validators/fees';
import { and, asc, desc, eq, like, sql } from 'drizzle-orm';
import { z } from 'zod';

import { record } from '../audit/index.ts';
import { conflict, forbidden, invalid, notFound } from '../shared/errors.ts';

import { requireMatterAndPerson } from './agreements.ts';
import { insertLedgerEntry } from './ledger.ts';
import {
  auditCtx,
  parseFeeInput,
  withFees,
  type FeesActor,
  type FeesDeps,
  type FeesScope,
} from './scope.ts';

const { feeInvoice, feeInvoiceLine, clientLedgerEntry, payment, feeAgreement } = schema;

export type FeeInvoiceRow = typeof feeInvoice.$inferSelect;
export type FeeInvoiceLineRow = typeof feeInvoiceLine.$inferSelect;
export interface FeeInvoiceView extends FeeInvoiceRow {
  lines: FeeInvoiceLineRow[];
}

export interface FeePreview {
  invoice: PreparedFeeInvoice;
  /** True while the GST config or a treatment used is `reviewed: false`: issuing needs an owner's acknowledgement. */
  gstUnreviewed: boolean;
}

const SupplierSchema = z.strictObject({
  name: z.string().trim().min(1),
  stateCode: z.string().regex(/^[0-9]{2}$/),
  gstin: z.string().nullish(),
});
const DraftInput = z.strictObject({ invoice: z.unknown(), supplier: SupplierSchema });
const UpdateDraftInput = z.strictObject({
  invoiceId: z.uuid(),
  invoice: z.unknown(),
  supplier: SupplierSchema,
});
const IssueInput = z.strictObject({
  invoiceId: z.uuid(),
  supplier: SupplierSchema,
  /** The owner's acknowledgement that GST rates and treatments are unreviewed placeholders. */
  acknowledgeUnreviewedGst: z.boolean().optional(),
});
const InvoiceId = z.strictObject({ invoiceId: z.uuid() });
const CreditNoteInput = z.strictObject({
  invoiceId: z.uuid(),
  amountPaise: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  reason: z.string().trim().min(1).max(500),
  occurredOn: z.iso.date(),
});
const ListInput = z
  .strictObject({ matterId: z.uuid().optional(), personId: z.uuid().optional() })
  .default({});

/** True when this invoice's GST rests on a config or treatment not yet reviewed by counsel and a CA. */
export function isGstUnreviewed(prepared: PreparedFeeInvoice): boolean {
  if (!FEE_GST_CONFIG.reviewed) return true;
  const treatments = FEE_GST_CONFIG.treatments as Record<string, { reviewed: boolean } | undefined>;
  return prepared.lines.some((line) => treatments[line.gst.mode]?.reviewed !== true);
}

function toFeeSupplier(s: z.output<typeof SupplierSchema>): FeeSupplier {
  return { name: s.name, stateCode: s.stateCode, gstin: s.gstin ?? null };
}

/** The priced preview of `input`, not stored. */
export async function prepareFeeInvoice(
  deps: FeesDeps,
  actor: FeesActor,
  input: { invoice: unknown; supplier: unknown },
): Promise<FeePreview> {
  return withFees(deps, actor, 'fee.read', () => {
    const data = parseFeeInput(DraftInput, input);
    const invoice = priced(data.invoice, data.supplier);
    return Promise.resolve({ invoice, gstUnreviewed: isGstUnreviewed(invoice) });
  });
}

function priced(invoice: unknown, supplier: z.output<typeof SupplierSchema>): PreparedFeeInvoice {
  const parsed = InvoiceInput.safeParse(invoice);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue && issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
    throw invalid(`${where}${issue?.message ?? 'Invalid invoice'}`);
  }
  return prepareInvoice(parsed.data, toFeeSupplier(supplier));
}

async function loadInvoice(scope: FeesScope, invoiceId: string): Promise<FeeInvoiceRow> {
  const [row] = await scope.tx
    .select()
    .from(feeInvoice)
    .where(and(eq(feeInvoice.workspaceId, scope.actor.workspaceId), eq(feeInvoice.id, invoiceId)));
  if (row === undefined) throw notFound('Invoice not found');
  return row;
}

async function linesOf(scope: FeesScope, invoiceId: string): Promise<FeeInvoiceLineRow[]> {
  return scope.tx
    .select()
    .from(feeInvoiceLine)
    .where(
      and(
        eq(feeInvoiceLine.workspaceId, scope.actor.workspaceId),
        eq(feeInvoiceLine.invoiceId, invoiceId),
      ),
    )
    .orderBy(asc(feeInvoiceLine.position), asc(feeInvoiceLine.id));
}

function requireDraft(row: FeeInvoiceRow): void {
  if (row.status !== 'draft') throw conflict('An issued invoice is final and cannot be changed');
}

async function requireAgreement(scope: FeesScope, input: z.output<typeof InvoiceInput>) {
  if (input.feeAgreementId === undefined) return;
  const [row] = await scope.tx
    .select({
      id: feeAgreement.id,
      matterId: feeAgreement.matterId,
      personId: feeAgreement.personId,
    })
    .from(feeAgreement)
    .where(
      and(
        eq(feeAgreement.workspaceId, scope.actor.workspaceId),
        eq(feeAgreement.id, input.feeAgreementId),
      ),
    );
  if (row === undefined) throw notFound('Fee agreement not found');
  if (row.matterId !== input.matterId || row.personId !== input.personId) {
    throw conflict('The fee agreement belongs to another matter or client');
  }
}

async function writeLines(
  scope: FeesScope,
  invoiceId: string,
  input: z.output<typeof InvoiceInput>,
): Promise<void> {
  await scope.tx
    .delete(feeInvoiceLine)
    .where(
      and(
        eq(feeInvoiceLine.workspaceId, scope.actor.workspaceId),
        eq(feeInvoiceLine.invoiceId, invoiceId),
      ),
    );
  await scope.tx.insert(feeInvoiceLine).values(
    input.lines.map((line, position) => ({
      workspaceId: scope.actor.workspaceId,
      invoiceId,
      position,
      description: line.description,
      quantity: line.quantity,
      unitPricePaise: line.unitPricePaise,
      amountPaise: line.amountPaise,
      gstTreatment: line.gstTreatment,
      sac: line.sac ?? null,
    })),
  );
}

function headerValues(input: z.output<typeof InvoiceInput>, prepared: PreparedFeeInvoice) {
  return {
    matterId: input.matterId,
    personId: input.personId,
    feeAgreementId: input.feeAgreementId ?? null,
    placeOfSupplyStateCode: input.placeOfSupplyStateCode,
    recipientGstin: input.recipientGstin ?? null,
    dueDate: input.dueDate ?? null,
    taxablePaise: prepared.taxablePaise,
    taxPaise: prepared.cgst + prepared.sgst + prepared.igst,
    totalPaise: prepared.totalPaise,
  };
}

async function view(scope: FeesScope, row: FeeInvoiceRow): Promise<FeeInvoiceView> {
  return { ...row, lines: await linesOf(scope, row.id) };
}

export async function createDraftInvoice(
  deps: FeesDeps,
  actor: FeesActor,
  input: { invoice: unknown; supplier: unknown },
): Promise<FeeInvoiceView> {
  return withFees(deps, actor, 'fee.write', async (scope) => {
    const data = parseFeeInput(DraftInput, input);
    const prepared = priced(data.invoice, data.supplier);
    const parsed = InvoiceInput.parse(data.invoice);
    await requireMatterAndPerson(scope, parsed.matterId, parsed.personId);
    await requireAgreement(scope, parsed);
    const [row] = await scope.tx
      .insert(feeInvoice)
      .values({
        workspaceId: actor.workspaceId,
        createdBy: actor.userId,
        ...headerValues(parsed, prepared),
      })
      .returning();
    if (row === undefined) throw new Error('fee_invoice insert returned no row');
    await writeLines(scope, row.id, parsed);
    await record(auditCtx(scope), {
      action: 'fee.invoice_drafted',
      target: { kind: 'fee_invoice', id: row.id },
      metadata: { lines: parsed.lines.length },
    });
    return view(scope, row);
  });
}

export async function updateDraftInvoice(
  deps: FeesDeps,
  actor: FeesActor,
  input: unknown,
): Promise<FeeInvoiceView> {
  return withFees(deps, actor, 'fee.write', async (scope) => {
    const data = parseFeeInput(UpdateDraftInput, input);
    const current = await loadInvoice(scope, data.invoiceId);
    requireDraft(current);
    const prepared = priced(data.invoice, data.supplier);
    const parsed = InvoiceInput.parse(data.invoice);
    await requireMatterAndPerson(scope, parsed.matterId, parsed.personId);
    await requireAgreement(scope, parsed);
    const [row] = await scope.tx
      .update(feeInvoice)
      .set({ ...headerValues(parsed, prepared), updatedAt: scope.now })
      .where(and(eq(feeInvoice.workspaceId, actor.workspaceId), eq(feeInvoice.id, current.id)))
      .returning();
    if (row === undefined) throw notFound('Invoice not found');
    await writeLines(scope, row.id, parsed);
    await record(auditCtx(scope), {
      action: 'fee.invoice_drafted',
      target: { kind: 'fee_invoice', id: row.id },
      metadata: { lines: parsed.lines.length },
    });
    return view(scope, row);
  });
}

/** Deletes a draft (a numbered invoice is never deleted: the series stays gapless). */
export async function discardDraftInvoice(
  deps: FeesDeps,
  actor: FeesActor,
  input: unknown,
): Promise<void> {
  return withFees(deps, actor, 'fee.write', async (scope) => {
    const { invoiceId } = parseFeeInput(InvoiceId, input);
    requireDraft(await loadInvoice(scope, invoiceId));
    await scope.tx
      .delete(feeInvoiceLine)
      .where(
        and(
          eq(feeInvoiceLine.workspaceId, actor.workspaceId),
          eq(feeInvoiceLine.invoiceId, invoiceId),
        ),
      );
    await scope.tx
      .delete(feeInvoice)
      .where(and(eq(feeInvoice.workspaceId, actor.workspaceId), eq(feeInvoice.id, invoiceId)));
    await record(auditCtx(scope), {
      action: 'fee.invoice_discarded',
      target: { kind: 'fee_invoice', id: invoiceId },
      metadata: {},
    });
  });
}

/** The next gapless sequence of the workspace's `FE` series for the financial year, inside the txn. */
function allocator(scope: FeesScope) {
  return {
    async allocate(series: string, fy: string): Promise<number> {
      const ws = scope.actor.workspaceId;
      await scope.tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`fee-invoice:${ws}:${fy}`}))`,
      );
      const [last] = await scope.tx
        .select({ number: feeInvoice.number })
        .from(feeInvoice)
        .where(and(eq(feeInvoice.workspaceId, ws), like(feeInvoice.number, `${series}/${fy}/%`)))
        .orderBy(desc(feeInvoice.number))
        .limit(1);
      return last?.number ? Number(last.number.split('/')[2]) + 1 : 1;
    },
  };
}

/** Makes a draft final: numbers it, freezes it, debits the client's ledger. */
export async function issueInvoice(
  deps: FeesDeps,
  actor: FeesActor,
  input: unknown,
): Promise<FeeInvoiceView> {
  return withFees(deps, actor, 'fee.write', async (scope) => {
    const data = parseFeeInput(IssueInput, input);
    const current = await loadInvoice(scope, data.invoiceId);
    requireDraft(current);
    const stored = await linesOf(scope, current.id);
    if (stored.length === 0) throw conflict('An invoice needs at least one line');
    const prepared = prepareInvoice(
      {
        matterId: current.matterId,
        personId: current.personId,
        ...(current.feeAgreementId ? { feeAgreementId: current.feeAgreementId } : {}),
        placeOfSupplyStateCode: current.placeOfSupplyStateCode,
        ...(current.recipientGstin ? { recipientGstin: current.recipientGstin } : {}),
        ...(current.dueDate ? { dueDate: current.dueDate } : {}),
        lines: stored.map((line) => ({
          description: line.description,
          quantity: line.quantity,
          unitPricePaise: line.unitPricePaise,
          amountPaise: line.amountPaise,
          gstTreatment: line.gstTreatment,
          ...(line.sac ? { sac: line.sac } : {}),
        })),
      },
      toFeeSupplier(data.supplier),
    );
    const unreviewed = isGstUnreviewed(prepared);
    if (unreviewed) {
      if (scope.actor.role !== 'owner') {
        throw forbidden('Only an owner can issue an invoice while GST rates are unreviewed');
      }
      if (data.acknowledgeUnreviewedGst !== true) {
        throw conflict('Acknowledge that the GST rates are unreviewed to issue this invoice');
      }
      await record(auditCtx(scope), {
        action: 'fee.gst_unreviewed_acknowledged',
        target: { kind: 'fee_invoice', id: current.id },
        metadata: { lines: prepared.lines.length },
      });
    }
    const { number, issueDate } = await numberInvoice(allocator(scope), scope.now);
    const [row] = await scope.tx
      .update(feeInvoice)
      .set({
        status: 'issued',
        number,
        issueDate,
        taxablePaise: prepared.taxablePaise,
        taxPaise: prepared.cgst + prepared.sgst + prepared.igst,
        totalPaise: prepared.totalPaise,
        updatedAt: scope.now,
      })
      .where(and(eq(feeInvoice.workspaceId, actor.workspaceId), eq(feeInvoice.id, current.id)))
      .returning();
    if (row === undefined) throw notFound('Invoice not found');
    if (row.totalPaise > 0) {
      await insertLedgerEntry(scope, {
        personId: row.personId,
        matterId: row.matterId,
        invoiceId: row.id,
        kind: 'fee',
        direction: 'debit',
        amountPaise: row.totalPaise,
        description: `Invoice ${number}`,
        occurredOn: issueDate,
      });
    }
    await record(auditCtx(scope), {
      action: 'fee.invoice_issued',
      target: { kind: 'fee_invoice', id: row.id },
      metadata: { fy: financialYear(scope.now), gstUnreviewed: unreviewed },
    });
    return view(scope, row);
  });
}

async function settled(scope: FeesScope, invoice: FeeInvoiceRow) {
  const ws = scope.actor.workspaceId;
  const [paid] = await scope.tx
    .select({ sum: sql<string>`coalesce(sum(${payment.amountPaise}), 0)` })
    .from(payment)
    .where(and(eq(payment.workspaceId, ws), eq(payment.invoiceId, invoice.id)));
  const [credited] = await scope.tx
    .select({ sum: sql<string>`coalesce(sum(${clientLedgerEntry.amountPaise}), 0)` })
    .from(clientLedgerEntry)
    .where(
      and(
        eq(clientLedgerEntry.workspaceId, ws),
        eq(clientLedgerEntry.invoiceId, invoice.id),
        eq(clientLedgerEntry.kind, 'adjustment'),
        eq(clientLedgerEntry.direction, 'credit'),
      ),
    );
  return { paid: Number(paid?.sum ?? 0), credited: Number(credited?.sum ?? 0) };
}

/** Records money received against an issued invoice (a receipt in the ledger); marks it paid when settled. */
export async function recordPayment(
  deps: FeesDeps,
  actor: FeesActor,
  input: unknown,
): Promise<FeeInvoiceView> {
  return withFees(deps, actor, 'fee.write', async (scope) => {
    const data = parseFeeInput(PaymentRecord, input);
    const invoice = await loadInvoice(scope, data.invoiceId);
    if (invoice.status !== 'issued') throw conflict('Payments are recorded on issued invoices');
    const { paid, credited } = await settled(scope, invoice);
    if (paid + credited + data.amountPaise > invoice.totalPaise) {
      throw conflict('The payment is more than the invoice balance');
    }
    const [pay] = await scope.tx
      .insert(payment)
      .values({
        workspaceId: actor.workspaceId,
        invoiceId: invoice.id,
        amountPaise: data.amountPaise,
        method: data.method,
        reference: data.reference ?? null,
        receivedOn: data.receivedOn,
        createdBy: actor.userId,
      })
      .returning({ id: payment.id });
    if (pay === undefined) throw new Error('payment insert returned no row');
    await insertLedgerEntry(scope, {
      personId: invoice.personId,
      matterId: invoice.matterId,
      invoiceId: invoice.id,
      kind: 'receipt',
      direction: 'credit',
      amountPaise: data.amountPaise,
      description: data.reference ? `Receipt ${data.reference}` : 'Receipt',
      occurredOn: data.receivedOn,
    });
    await record(auditCtx(scope), {
      action: 'fee.payment_recorded',
      target: { kind: 'fee_invoice', id: invoice.id },
      metadata: { paymentId: pay.id, method: data.method },
    });
    return markSettled(scope, invoice);
  });
}

async function markSettled(scope: FeesScope, invoice: FeeInvoiceRow): Promise<FeeInvoiceView> {
  const { paid, credited } = await settled(scope, invoice);
  const done = paid + credited >= invoice.totalPaise;
  if (!done) return view(scope, invoice);
  const [row] = await scope.tx
    .update(feeInvoice)
    .set({ status: 'paid', updatedAt: scope.now })
    .where(and(eq(feeInvoice.workspaceId, scope.actor.workspaceId), eq(feeInvoice.id, invoice.id)))
    .returning();
  return view(scope, row ?? invoice);
}

/** A credit note: a credit ledger entry against an issued invoice. The invoice itself is never edited. */
export async function issueCreditNote(
  deps: FeesDeps,
  actor: FeesActor,
  input: unknown,
): Promise<FeeInvoiceView> {
  return withFees(deps, actor, 'fee.write', async (scope) => {
    const data = parseFeeInput(CreditNoteInput, input);
    const invoice = await loadInvoice(scope, data.invoiceId);
    if (invoice.status !== 'issued' && invoice.status !== 'paid') {
      throw conflict('Credit notes are issued against an issued invoice');
    }
    const { credited } = await settled(scope, invoice);
    if (credited + data.amountPaise > invoice.totalPaise) {
      throw conflict('The credit notes would exceed the invoice total');
    }
    const entry = await insertLedgerEntry(scope, {
      personId: invoice.personId,
      matterId: invoice.matterId,
      invoiceId: invoice.id,
      kind: 'adjustment',
      direction: 'credit',
      amountPaise: data.amountPaise,
      description: `Credit note: ${data.reason}`,
      occurredOn: data.occurredOn,
    });
    await record(auditCtx(scope), {
      action: 'fee.credit_note_issued',
      target: { kind: 'fee_invoice', id: invoice.id },
      metadata: { entryId: entry.id },
    });
    return invoice.status === 'issued' ? markSettled(scope, invoice) : view(scope, invoice);
  });
}

export async function getInvoice(
  deps: FeesDeps,
  actor: FeesActor,
  input: unknown,
): Promise<FeeInvoiceView> {
  return withFees(deps, actor, 'fee.read', async (scope) =>
    view(scope, await loadInvoice(scope, parseFeeInput(InvoiceId, input).invoiceId)),
  );
}

export async function listInvoices(
  deps: FeesDeps,
  actor: FeesActor,
  input: unknown = {},
): Promise<FeeInvoiceRow[]> {
  return withFees(deps, actor, 'fee.read', async (scope) => {
    const data = parseFeeInput(ListInput, input);
    return scope.tx
      .select()
      .from(feeInvoice)
      .where(
        and(
          eq(feeInvoice.workspaceId, actor.workspaceId),
          data.matterId === undefined ? undefined : eq(feeInvoice.matterId, data.matterId),
          data.personId === undefined ? undefined : eq(feeInvoice.personId, data.personId),
        ),
      )
      .orderBy(desc(feeInvoice.createdAt), asc(feeInvoice.id));
  });
}
