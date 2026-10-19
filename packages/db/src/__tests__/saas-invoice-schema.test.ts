// SaaS invoice schema (#252, #29 part 1): the saas_* tables and the global counter, the naming rule
// (no client-fee `invoice` table), and the 0017 triggers that keep issued invoices immutable.
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { eq, sql } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { afterAll, describe, expect, it } from 'vitest';

import type { Transaction } from '../client.ts';
import { checkSchemaConventions, GLOBAL_TABLES, tablesOf } from '../conventions.ts';
import { missingTenantPolicies, registeredTenantTables } from '../rls-policies.ts';
import { organization } from '../schema/auth.ts';
import * as schema from '../schema/index.ts';
import { invoiceCounter, saasInvoice, saasInvoiceLine } from '../schema/saas-invoice.ts';
import { closeTestDb, inWorkspace, withTestDb } from '../testing/index.ts';

import { sqlState } from './rls/fixtures.ts';

afterAll(closeTestDb);

const MIGRATION = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../migrations/0017_saas_invoices.sql',
);
const migrationSql = () => readFileSync(MIGRATION, 'utf8');

const PARTY = { legalName: 'Test Chambers', address: 'MG Road', gstin: null, stateCode: '29' };
const DRAFT = {
  series: 'CD',
  fy: '26-27',
  supplier: PARTY,
  recipient: PARTY,
  placeOfSupplyStateCode: '29',
};

/** Run `fn` in a savepoint and return the violated constraint's name (or undefined on success). */
async function violation(tx: Transaction, fn: (sp: Transaction) => Promise<unknown>) {
  try {
    await tx.transaction(async (sp) => {
      await fn(sp);
    });
    return undefined;
  } catch (error) {
    const cause = (error as { cause?: { constraint_name?: string } }).cause;
    return cause?.constraint_name ?? (error as { constraint_name?: string }).constraint_name;
  }
}

/** SQLSTATE of `fn` run in a savepoint (undefined on success). */
const stateOf = (tx: Transaction, fn: (sp: Transaction) => Promise<unknown>) =>
  sqlState(
    tx.transaction(async (sp) => {
      await fn(sp);
    }),
  );

async function newWorkspace(tx: Transaction): Promise<string> {
  const id = randomUUID();
  await inWorkspace(tx, id, (s) =>
    s.insert(organization).values({ id, name: 'Test Chambers', slug: `ws-${id}` }),
  );
  return id;
}

async function draftInvoice(tx: Transaction, workspaceId: string): Promise<string> {
  const [row] = await tx
    .insert(saasInvoice)
    .values({
      ...DRAFT,
      workspaceId,
      taxablePaise: 10_000,
      cgstPaise: 900,
      sgstPaise: 900,
      totalPaise: 11_800,
    })
    .returning({ id: saasInvoice.id });
  if (row === undefined) throw new Error('no invoice');
  return row.id;
}

async function addLine(tx: Transaction, workspaceId: string, invoiceId: string) {
  const [row] = await tx
    .insert(saasInvoiceLine)
    .values({
      workspaceId,
      invoiceId,
      description: 'Seat',
      quantity: 1,
      unitPricePaise: 10_000,
      amountPaise: 10_000,
    })
    .returning({ id: saasInvoiceLine.id });
  if (row === undefined) throw new Error('no line');
  return row.id;
}

const issue = (tx: Transaction, invoiceId: string) =>
  tx
    .update(saasInvoice)
    .set({ status: 'issued', number: `CD/26-27/${randomUUID()}`, issueDate: '2026-10-19' })
    .where(eq(saasInvoice.id, invoiceId));

