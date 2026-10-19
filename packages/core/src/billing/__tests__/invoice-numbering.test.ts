// SaaS invoice issuance on Postgres (#253): gapless numbering under concurrency, rollback and FY
// reset, and the recipient snapshot. Issuance commits on separate pooled connections, so this cannot
// use the shared rolled-back transaction: it commits to the shared test database in freshly seeded
// workspaces and a random invoice series (parallel files never collide), and deletes them after.
import { randomInt } from 'node:crypto';

import { resolveSupplier, type SupplierConfig } from '@causedeck/billing/config/supplier';
import type { IssueInvoiceInput } from '@causedeck/billing/invoice/generate';
import { Secret } from '@causedeck/config/env';
import { createDb, schema, withWorkspace, type Database } from '@causedeck/db';
import { inWorkspace, testDatabaseUrls } from '@causedeck/db/testing';
import { seedTwoTenants } from '@causedeck/db/testing/two-tenants';
import { and, asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { issueSaasInvoice } from '../invoices.ts';

const { invoiceCounter, organization, saasInvoice, saasInvoiceLine, subscription } = schema;

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
/** A series no other run uses: `Z` plus two random capitals. */
const SERIES = `Z${LETTERS.charAt(randomInt(26))}${LETTERS.charAt(randomInt(26))}`;

const SUPPLIER: SupplierConfig = resolveSupplier(
  {
    legalName: 'CauseDeck Technologies Pvt Ltd',
    address: 'Bengaluru',
    gstin: '29AAGCB7383J1Z4',
    series: SERIES,
  },
  { nodeEnv: 'production' },
);

/** A clock in FY 26-27 and one at 00:00 IST on 1 April 2027 (FY 27-28). */
const FY_26_27 = () => new Date('2026-06-01T06:00:00Z');
const FY_27_28 = () => new Date('2027-03-31T18:30:00Z');

let db: Database;
let workspaceId: string;
let subscriptionId: string;
let seeded: string[] = [];

beforeAll(async () => {
  db = createDb({ url: new Secret(testDatabaseUrls().app), role: 'app', max: 24 });
  const { a, b } = await db.transaction((tx) => seedTwoTenants(tx));
  workspaceId = a.id;
  subscriptionId = a.rows.subscription?.subscriptionId ?? '';
  seeded = [a.id, b.id];
});

afterAll(async () => {
  // Invoices and lines cascade from the workspace; the counter is global.
  for (const id of seeded) {
    await db.transaction((tx) =>
      inWorkspace(tx, id, (s) => s.delete(organization).where(eq(organization.id, id))),
    );
  }
  await db.delete(invoiceCounter).where(eq(invoiceCounter.series, SERIES));
  await db.$client.end();
});

const input = (description = 'Advocate plan'): IssueInvoiceInput => ({
  subscriptionId,
  periodStart: '2026-06-01',
  periodEnd: '2026-06-30',
  lines: [{ description, quantity: 1, unitPricePaise: 49_900 }],
});

const issue = (now = FY_26_27, description?: string) =>
  issueSaasInvoice({ db, workspaceId, now, supplier: () => SUPPLIER }, input(description));

const seq = (number: string) => Number(number.slice(-6));

async function counter(fy: string): Promise<number | undefined> {
  const [row] = await db
    .select({ last: invoiceCounter.lastNumber })
    .from(invoiceCounter)
    .where(and(eq(invoiceCounter.series, SERIES), eq(invoiceCounter.fy, fy)));
  return row?.last;
}

describe('SaaS invoice numbering on Postgres', () => {
  // Order matters: the tests share one series and assert consecutive numbers.
  it('20 parallel issuances get 20 unique, consecutive numbers from 000001', async () => {
    const invoices = await Promise.all(Array.from({ length: 20 }, () => issue()));
    const numbers = invoices.map((i) => i.number).sort();

    expect(new Set(numbers).size).toBe(20);
    expect(numbers).toEqual(
      Array.from({ length: 20 }, (_, i) => `${SERIES}/26-27/${String(i + 1).padStart(6, '0')}`),
    );
    expect(await counter('26-27')).toBe(20);

    const rows = await db.transaction((tx) =>
      inWorkspace(tx, workspaceId, (s) =>
        s
          .select({
            id: saasInvoice.id,
            status: saasInvoice.status,
            issueDate: saasInvoice.issueDate,
          })
          .from(saasInvoice)
          .where(eq(saasInvoice.series, SERIES)),
      ),
    );
    expect(rows).toHaveLength(20);
    expect(rows.every((r) => r.status === 'issued' && r.issueDate === '2026-06-01')).toBe(true);
  });

  it('a rolled-back issuance leaves no gap', async () => {
    await expect(
      withWorkspace(db, { workspaceId }, async (tx) => {
        const invoice = await issueSaasInvoice(
          { db: tx, workspaceId, now: FY_26_27, supplier: () => SUPPLIER },
          input('Rolled back'),
        );
        expect(seq(invoice.number)).toBe(21);
        throw new Error('abort issuance');
      }),
    ).rejects.toThrow('abort issuance');

    expect(await counter('26-27')).toBe(20);
    const next = await issue();
    expect(next.number).toBe(`${SERIES}/26-27/000021`);
  });

  it('restarts at 000001 in a new financial year', async () => {
    const april = await issue(FY_27_28);
    expect(april.number).toBe(`${SERIES}/27-28/000001`);
    expect(april.issueDate).toBe('2027-04-01');
    expect((await issue(FY_27_28)).number).toBe(`${SERIES}/27-28/000002`);
    expect((await issue()).number).toBe(`${SERIES}/26-27/000022`);
  });

  it('stores lines and snapshots the recipient GSTIN at issue time', async () => {
    const setGstin = (gstin: string | null) =>
      db.transaction((tx) =>
        inWorkspace(tx, workspaceId, (s) =>
          s.update(subscription).set({ gstin }).where(eq(subscription.id, subscriptionId)),
        ),
      );
    await setGstin('27AAPFU0939F1ZV');
    const invoice = await issue(FY_26_27, 'Snapshot');
    await setGstin('29AABCU9603R1ZJ');

    const [row] = await db.transaction((tx) =>
      inWorkspace(tx, workspaceId, (s) =>
        s.select().from(saasInvoice).where(eq(saasInvoice.id, invoice.id)),
      ),
    );
    expect(row).toMatchObject({
      number: invoice.number,
      status: 'issued',
      placeOfSupplyStateCode: '27',
      taxablePaise: 49_900,
      igstPaise: 8_982,
      cgstPaise: 0,
      sgstPaise: 0,
      totalPaise: 58_882,
      sac: '998314',
    });
    expect(row?.recipient).toMatchObject({ gstin: '27AAPFU0939F1ZV', stateCode: '27' });
    expect(row?.supplier).toMatchObject({ gstin: '29AAGCB7383J1Z4', stateCode: '29' });

    const lines = await db.transaction((tx) =>
      inWorkspace(tx, workspaceId, (s) =>
        s
          .select({ description: saasInvoiceLine.description, amount: saasInvoiceLine.amountPaise })
          .from(saasInvoiceLine)
          .where(eq(saasInvoiceLine.invoiceId, invoice.id))
          .orderBy(asc(saasInvoiceLine.description)),
      ),
    );
    expect(lines).toEqual([{ description: 'Snapshot', amount: 49_900 }]);

    // The next invoice takes the new GSTIN (intra-state now).
    const next = await issue(FY_26_27, 'After change');
    expect(next.recipient.gstin).toBe('29AABCU9603R1ZJ');
    expect(next.cgstPaise + next.sgstPaise).toBe(8_982);
    await setGstin(null);
  });

  it('refuses without a configured supplier in production and allocates nothing', async () => {
    const before = await counter('26-27');
    await expect(
      issueSaasInvoice(
        {
          db,
          workspaceId,
          now: FY_26_27,
          supplier: () => resolveSupplier({ series: SERIES }, { nodeEnv: 'production' }),
        },
        input(),
      ),
    ).rejects.toMatchObject({ code: 'SUPPLIER_NOT_CONFIGURED' });
    expect(await counter('26-27')).toBe(before);
  });
});
