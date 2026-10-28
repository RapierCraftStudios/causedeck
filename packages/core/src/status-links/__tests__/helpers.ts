import { schema, withWorkspace, type Transaction } from '@causedeck/db';

import { addMember, newWorkspace } from '../../__tests__/fixtures.ts';
import type { StatusLinkDeps } from '../create.ts';

export type Tx = Transaction;

export const NOW = new Date('2026-11-02T10:00:00Z');

/** Deps with the flag on (or off), a fixed clock and a fixed token. */
export function deps(tx: Tx, over: Partial<StatusLinkDeps> = {}): StatusLinkDeps {
  return {
    db: tx,
    flagEnabled: () => Promise.resolve(true),
    now: () => NOW,
    baseUrl: 'https://app.example.test/',
    ...over,
  };
}

/** A chamber (owner, advocate, junior, clerk, viewer) with a matter and a client contact. */
export async function chamber(tx: Tx) {
  const { ownerId, workspaceId } = await newWorkspace(tx);
  const as = (userId: string) => ({ userId, workspaceId });
  const { matter, contact } = await withWorkspace(tx, { workspaceId }, async (ws) => {
    const [matter] = await ws
      .insert(schema.matter)
      .values({ workspaceId, title: 'Rao v Meena Traders', practiceArea: 'civil' })
      .returning({ id: schema.matter.id });
    const [person] = await ws
      .insert(schema.person)
      .values({ workspaceId, name: 'A. Rao', kind: 'party', sourceType: 'manual' })
      .returning({ id: schema.person.id });
    const [contact] = await ws
      .insert(schema.clientContact)
      .values({ workspaceId, personId: person!.id, phone: '+919876543210', createdBy: ownerId })
      .returning({ id: schema.clientContact.id });
    return { matter: matter!, contact: contact! };
  });
  return {
    workspaceId,
    matterId: matter.id,
    contactId: contact.id,
    owner: as(ownerId),
    advocate: as(await addMember(tx, workspaceId, 'advocate')),
    junior: as(await addMember(tx, workspaceId, 'junior')),
    clerk: as(await addMember(tx, workspaceId, 'clerk')),
    viewer: as(await addMember(tx, workspaceId, 'viewer')),
  };
}

export function input(c: { matterId: string; contactId: string }, over: object = {}) {
  return {
    matterId: c.matterId,
    clientContactId: c.contactId,
    headline: 'Status as on 2 November',
    note: 'The matter is listed on 20 November.',
    ...over,
  };
}

/** Run `fn` on the workspace's transaction (RLS scope) for direct table reads and writes. */
export function inWs<T>(tx: Tx, workspaceId: string, fn: (t: Tx) => Promise<T>): Promise<T> {
  return withWorkspace(tx, { workspaceId }, fn);
}