describe('saas invoice schema (#252)', () => {
  it('keeps saas_invoice* workspace-scoped and invoice_counter global', () => {
    expect(GLOBAL_TABLES).toContain('invoice_counter');
    for (const table of [saasInvoice, saasInvoiceLine]) {
      const config = getTableConfig(table);
      expect(GLOBAL_TABLES).not.toContain(config.name);
      expect(registeredTenantTables()).toContain(config.name);
      expect(config.columns.find((c) => c.name === 'workspace_id')?.notNull).toBe(true);
    }
    expect(getTableConfig(invoiceCounter).columns.map((c) => c.name)).not.toContain('workspace_id');
    expect(checkSchemaConventions(tablesOf(schema))).toEqual([]);
    expect(missingTenantPolicies('0017_saas_invoices.sql', migrationSql(), GLOBAL_TABLES)).toEqual(
      [],
    );
  });

  it('creates only saas_invoice* and invoice_counter, and no client-fee invoice table', async () => {
    const created = [...migrationSql().matchAll(/CREATE TABLE "([a-z_]+)"/g)].map((m) => m[1]);
    expect(created.sort()).toEqual(['invoice_counter', 'saas_invoice', 'saas_invoice_line']);
    for (const name of created) expect(name).toMatch(/^(saas_invoice.*|invoice_counter)$/);
    // No statement in 0017 names a bare `invoice` (or `invoice_line`) table.
    expect(migrationSql()).not.toMatch(/"invoice(_line)?"/);
    const rows = await withTestDb((tx) =>
      tx.execute<{ name: string }>(
        sql`select tablename as name from pg_tables where schemaname = 'public' and tablename like '%invoice%' order by 1`,
      ),
    );
    expect(rows.map((r) => r.name)).toEqual([
      'invoice_counter',
      'saas_invoice',
      'saas_invoice_line',
    ]);
  });

  it('lets a draft change freely, and an issued invoice only its status and pdf_blob_id', async () => {
    await withTestDb(async (outer) => {
      const ws = await newWorkspace(outer);
      await inWorkspace(outer, ws, async (tx) => {
        const id = await draftInvoice(tx, ws);
        await tx.update(saasInvoice).set({ totalPaise: 11_900 }).where(eq(saasInvoice.id, id));
        await issue(tx, id);

        for (const change of [
          { totalPaise: 1 },
          { number: 'CD/26-27/999999' },
          { recipient: { ...PARTY, gstin: '27AAPFU0939F1ZV' } },
          { providerPaymentId: 'pay_x' },
          { status: 'draft' },
        ]) {
          expect(
            await stateOf(tx, (sp) =>
              sp.update(saasInvoice).set(change).where(eq(saasInvoice.id, id)),
            ),
            JSON.stringify(change),
          ).toBe('42501');
        }
        // A forbidden column alongside an allowed one is still rejected.
        expect(
          await stateOf(tx, (sp) =>
            sp
              .update(saasInvoice)
              .set({ status: 'paid', totalPaise: 2 })
              .where(eq(saasInvoice.id, id)),
          ),
        ).toBe('42501');

        await tx.update(saasInvoice).set({ pdfBlobId: 'blob_1' }).where(eq(saasInvoice.id, id));
        await tx.update(saasInvoice).set({ status: 'paid' }).where(eq(saasInvoice.id, id));
        await tx.update(saasInvoice).set({ status: 'void' }).where(eq(saasInvoice.id, id));
        expect(
          await stateOf(tx, (sp) =>
            sp.update(saasInvoice).set({ totalPaise: 0 }).where(eq(saasInvoice.id, id)),
          ),
        ).toBe('42501');

        const [row] = await tx.select().from(saasInvoice).where(eq(saasInvoice.id, id));
        expect(row).toMatchObject({ status: 'void', pdfBlobId: 'blob_1', totalPaise: 11_900 });
      });
    });
  });

  it('freezes the lines of an issued invoice', async () => {
    await withTestDb(async (outer) => {
      const ws = await newWorkspace(outer);
      await inWorkspace(outer, ws, async (tx) => {
        const id = await draftInvoice(tx, ws);
        const line = await addLine(tx, ws, id);
        await tx.update(saasInvoiceLine).set({ quantity: 2 }).where(eq(saasInvoiceLine.id, line));
        await issue(tx, id);

        expect(
          await stateOf(tx, (sp) =>
            sp.update(saasInvoiceLine).set({ quantity: 3 }).where(eq(saasInvoiceLine.id, line)),
          ),
        ).toBe('42501');
        expect(await stateOf(tx, (sp) => addLine(sp, ws, id))).toBe('42501');
        // Moving a draft's line onto the issued invoice is a change to the issued invoice.
        const other = await draftInvoice(tx, ws);
        const otherLine = await addLine(tx, ws, other);
        expect(
          await stateOf(tx, (sp) =>
            sp
              .update(saasInvoiceLine)
              .set({ invoiceId: id })
              .where(eq(saasInvoiceLine.id, otherLine)),
          ),
        ).toBe('42501');
      });
    });
  });

  it('still deletes issued invoices and lines with their workspace', async () => {
    await withTestDb(async (outer) => {
      const ws = await newWorkspace(outer);
      await inWorkspace(outer, ws, async (tx) => {
        const id = await draftInvoice(tx, ws);
        await addLine(tx, ws, id);
        await issue(tx, id);
        await tx.delete(organization).where(eq(organization.id, ws));
        expect(await tx.select().from(saasInvoice).where(eq(saasInvoice.id, id))).toEqual([]);
        expect(
          await tx.select().from(saasInvoiceLine).where(eq(saasInvoiceLine.invoiceId, id)),
        ).toEqual([]);
      });
    });
  });

  it("rejects a line pointing at another workspace's invoice", async () => {
    await withTestDb(async (outer) => {
      const a = await newWorkspace(outer);
      const b = await newWorkspace(outer);
      const bInvoice = await inWorkspace(outer, b, (tx) => draftInvoice(tx, b));
      await inWorkspace(outer, a, async (tx) => {
        expect(await violation(tx, (sp) => addLine(sp, a, bInvoice))).toBe(
          'saas_invoice_line_invoice_fk',
        );
      });
    });
  });

  it('enforces the invoice and counter checks', async () => {
    await withTestDb(async (outer) => {
      const ws = await newWorkspace(outer);
      await inWorkspace(outer, ws, async (tx) => {
        const row = { ...DRAFT, workspaceId: ws };
        const insert = (values: Partial<typeof saasInvoice.$inferInsert>) => (sp: Transaction) =>
          sp.insert(saasInvoice).values({ ...row, ...values });
        expect(await violation(tx, insert({ status: 'issued' }))).toBe(
          'saas_invoice_number_issued_chk',
        );
        expect(
          await violation(
            tx,
            insert({ status: 'sent', number: 'CD/26-27/000001', issueDate: '2026-10-19' }),
          ),
        ).toBe('saas_invoice_status_chk');
        expect(await violation(tx, insert({ currency: 'USD' }))).toBe('saas_invoice_currency_chk');
        expect(await violation(tx, insert({ igstPaise: -1 }))).toBe('saas_invoice_amounts_chk');
        expect(await violation(tx, insert({ placeOfSupplyStateCode: 'KA' }))).toBe(
          'saas_invoice_place_of_supply_chk',
        );
        const id = await draftInvoice(tx, ws);
        const [stored] = await tx.select().from(saasInvoice).where(eq(saasInvoice.id, id));
        expect(stored).toMatchObject({
          status: 'draft',
          sac: '998314',
          currency: 'INR',
          number: null,
        });
      });

      const series = `T${randomUUID().slice(0, 8)}`;
      await outer.insert(invoiceCounter).values({ series, fy: '26-27' });
      expect(
        await violation(outer, (sp) => sp.insert(invoiceCounter).values({ series, fy: '26-27' })),
      ).toBe('invoice_counter_pkey');
      expect(
        await violation(outer, (sp) =>
          sp.insert(invoiceCounter).values({ series, fy: '27-28', lastNumber: -1 }),
        ),
      ).toBe('invoice_counter_last_number_chk');
    });
  });

  it('allows one invoice per provider payment in a workspace (0023, #255)', async () => {
    await withTestDb(async (tx) => {
      const ws = await newWorkspace(tx);
      const other = await newWorkspace(tx);
      const withPayment =
        (workspaceId: string, providerPaymentId: string | null) => (sp: Transaction) =>
          inWorkspace(sp, workspaceId, (s) =>
            s.insert(saasInvoice).values({ ...DRAFT, workspaceId, providerPaymentId }),
          );
      expect(await violation(tx, withPayment(ws, 'pay_1'))).toBeUndefined();
      expect(await violation(tx, withPayment(ws, 'pay_1'))).toBe('saas_invoice_payment_uq');
      // Another workspace, another payment, and invoices without a payment are unaffected.
      expect(await violation(tx, withPayment(other, 'pay_1'))).toBeUndefined();
      expect(await violation(tx, withPayment(ws, 'pay_2'))).toBeUndefined();
      expect(await violation(tx, withPayment(ws, null))).toBeUndefined();
      expect(await violation(tx, withPayment(ws, null))).toBeUndefined();
    });
  });
});
