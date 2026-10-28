import { withTestDb } from '@causedeck/db/testing';
import { describe, expect, it } from 'vitest';

import {
  createDraftInvoice,
  createFeeAgreement,
  discardDraftInvoice,
  FeatureDisabledError,
  getClientBalance,
  getFeeAgreement,
  getInvoice,
  issueCreditNote,
  issueInvoice,
  listFeeAgreements,
  listInvoices,
  listLedger,
  prepareFeeInvoice,
  recordClientExpense,
  recordClientReceipt,
  recordPayment,
  setFeeAgreementStatus,
  updateDraftInvoice,
  updateFeeAgreement,
} from '../index.ts';
import { agreementInput, chamber, deps, invoiceInput, SUPPLIER } from './helpers.ts';

const ID = '11111111-1111-4111-8111-111111111111';

describe('invoices.enabled flag', () => {
  it('rejects every service with FeatureDisabledError while off, writing nothing', async () => {
    await withTestDb(async (tx) => {
      const c = await chamber(tx);
      const off = deps(tx, { flagEnabled: () => Promise.resolve(false) });
      const o = c.owner;
      const calls = [
        () => createFeeAgreement(off, o, agreementInput(c)),
        () => createFeeAgreement(off, o, agreementInput(c), 'automation'),
        () => updateFeeAgreement(off, o, { agreementId: ID }),
        () => setFeeAgreementStatus(off, o, { agreementId: ID, status: 'active' }),
        () => getFeeAgreement(off, o, { agreementId: ID }),
        () => listFeeAgreements(off, o),
        () => prepareFeeInvoice(off, o, { invoice: invoiceInput(c), supplier: SUPPLIER }),
        () => createDraftInvoice(off, o, { invoice: invoiceInput(c), supplier: SUPPLIER }),
        () => updateDraftInvoice(off, o, { invoiceId: ID }),
        () => discardDraftInvoice(off, o, { invoiceId: ID }),
        () => issueInvoice(off, o, { invoiceId: ID }),
        () => recordPayment(off, o, { invoiceId: ID }),
        () => issueCreditNote(off, o, { invoiceId: ID }),
        () => getInvoice(off, o, { invoiceId: ID }),
        () => listInvoices(off, o),
        () => recordClientExpense(off, o, {}),
        () => recordClientReceipt(off, o, {}),
        () => listLedger(off, o, { personId: c.personId }),
        () => getClientBalance(off, o, { personId: c.personId }),
      ];
      for (const call of calls) {
        await expect(call()).rejects.toBeInstanceOf(FeatureDisabledError);
      }
      expect(await listFeeAgreements(deps(tx), o)).toEqual([]);
      expect(await listInvoices(deps(tx), o)).toEqual([]);
    });
  });

  it('is off by default on a fresh database (legal-gated)', async () => {
    await withTestDb(async (tx) => {
      const c = await chamber(tx);
      await expect(createFeeAgreement({ db: tx }, c.owner, agreementInput(c))).rejects.toBeInstanceOf(
        FeatureDisabledError,
      );
    });
  });
});
