// The billing page's invoice list against a real Postgres (#256). Every test runs in a rolled-back
// transaction under FORCE row-level security.
import { randomUUID } from 'node:crypto';

import { schema, type Transaction } from '@causedeck/db';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { describe, expect, it } from 'vitest';

import { createWorkspace } from '../../workspaces/index.ts';
import { listSaasInvoices } from '../index.ts';

const PARTY = { legalName: 'Party', address: 'Chennai', gstin: null, stateCode: '33' };

async function newWorkspace(tx: Transaction): Promise<string> {
  const [user] = await tx
    .insert(schema.user)
    .values({ name: 'Owner', email: `${randomUUID()}@example.test` })
    .returning({ id: schema.user.id });
  if (!user) throw new Error('user insert failed');
  const workspace = await createWorkspace(tx, {
    userId: user.id,
    input: { name: `Chambers ${randomUUID().slice(0, 8)}` },
  });
  return workspace.id;
}

function invoice(
  tx: Transaction,
  workspaceId: string,
  values: Partial<typeof schema.saasInvoice.$inferInsert>,
) {
  return inWorkspace(tx, workspaceId, (s) =>
    s.insert(schema.saasInvoice).values({
      workspaceId,
      series: 'CD',
      fy: '26-27',
      supplier: PARTY,
      recipient: PARTY,
      placeOfSupplyStateCode: '33',
      ...values,
    }),
  );
}

/**
 * Invoice numbers unique to this run (numbers are globally unique). One prefix per run, so numbers
 * sort by `n`: the ordering test's tiebreak on equal issue dates depends on it.
 */
const RUN = `T${randomUUID().slice(0, 6)}`;
const num = (n: number) => `${RUN}/${String(n).padStart(6, '0')}`;

describe('listSaasInvoices', () => {
  it('lists issued, paid and void invoices newest first and never drafts', async () => {
    await withTestDb(async (tx) => {
      const workspaceId = await newWorkspace(tx);
      const [first, second, third] = [num(1), num(2), num(3)];
      await invoice(tx, workspaceId, {
        number: first,
        status: 'paid',
        issueDate: '2026-04-01',
        totalPaise: 117_882,
        pdfBlobId: 'blob-1',
      });
      await invoice(tx, workspaceId, {
        number: second,
        status: 'void',
        issueDate: '2026-05-01',
        totalPaise: 117_882,
      });
      await invoice(tx, workspaceId, {
        number: third,
        status: 'issued',
        issueDate: '2026-05-01',
        totalPaise: 235_764,
      });
      await invoice(tx, workspaceId, { status: 'draft', totalPaise: 1 });

      const rows = await inWorkspace(tx, workspaceId, (s) => listSaasInvoices(s, workspaceId));
      expect(rows.map((r) => r.number)).toEqual([third, second, first]);
      expect(rows[2]).toMatchObject({
        issueDate: '2026-04-01',
        status: 'paid',
        totalPaise: 117_882,
        pdfBlobId: 'blob-1',
      });
      expect(rows[0]?.pdfBlobId).toBeNull();
    });
  });

  it("never returns another workspace's invoices", async () => {
    await withTestDb(async (tx) => {
      const a = await newWorkspace(tx);
      const b = await newWorkspace(tx);
      await invoice(tx, a, { number: num(4), status: 'issued', issueDate: '2026-04-01' });
      expect(await inWorkspace(tx, b, (s) => listSaasInvoices(s, a))).toEqual([]);
      expect(await inWorkspace(tx, b, (s) => listSaasInvoices(s, b))).toEqual([]);
      expect(await inWorkspace(tx, a, (s) => listSaasInvoices(s, a))).toHaveLength(1);
    });
  });
});
