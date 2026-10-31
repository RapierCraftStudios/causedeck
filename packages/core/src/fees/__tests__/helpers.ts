import { schema, withWorkspace } from '@causedeck/db';
import type { Transaction } from '@causedeck/db';

import { addMember, newWorkspace } from '../../__tests__/fixtures.ts';
import type { FeesDeps } from '../scope.ts';

export type Tx = Transaction;

export function deps(tx: Tx, over: Partial<FeesDeps> = {}): FeesDeps {
  return {
    db: tx,
    flagEnabled: () => Promise.resolve(true),
    now: () => new Date('2026-11-02T10:00:00Z'),
    ...over,
  };
}

/** A chamber (owner, advocate, junior, clerk) plus a viewer, with one client and one matter. */
export async function chamber(tx: Tx) {
  const { ownerId, workspaceId } = await newWorkspace(tx);
  const as = (userId: string) => ({ userId, workspaceId });
  const [matter] = await withWorkspace(tx, { workspaceId }, (s) =>
    s
      .insert(schema.matter)
      .values({ workspaceId, title: 'Rao v Meena' })
      .returning({ id: schema.matter.id }),
  );
  const [client] = await withWorkspace(tx, { workspaceId }, (s) =>
    s
      .insert(schema.person)
      .values({ workspaceId, name: 'A. Rao', kind: 'client', sourceType: 'manual' })
      .returning({ id: schema.person.id }),
  );
  if (!matter || !client) throw new Error('fixture insert failed');
  return {
    workspaceId,
    matterId: matter.id,
    personId: client.id,
    owner: as(ownerId),
    advocate: as(await addMember(tx, workspaceId, 'advocate')),
    junior: as(await addMember(tx, workspaceId, 'junior')),
    clerk: as(await addMember(tx, workspaceId, 'clerk')),
    viewer: as(await addMember(tx, workspaceId, 'viewer')),
  };
}

export const SUPPLIER = { name: 'Chambers', stateCode: '27', gstin: '27ABCDE1234F1Z5' };

export function agreementInput(c: { matterId: string; personId: string }) {
  return {
    matterId: c.matterId,
    personId: c.personId,
    basis: 'fixed',
    amountPaise: 500_000,
    gstTreatment: 'forward_charge',
    startsOn: '2026-11-01',
  };
}

export function invoiceInput(c: { matterId: string; personId: string }) {
  return {
    matterId: c.matterId,
    personId: c.personId,
    placeOfSupplyStateCode: '27',
    lines: [
      {
        description: 'Drafting',
        quantity: 2,
        unitPricePaise: 100_000,
        amountPaise: 200_000,
        gstTreatment: 'forward_charge',
      },
    ],
  };
}
