// Shared fixtures of the memory tests (#72): the two-tenant world plus, in workspace A, a clerk, a
// junior, a viewer, two matters and three people. `tx` is the rolled-back app-role transaction of
// `withTestDb`, so FORCE RLS applies as in production. The two-tenant seed's memory rows are
// dropped, so a test sees only the memory it creates.
import { randomBytes, randomUUID } from 'node:crypto';

import { Secret } from '@causedeck/config/env';
import { schema, type Transaction } from '@causedeck/db';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { buildMatter, buildPerson } from '@causedeck/db/testing/matter-graph-fixtures';
import { seedTwoTenants, type TwoTenants } from '@causedeck/db/testing/two-tenants';
import { EnvKeyProvider } from '@causedeck/storage';

import type { MemoryActor, MemoryDeps } from '../memory/index.ts';

export const keys = new EnvKeyProvider([{ id: 'kek-1', key: new Secret(randomBytes(32)) }]);

export interface World extends TwoTenants {
  tx: Transaction;
  clerk: string;
  junior: string;
  viewer: string;
  m1: string;
  m2: string;
  client: string;
  professional: string;
  party: string;
  deps: MemoryDeps;
  /** The same deps with a fixed clock. */
  at(now: Date): MemoryDeps;
  owner: MemoryActor;
  advocate: MemoryActor;
  asClerk: MemoryActor;
  asJunior: MemoryActor;
  asViewer: MemoryActor;
  /** Workspace B's owner. */
  ownerB: MemoryActor;
}

async function newMember(
  tx: Transaction,
  workspaceId: string,
  role: 'clerk' | 'junior' | 'viewer',
) {
  const id = randomUUID();
  await tx.insert(schema.user).values({ id, name: role, email: `${id}@example.test` });
  await inWorkspace(tx, workspaceId, (s) =>
    s.insert(schema.member).values({ organizationId: workspaceId, userId: id, role }),
  );
  return id;
}

export async function world(tx: Transaction): Promise<World> {
  const t = await seedTwoTenants(tx);
  // The two-tenant seed holds a placeholder workspace key (drop it so the service creates a real
  // one), a pause-all row for each owner (drop it so memory starts switched on) and opaque memory
  // rows that cannot be decrypted (drop them so the tests see only what they create).
  for (const id of [t.a.id, t.b.id]) {
    await inWorkspace(tx, id, async (s) => {
      await s.delete(schema.workspaceKey);
      await s.delete(schema.memoryPause);
      await s.delete(schema.memoryUsage);
      await s.delete(schema.memoryEmbedding);
      await s.delete(schema.memoryProposal);
      await s.delete(schema.memoryItem);
    });
  }
  const clerk = await newMember(tx, t.a.id, 'clerk');
  const junior = await newMember(tx, t.a.id, 'junior');
  const viewer = await newMember(tx, t.a.id, 'viewer');
  const built = await inWorkspace(tx, t.a.id, async (s) => ({
    m1: (await buildMatter(s, t.a.id, { title: 'Matter one' })).id,
    m2: (await buildMatter(s, t.a.id, { title: 'Matter two' })).id,
    client: (await buildPerson(s, t.a.id, { name: 'Client One', kind: 'client' })).id,
    professional: (await buildPerson(s, t.a.id, { name: 'Counsel One', kind: 'professional' })).id,
    party: (await buildPerson(s, t.a.id, { name: 'Party One', kind: 'party' })).id,
  }));
  const deps: MemoryDeps = { db: tx, keys };
  return {
    ...t,
    ...built,
    tx,
    clerk,
    junior,
    viewer,
    deps,
    at: (now) => ({ ...deps, now: () => now }),
    owner: { userId: t.ua, workspaceId: t.a.id },
    advocate: { userId: t.uboth, workspaceId: t.a.id },
    asClerk: { userId: clerk, workspaceId: t.a.id },
    asJunior: { userId: junior, workspaceId: t.a.id },
    asViewer: { userId: viewer, workspaceId: t.a.id },
    ownerB: { userId: t.ub, workspaceId: t.b.id },
  };
}

/** Run `fn` in a rolled-back test transaction with the world seeded. */
export function inWorld<T>(fn: (w: World) => Promise<T>): Promise<T> {
  return withTestDb(async (tx) => fn(await world(tx)));
}

/** The `code` of the error `promise` rejects with, or undefined when it resolves. */
export async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return undefined;
}

/** The message of the error `promise` rejects with. */
export async function messageOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    return (error as Error).message;
  }
  return undefined;
}

export const DAY_MS = 24 * 60 * 60 * 1000;
export const T0 = new Date('2026-10-20T10:00:00.000Z');
