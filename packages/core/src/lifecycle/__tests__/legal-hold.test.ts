// Statutory retention (#302): issued SaaS invoices survive workspace erasure in minimal form in
// `legal_hold_invoice` (legal_hold = true, kept 8 years after the financial year), by the explicit
// `LEGAL_HOLD_RULE`; they carry no names, addresses or line descriptions, drafts are not kept, and
// the app role can neither change nor delete a held invoice.
import { randomUUID } from 'node:crypto';

import { schema, withWorkspace, type Database } from '@causedeck/db';
import type { TwoTenants } from '@causedeck/db/testing/two-tenants';
import type { MemoryObjectStore } from '@causedeck/storage';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  LEGAL_HOLD_RULE,
  legalHoldRetainUntil,
  requestWorkspaceDeletion,
  runWorkspaceErase,
} from '../index.ts';

import {
  countRows,
  DAY,
  eraseDeps,
  fakeClock,
  noDelivery,
  spyEmail,
  superuserDb,
} from './deletion-fixtures.ts';
import {
  captureLog,
  cleanup,
  lifecycleDb,
  newStore,
  seedWorkspaces,
  stepUpSession,
} from './fixtures.ts';

const T0 = new Date('2026-11-25T00:00:00.000Z');
const RECIPIENT = {
  legalName: 'Rao & Iyer Advocates LLP',
  address: '14 Residency Road, Bengaluru',
  gstin: '29ABCDE1234F1Z5',
  stateCode: '29',
};
const SUPPLIER = {
  legalName: 'CauseDeck Technologies Pvt Ltd',
  address: 'Koramangala, Bengaluru',
  gstin: '29AAACC1234A1Z9',
  stateCode: '29',
};
const LINE = 'Pro plan, 3 seats, privileged matter workspace';

let db: Database;
let su: Database;
let seeded: TwoTenants;
let store: MemoryObjectStore;

async function issuedInvoice(workspaceId: string): Promise<{ id: string; number: string }> {
  const number = `XT/26-27/${randomUUID().slice(0, 8)}`;
  const id = await withWorkspace(db, { workspaceId }, async (tx) => {
    const [inv] = await tx
      .insert(schema.saasInvoice)
      .values({
        workspaceId,
        series: 'XT',
        fy: '26-27',
        supplier: SUPPLIER,
        recipient: RECIPIENT,
        placeOfSupplyStateCode: '29',
        taxablePaise: 100_000,
        cgstPaise: 9_000,
        sgstPaise: 9_000,
        totalPaise: 118_000,
        providerPaymentId: `pay_${randomUUID().slice(0, 8)}`,
      })
      .returning({ id: schema.saasInvoice.id });
    if (inv === undefined) throw new Error('no invoice');
    await tx.insert(schema.saasInvoiceLine).values({
      workspaceId,
      invoiceId: inv.id,
      description: LINE,
      quantity: 3,
      unitPricePaise: 33_333,
      amountPaise: 100_000,
    });
    await tx
      .update(schema.saasInvoice)
      .set({ status: 'issued', number, issueDate: '2026-11-05' })
      .where(eq(schema.saasInvoice.id, inv.id));
    return inv.id;
  });
  return { id, number };
}

beforeAll(async () => {
  db = lifecycleDb();
  su = superuserDb();
  store = newStore();
  seeded = await seedWorkspaces(db, store);
});

afterAll(async () => {
  await su.$client.end();
  await cleanup(db, [seeded.a.id, seeded.b.id]);
});

describe('legal hold', () => {
  it('keeps the financial year end plus 8 years', () => {
    expect(legalHoldRetainUntil('2026-11-05')).toBe('2035-03-31');
    expect(legalHoldRetainUntil('2027-02-10')).toBe('2035-03-31');
    expect(legalHoldRetainUntil('2027-04-01')).toBe('2036-03-31');
    expect(LEGAL_HOLD_RULE.reason.length).toBeGreaterThan(50);
    expect(LEGAL_HOLD_RULE.dropped).toContain('recipient.legalName');
  });

  it('issued invoices survive erasure in minimal form, without content', async () => {
    const ws = seeded.a;
    const invoice = await issuedInvoice(ws.id);
    const job = await requestWorkspaceDeletion(
      {
        db,
        workspaceId: ws.id,
        userId: seeded.ua,
        sessionId: await stepUpSession(db, seeded.ua, { at: T0 }),
        now: () => T0,
      },
      { confirmName: ws.name },
      noDelivery,
    );
    const { log } = captureLog();
    expect(
      await runWorkspaceErase(
        { db, log },
        { workspaceId: ws.id, jobId: job.id },
        eraseDeps(store, spyEmail(), fakeClock(new Date(T0.getTime() + 14 * DAY + 1000)).now),
      ),
    ).toBe('erased');

    // The tenant invoice rows are gone with the rest of the workspace.
    const counts = await countRows(su, ws.id);
    expect(counts.saas_invoice).toBe(0);
    expect(counts.saas_invoice_line).toBe(0);

    const held = await su
      .select()
      .from(schema.legalHoldInvoice)
      .where(eq(schema.legalHoldInvoice.workspaceId, ws.id));
    // Only the issued invoice; the seeded drafts were never tax invoices.
    expect(held).toHaveLength(1);
    const [row] = held;
    expect(row).toMatchObject({
      invoiceId: invoice.id,
      number: invoice.number,
      status: 'issued',
      legalHold: true,
      issueDate: '2026-11-05',
      retainUntil: '2035-03-31',
      totalPaise: 118_000,
      recipientGstin: RECIPIENT.gstin,
      supplierGstin: SUPPLIER.gstin,
    });
    const text = JSON.stringify(row);
    for (const content of [
      RECIPIENT.legalName,
      RECIPIENT.address,
      SUPPLIER.legalName,
      SUPPLIER.address,
      LINE,
      'pay_',
    ]) {
      expect(text).not.toContain(content);
    }
  });

  it('the app role cannot change or delete a held invoice', async () => {
    const [row] = await su
      .select({ invoiceId: schema.legalHoldInvoice.invoiceId })
      .from(schema.legalHoldInvoice)
      .where(eq(schema.legalHoldInvoice.workspaceId, seeded.a.id));
    if (row === undefined) throw new Error('no held invoice');
    const denied = async (run: () => Promise<unknown>) => {
      try {
        await run();
      } catch (error) {
        return JSON.stringify(error, Object.getOwnPropertyNames(error));
      }
      return 'allowed';
    };
    expect(
      await denied(() =>
        db
          .update(schema.legalHoldInvoice)
          .set({ totalPaise: 0 })
          .where(eq(schema.legalHoldInvoice.invoiceId, row.invoiceId)),
      ),
    ).toContain('permission denied for table legal_hold_invoice');
    expect(
      await denied(() =>
        db
          .delete(schema.legalHoldInvoice)
          .where(eq(schema.legalHoldInvoice.invoiceId, row.invoiceId)),
      ),
    ).toContain('permission denied for table legal_hold_invoice');
  });
});
