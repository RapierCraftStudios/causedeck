// Cross-tenant audit read, export and verify (#229, #26 part 4): B's owner cannot read, export or
// verify workspace A's events, neither from B's scope (TENANCY_VIOLATION) nor by naming A's id
// (NOT_FOUND, since B's owner is not a member of A); a denied export writes nothing to A; and B's
// own feed, export and chain contain only B's events. Every test runs in a rolled-back app-role
// transaction. The registry-driven suite is packages/core/src/__tests__/cross-tenant.
import { schema, withWorkspace, type Transaction } from '@causedeck/db';
import { withTestDb } from '@causedeck/db/testing';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { WorkspaceError } from '../../workspaces/errors.ts';
import { authorizeAuditRead, exportAudit, queryAudit, record, verifyChain } from '../index.ts';
import { failure, newWorkspace } from './fixtures.ts';

const range = () => ({ from: new Date('2000-01-01T00:00:00Z'), to: new Date(Date.now() + 86_400_000) });

async function seed(tx: Transaction) {
  const a = await newWorkspace(tx);
  const b = await newWorkspace(tx);
  for (const ws of [a, b]) {
    await record(
      { db: tx, workspaceId: ws.workspaceId, actor: { userId: ws.ownerId, kind: 'user' } },
      { action: 'flag.changed', metadata: { flag: 'x' } },
    );
  }
  return { a, b };
}

async function eventIds(tx: Transaction, workspaceId: string): Promise<string[]> {
  const rows = await withWorkspace(tx, { workspaceId }, (s) =>
    s
      .select({ id: schema.auditEvent.id })
      .from(schema.auditEvent)
      .where(eq(schema.auditEvent.workspaceId, workspaceId)),
  );
  return rows.map((r) => r.id).sort();
}

async function code(promise: Promise<unknown>): Promise<string | undefined> {
  const error = await failure(promise);
  return (error as { code?: string } | undefined)?.code;
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return new TextDecoder().decode(Buffer.concat(chunks));
}

describe('audit cross-tenant', () => {
  it("B's owner cannot read, export or verify A's events from B's scope", async () => {
    await withTestDb(async (tx) => {
      const { a, b } = await seed(tx);
      const before = await eventIds(tx, a.workspaceId);
      const asB = <T>(fn: (s: Transaction) => Promise<T>) =>
        withWorkspace(tx, { workspaceId: b.workspaceId, userId: b.ownerId }, fn);
      const ctxA = (s: Transaction) => ({ db: s, workspaceId: a.workspaceId, userId: b.ownerId });

      expect(await code(asB((s) => authorizeAuditRead(ctxA(s))))).toBe('TENANCY_VIOLATION');
      expect(await code(asB((s) => queryAudit(ctxA(s))))).toBe('TENANCY_VIOLATION');
      expect(await code(asB((s) => exportAudit(ctxA(s), { ...range(), format: 'csv' })))).toBe(
        'TENANCY_VIOLATION',
      );
      expect(await code(asB((s) => verifyChain(s, a.workspaceId)))).toBe('TENANCY_VIOLATION');
      expect(await eventIds(tx, a.workspaceId)).toEqual(before);
      return null;
    });
  });

  it("naming A's id is NOT_FOUND for B's owner, and a denied export writes nothing to A", async () => {
    await withTestDb(async (tx) => {
      const { a, b } = await seed(tx);
      const before = await eventIds(tx, a.workspaceId);
      const ctx = { db: tx, workspaceId: a.workspaceId, userId: b.ownerId };

      // One at a time: they share the test transaction.
      for (const attempt of [
        () => authorizeAuditRead(ctx),
        () => queryAudit(ctx),
        () => exportAudit(ctx, { ...range(), format: 'jsonl' }),
      ]) {
        const error = await failure(attempt());
        expect(error).toBeInstanceOf(WorkspaceError);
        expect((error as WorkspaceError).code).toBe('NOT_FOUND');
      }
      expect(await eventIds(tx, a.workspaceId)).toEqual(before);
      return null;
    });
  });

  it("B's own feed, export and chain hold only B's events", async () => {
    await withTestDb(async (tx) => {
      const { a, b } = await seed(tx);
      const aIds = await eventIds(tx, a.workspaceId);
      const ctx = { db: tx, workspaceId: b.workspaceId, userId: b.ownerId };

      const page = await queryAudit(ctx, { limit: 200 });
      expect(page.events.map((e) => e.id).sort()).toEqual(await eventIds(tx, b.workspaceId));

      const lines = (await readAll(await exportAudit(ctx, { ...range(), format: 'jsonl' })))
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as { id: string });
      // The export includes its own `audit.exported` event, recorded in B.
      expect(lines.map((l) => l.id).sort()).toEqual(await eventIds(tx, b.workspaceId));
      for (const id of aIds) expect(lines.map((l) => l.id)).not.toContain(id);

      const chain = await verifyChain(tx, b.workspaceId);
      expect(chain).toEqual({ ok: true, checked: (await eventIds(tx, b.workspaceId)).length });
      return null;
    });
  });
});
