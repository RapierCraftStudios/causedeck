// Audit export (#229, #26 part 4): CSV (header, optional BOM, quoting, formula guard) and JSON
// Lines, the owner-only IP column, the audit.read gate, the `audit.exported` event written before
// any byte, and a 100k-row export that streams page by page in under 64 MB of heap growth. Every
// test runs in a rolled-back app-role transaction.
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';

import { schema, withWorkspace, type Transaction } from '@causedeck/db';
import { withTestDb } from '@causedeck/db/testing';
import { and, eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import type { WorkspaceError } from '../../workspaces/index.ts';
import { AUDIT_EXPORT_COLUMNS, exportAudit, record } from '../index.ts';
import { addMember, failure, newWorkspace } from '../../__tests__/fixtures.ts';

// A full collection before each heap sample, so the bound measures what the export retains rather
// than garbage the collector has not reached yet.
setFlagsFromString('--expose-gc');
const gc = runInNewContext('gc') as () => void;

const FROM = new Date('2000-01-01T00:00:00Z');
const to = () => new Date(Date.now() + 86_400_000);

async function readAll(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

const text = (bytes: Uint8Array) => new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);

async function exportedEvents(tx: Transaction, workspaceId: string) {
  return withWorkspace(tx, { workspaceId }, (s) =>
    s
      .select({
        actorUserId: schema.auditEvent.actorUserId,
        metadata: schema.auditEvent.metadata,
        ip: schema.auditEvent.ip,
      })
      .from(schema.auditEvent)
      .where(
        and(
          eq(schema.auditEvent.workspaceId, workspaceId),
          eq(schema.auditEvent.action, 'audit.exported'),
        ),
      ),
  );
}

async function seed(tx: Transaction) {
  const { ownerId, workspaceId } = await newWorkspace(tx);
  const advocate = await addMember(tx, workspaceId, 'advocate');
  await record(
    {
      db: tx,
      workspaceId,
      actor: { userId: ownerId, kind: 'user' },
      ip: '203.0.113.7',
      requestId: '=cmd|"x",y',
    },
    {
      action: 'member.removed',
      target: { kind: 'member', id: 'm,1' },
      metadata: { note: 'a "quoted", value' },
    },
  );
  return {
    ownerId,
    workspaceId,
    advocate,
    ctx: (userId: string) => ({ db: tx, workspaceId, userId }),
  };
}

describe('exportAudit', () => {
  it('streams CSV with a header row, optional BOM, RFC 4180 quoting and a formula guard', async () => {
    await withTestDb(async (tx) => {
      const { ownerId, ctx } = await seed(tx);
      const bytes = await readAll(
        await exportAudit(ctx(ownerId), { from: FROM, to: to(), format: 'csv', bom: true }),
      );
      expect(Array.from(bytes.subarray(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
      const lines = text(bytes.slice(3)).split('\r\n');
      expect(lines[0]).toBe([...AUDIT_EXPORT_COLUMNS, 'ip'].join(','));
      const removed = lines.find((l) => l.includes('member.removed')) ?? '';
      expect(removed).toContain(`"'=cmd|""x"",y"`);
      expect(removed).toContain('"m,1"');
      expect(removed).toContain('"{""note"":""a \\""quoted\\"", value""}"');
      expect(removed.endsWith(',203.0.113.0/24')).toBe(true);
      expect(lines.at(-1)).toBe('');

      const plain = text(
        await readAll(await exportAudit(ctx(ownerId), { from: FROM, to: to(), format: 'csv' })),
      );
      expect(plain.startsWith('id,created_at,')).toBe(true);
      return null;
    });
  });

  it('streams JSON Lines with the documented keys', async () => {
    await withTestDb(async (tx) => {
      const { ownerId, ctx } = await seed(tx);
      const lines = text(
        await readAll(await exportAudit(ctx(ownerId), { from: FROM, to: to(), format: 'jsonl' })),
      )
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as Record<string, unknown>);
      const removed = lines.find((l) => l.action === 'member.removed');
      expect(Object.keys(removed ?? {})).toEqual([...AUDIT_EXPORT_COLUMNS, 'ip']);
      expect(removed?.metadata).toEqual({ note: 'a "quoted", value' });
      expect(removed?.ip).toBe('203.0.113.0/24');
      return null;
    });
  });

  it('leaves the IP column out for advocates', async () => {
    await withTestDb(async (tx) => {
      const { advocate, ctx } = await seed(tx);
      const csv = text(
        await readAll(await exportAudit(ctx(advocate), { from: FROM, to: to(), format: 'csv' })),
      );
      expect(csv.split('\r\n')[0]).toBe(AUDIT_EXPORT_COLUMNS.join(','));
      expect(csv).not.toContain('203.0.113');
      const jsonl = text(
        await readAll(await exportAudit(ctx(advocate), { from: FROM, to: to(), format: 'jsonl' })),
      );
      expect(jsonl).not.toContain('"ip"');
      return null;
    });
  });

  it('records audit.exported before streaming, and nothing when denied', async () => {
    await withTestDb(async (tx) => {
      const { ownerId, workspaceId, ctx } = await seed(tx);
      const viewer = await addMember(tx, workspaceId, 'viewer');
      const denied = await failure(
        exportAudit(ctx(viewer), { from: FROM, to: to(), format: 'csv' }),
      );
      expect((denied as WorkspaceError).code).toBe('FORBIDDEN');
      expect(await exportedEvents(tx, workspaceId)).toEqual([]);

      const stream = await exportAudit(
        { ...ctx(ownerId), ip: '198.51.100.9' },
        { from: FROM, to: new Date('2100-01-01T00:00:00Z'), format: 'jsonl' },
      );
      const [event] = await exportedEvents(tx, workspaceId);
      expect(event).toEqual({
        actorUserId: ownerId,
        ip: '198.51.100.9',
        metadata: { format: 'jsonl', from: FROM.toISOString(), to: '2100-01-01T00:00:00.000Z' },
      });
      await stream.cancel();

      const bad = await failure(exportAudit(ctx(ownerId), { from: to(), to: FROM, format: 'csv' }));
      expect((bad as WorkspaceError).code).toBe('VALIDATION');
      return null;
    });
  });

  it(
    'exports 100k rows page by page with under 64 MB of heap growth',
    { timeout: 300_000 },
    async () => {
      const ROWS = 100_000;
      await withTestDb(async (tx) => {
        const { ownerId, workspaceId, ctx } = await seed(tx);
        // Bulk rows straight into the table (app_audit_append would rescan the chain per row); the
        // export does not verify hashes, only distinct prev_hash values are needed for the chain key.
        await withWorkspace(tx, { workspaceId }, (s) =>
          s.execute(sql`
          insert into audit_event (workspace_id, actor_user_id, actor_kind, action, target_kind, target_id,
                                   request_id, user_agent_hash, metadata, prev_hash, hash, created_at)
          select ${workspaceId}::uuid, ${ownerId}::uuid, 'user', 'member.role_changed', 'member', g::text,
                 'req-' || g, repeat('a', 64), jsonb_build_object('n', g, 'role', 'advocate'),
                 sha256(convert_to('p' || g, 'UTF8')), sha256(convert_to('h' || g, 'UTF8')),
                 '2020-01-01T00:00:00Z'::timestamptz + g * interval '1 second'
          from generate_series(1, ${ROWS}) g`),
        );
        const range = {
          from: new Date('2020-01-01T00:00:00Z'),
          to: new Date('2021-01-01T00:00:00Z'),
        };

        for (const format of ['csv', 'jsonl'] as const) {
          gc();
          const baseline = process.memoryUsage().heapUsed;
          let peak = 0;
          let bytes = 0;
          let lines = 0;
          let pending = '';
          let chunks = 0;
          const stream = await exportAudit(ctx(ownerId), { ...range, format, bom: true });
          const decoder = new TextDecoder();
          for await (const chunk of stream) {
            bytes += chunk.byteLength;
            const parts = (pending + decoder.decode(chunk, { stream: true })).split('\n');
            pending = parts.pop() ?? '';
            lines += parts.length;
            if (++chunks % 10 === 0) {
              gc();
              peak = Math.max(peak, process.memoryUsage().heapUsed - baseline);
            }
          }
          expect(pending).toBe('');
          expect(lines, format).toBe(format === 'csv' ? ROWS + 1 : ROWS);
          expect(bytes).toBeGreaterThan(ROWS * 100);
          // The whole export is several times larger than one page; streaming keeps the heap flat.
          expect(peak, `${format} heap growth ${String(Math.round(peak / 1e6))} MB`).toBeLessThan(
            64 * 1024 * 1024,
          );
        }
        return null;
      });
    },
  );
});
