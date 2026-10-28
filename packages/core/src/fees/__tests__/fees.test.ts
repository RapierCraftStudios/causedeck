import { schema } from '@causedeck/db';
import { withTestDb } from '@causedeck/db/testing';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { acceptProposal } from '../../automation/index.ts';
import {
  anonymiseClientLedger,
  createDraftInvoice,
  createFeeAgreement,
  discardDraftInvoice,
  getClientBalance,
  issueCreditNote,
  issueInvoice,
  listFeeAgreements,
  listLedger,
  prepareFeeInvoice,
  recordClientExpense,
  recordPayment,
  setFeeAgreementStatus,
  updateDraftInvoice,
  updateFeeAgreement,
} from '../index.ts';
import { agreementInput, chamber, deps, invoiceInput, SUPPLIER } from './helpers.ts';

const draft = (d: ReturnType<typeof deps>, who: { userId: string; workspaceId: string }, c: Parameters<typeof invoiceInput>[0]) =>
  createDraftInvoice(d, who, { invoice: invoiceInput(c), supplier: SUPPLIER });

describe('roles', () => {
  it('lets owner and advocate in; refuses junior, clerk and viewer', async () => {
    await withTestDb(async (tx) => {
      const c = await chamber(tx);
      const d = deps(tx);
      await createFeeAgreement(d, c.owner, agreementInput(c));
      await createFeeAgreement(d, c.advocate, agreementInput(c));
      for (const who of [c.junior, c.clerk, c.viewer]) {
        await expect(createFeeAgreement(d, who, agreementInput(c))).rejects.toMatchObject({
          code: 'FORBIDDEN',
        });
        await expect(listFeeAgreements(d, who)).rejects.toMatchObject({ code: 'FORBIDDEN' });
      }
    });
  });
});

