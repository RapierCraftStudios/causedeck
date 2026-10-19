// Fixtures for the DB-backed storage crypto tests: fresh workspaces (no seeded key rows) and a KEK.
import { randomBytes, randomUUID } from 'node:crypto';

import { Secret } from '@causedeck/config/env';
import type { Transaction } from '@causedeck/db';
import { organization } from '@causedeck/db/schema';
import { inWorkspace } from '@causedeck/db/testing';

import type { Kek } from '../index.ts';

/** Create a workspace (the `organization` row) inside its own scope, as `createWorkspace` does. */
export async function newWorkspace(tx: Transaction): Promise<string> {
  const id = randomUUID();
  await inWorkspace(tx, id, (scoped) =>
    scoped.insert(organization).values({ id, name: 'Storage test', slug: `st-${id}` }),
  );
  return id;
}

export function newKek(id: string): Kek {
  return { id, key: new Secret(randomBytes(32)) };
}

export async function collect(source: AsyncIterable<Uint8Array>): Promise<Buffer> {
  const parts: Buffer[] = [];
  for await (const part of source) parts.push(Buffer.from(part));
  return Buffer.concat(parts);
}

export async function rejection(promise: Promise<unknown>): Promise<{ code?: unknown }> {
  try {
    await promise;
  } catch (error) {
    return error as { code?: unknown };
  }
  throw new Error('expected a rejection');
}
