import type { Transaction } from '@causedeck/db';

import { addMember, newWorkspace } from '../../__tests__/fixtures.ts';
import type { IntakeDeps } from '../scope.ts';

export type Tx = Transaction;

/** Deps with the flag on (or off) and a fixed clock. */
export function deps(tx: Tx, over: Partial<IntakeDeps> = {}): IntakeDeps {
  return {
    db: tx,
    flagEnabled: () => Promise.resolve(true),
    now: () => new Date('2026-11-02T10:00:00Z'),
    ...over,
  };
}

/** A chamber (owner, advocate, junior, clerk) plus a viewer. */
export async function chamber(tx: Tx) {
  const { ownerId, workspaceId } = await newWorkspace(tx);
  const as = (userId: string) => ({ userId, workspaceId });
  return {
    workspaceId,
    owner: as(ownerId),
    advocate: as(await addMember(tx, workspaceId, 'advocate')),
    junior: as(await addMember(tx, workspaceId, 'junior')),
    clerk: as(await addMember(tx, workspaceId, 'clerk')),
    viewer: as(await addMember(tx, workspaceId, 'viewer')),
  };
}

export const ENQUIRY = {
  enquirerName: 'A. Rao',
  channel: 'phone',
  summary: 'Tenancy dispute',
  parties: [
    { name: 'Meena Traders', side: 'adverse' },
    { name: 'A. Rao', side: 'client' },
  ],
} as const;