describe('fee agreements', () => {
  it('creates, updates and walks draft -> active -> ended', async () => {
    await withTestDb(async (tx) => {
      const c = await chamber(tx);
      const d = deps(tx);
      const made = await createFeeAgreement(d, c.advocate, agreementInput(c));
      if (made.status !== 'created') throw new Error('expected created');
      const id = made.agreement.id;
      const upd = await updateFeeAgreement(d, c.advocate, { agreementId: id, amountPaise: 700_000 });
      expect(upd.amountPaise).toBe(700_000);
      await setFeeAgreementStatus(d, c.advocate, { agreementId: id, status: 'active' });
      await expect(
        setFeeAgreementStatus(d, c.advocate, { agreementId: id, status: 'active' }),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
      await setFeeAgreementStatus(d, c.advocate, { agreementId: id, status: 'ended' });
      await expect(
        updateFeeAgreement(d, c.advocate, { agreementId: id, notes: 'x' }),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
    });
  });

  it('rejects a matter or person of another workspace as NOT_FOUND', async () => {
    await withTestDb(async (tx) => {
      const c = await chamber(tx);
      const other = await chamber(tx);
      await expect(
        createFeeAgreement(deps(tx), c.owner, agreementInput({ ...c, matterId: other.matterId })),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  it('stages an automation-origin entry as an L2 proposal and writes the draft only on accept', async () => {
    await withTestDb(async (tx) => {
      const c = await chamber(tx);
      const d = deps(tx);
      const made = await createFeeAgreement(d, c.owner, agreementInput(c), 'automation');
      if (made.status !== 'proposed') throw new Error('expected proposed');
      expect(await listFeeAgreements(d, c.owner)).toEqual([]);
      await acceptProposal(
        { db: tx, events: { emit() {} }, now: () => new Date('2026-11-02T10:00:00Z') },
        c.owner,
        { proposalId: made.proposalId },
      );
      const rows = await listFeeAgreements(d, c.owner);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.status).toBe('draft');
    });
  });
});

describe('invoice lifecycle', () => {
  it('prepares without storing, then drafts, edits and issues a gapless numbered invoice', async () => {
    await withTestDb(async (tx) => {
      const c = await chamber(tx);
      const d = deps(tx);
      const prep = await prepareFeeInvoice(d, c.advocate, {
        invoice: invoiceInput(c),
        supplier: SUPPLIER,
      });
      expect(prep.invoice.taxablePaise).toBe(200_000);
      expect(prep.gstUnreviewed).toBe(true);
      expect(await tx.select().from(schema.feeInvoice)).toHaveLength(0);

      const first = await draft(d, c.advocate, c);
      expect(first.status).toBe('draft');
      expect(first.number).toBeNull();
      const edited = await updateDraftInvoice(d, c.advocate, {
        invoiceId: first.id,
        invoice: { ...invoiceInput(c), dueDate: '2026-12-01' },
        supplier: SUPPLIER,
      });
      expect(edited.dueDate).toBe('2026-12-01');

      const issued = await issueInvoice(d, c.owner, {
        invoiceId: first.id,
        supplier: SUPPLIER,
        acknowledgeUnreviewedGst: true,
      });
      expect(issued.status).toBe('issued');
      expect(issued.number).toBe('FE/26-27/000001');
      const second = await draft(d, c.advocate, c);
      const issued2 = await issueInvoice(d, c.owner, {
        invoiceId: second.id,
        supplier: SUPPLIER,
        acknowledgeUnreviewedGst: true,
      });
      expect(issued2.number).toBe('FE/26-27/000002');
    });
  });

  it('makes an issued invoice immutable', async () => {
    await withTestDb(async (tx) => {
      const c = await chamber(tx);
      const d = deps(tx);
      const inv = await draft(d, c.owner, c);
      await issueInvoice(d, c.owner, {
        invoiceId: inv.id,
        supplier: SUPPLIER,
        acknowledgeUnreviewedGst: true,
      });
      await expect(
        updateDraftInvoice(d, c.owner, {
          invoiceId: inv.id,
          invoice: invoiceInput(c),
          supplier: SUPPLIER,
        }),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
      await expect(discardDraftInvoice(d, c.owner, { invoiceId: inv.id })).rejects.toMatchObject({
        code: 'CONFLICT',
      });
    });
  });

  it('needs an owner acknowledgement while GST is unreviewed, and logs it', async () => {
    await withTestDb(async (tx) => {
      const c = await chamber(tx);
      const d = deps(tx);
      const inv = await draft(d, c.advocate, c);
      await expect(
        issueInvoice(d, c.advocate, { invoiceId: inv.id, supplier: SUPPLIER }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(
        issueInvoice(d, c.owner, { invoiceId: inv.id, supplier: SUPPLIER }),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
      await issueInvoice(d, c.owner, {
        invoiceId: inv.id,
        supplier: SUPPLIER,
        acknowledgeUnreviewedGst: true,
      });
      const ack = await tx
        .select()
        .from(schema.auditEvent)
        .where(eq(schema.auditEvent.action, 'fee.gst_unreviewed_acknowledged'));
      expect(ack).toHaveLength(1);
    });
  });

  it('settles with payments and corrects with credit notes, never editing the invoice', async () => {
    await withTestDb(async (tx) => {
      const c = await chamber(tx);
      const d = deps(tx);
      const inv = await draft(d, c.owner, c);
      const issued = await issueInvoice(d, c.owner, {
        invoiceId: inv.id,
        supplier: SUPPLIER,
        acknowledgeUnreviewedGst: true,
      });
      const total = issued.totalPaise;
      expect(await getClientBalance(d, c.advocate, { personId: c.personId })).toBe(total);
      await recordClientExpense(d, c.advocate, {
        personId: c.personId,
        matterId: c.matterId,
        amountPaise: 5_000,
        description: 'Court fee',
        occurredOn: '2026-11-02',
      });
      const afterCredit = await issueCreditNote(d, c.advocate, {
        invoiceId: inv.id,
        amountPaise: 10_000,
        reason: 'Discount',
        occurredOn: '2026-11-03',
      });
      expect(afterCredit.totalPaise).toBe(total);
      await expect(
        issueCreditNote(d, c.advocate, {
          invoiceId: inv.id,
          amountPaise: total,
          reason: 'Too much',
          occurredOn: '2026-11-03',
        }),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
      const paid = await recordPayment(d, c.advocate, {
        invoiceId: inv.id,
        amountPaise: total - 10_000,
        method: 'upi',
        receivedOn: '2026-11-04',
      });
      expect(paid.status).toBe('paid');
      expect(await getClientBalance(d, c.advocate, { personId: c.personId })).toBe(5_000);
    });
  });
});

describe('ledger anonymisation (DPDP)', () => {
  it('clears descriptions, keeps amounts and is idempotent', async () => {
    await withTestDb(async (tx) => {
      const c = await chamber(tx);
      const d = deps(tx);
      await recordClientExpense(d, c.owner, {
        personId: c.personId,
        amountPaise: 5_000,
        description: 'Travel for A. Rao',
        occurredOn: '2026-11-02',
      });
      expect(await anonymiseClientLedger(d, c.owner, c.personId)).toBe(1);
      expect(await anonymiseClientLedger(d, c.owner, c.personId)).toBe(0);
      const rows = await listLedger(d, c.owner, { personId: c.personId });
      expect(rows[0]).toMatchObject({ description: null, amountPaise: 5_000 });
      expect(rows[0]?.anonymisedAt).toBeInstanceOf(Date);
      expect(await getClientBalance(d, c.owner, { personId: c.personId })).toBe(5_000);
    });
  });
});
