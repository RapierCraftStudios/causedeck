// Cross-tenant fees (#83 part 3): user `ub`, working in workspace B, calls the fees services with
// workspace A's ids. A's agreement, invoice and ledger are NOT_FOUND or empty to B, and unchanged.
import { schema } from '@causedeck/db';
import { withTestDb } from '@causedeck/db/testing';
import { seedTwoTenants } from '@causedeck/db/testing/two-tenants';
import { describe, expect, it } from 'vitest';

import {
  getFeeAgreement,
  getInvoice,
  issueCreditNote,
  listFeeAgreements,
  listInvoices,
  listLedger,
  setFeeAgreementStatus,
  updateFeeAgreement,
} from '../../fees/index.ts';

describe('fees cross-tenant', () => {
  it('B cannot see or change A, and A is unchanged', async () => {
    await withTestDb(async (tx) => {
      const t = await seedTwoTenants(tx);
      const deps = { db: tx, flagEnabled: () => Promise.resolve(true) };
      const b = { userId: t.ub, workspaceId: t.b.id };
      const agreementId = t.a.rows.fee_agreement?.id ?? '';
      const invoiceId = t.a.rows.fee_invoice?.id ?? '';
      const personId = t.a.rows.fee_agreement?.['personId'] as string;
      const before = await tx.select().from(schema.feeAgreement);

      await expect(getFeeAgreement(deps, b, { agreementId })).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(updateFeeAgreement(deps, b, { agreementId, notes: 'x' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(
        setFeeAgreementStatus(deps, b, { agreementId, status: 'active' }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(getInvoice(deps, b, { invoiceId })).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(
        issueCreditNote(deps, b, { invoiceId, amountPaise: 1, reason: 'x', occurredOn: '2026-11-03' }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(await listFeeAgreements(deps, b)).toEqual([]);
      expect(await listInvoices(deps, b)).toEqual([]);
      expect(await listLedger(deps, b, { personId })).toEqual([]);
      expect(await tx.select().from(schema.feeAgreement)).toEqual(before);
    });
  });
});
