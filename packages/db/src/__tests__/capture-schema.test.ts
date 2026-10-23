// The capture inbox tables (#43): tenant tables under FORCE row-level security, the status, channel
// and scan CHECKs, composite FKs that keep a capture inside its workspace, the SET NULL actions that
// never null `workspace_id`, the two indexes, and the retention targets function.
import { createHash, randomUUID } from 'node:crypto';

import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { registeredTenantTables } from '../rls-policies.ts';
import { capture, workspaceCaptureChannel } from '../schema/capture.ts';
import { document } from '../schema/documents.ts';
import { matter } from '../schema/matter-graph.ts';
import { inWorkspace, withTestDb } from '../testing/index.ts';
import { newWorkspace, sqlState } from './rls/fixtures.ts';

const sha = () => createHash('sha256').update(randomUUID()).digest('hex');
const base = { channel: 'upload' as const, mime: 'application/pdf', sizeBytes: 10 };

describe('capture tables', () => {
  it('are tenant tables under FORCE RLS with ws_isolation (and the definer read for retention)', async () => {
    expect(registeredTenantTables()).toEqual(
      expect.arrayContaining(['capture', 'workspace_capture_channel']),
    );
    await withTestDb(async (tx) => {
      const rows = await tx.execute<{ name: string; forced: boolean; policies: string[] }>(sql`
        select c.relname::text as name, c.relforcerowsecurity as forced,
               array(select polname::text from pg_policy where polrelid = c.oid order by 1) as policies
          from pg_class c
         where c.relname in ('capture', 'workspace_capture_channel') order by 1`);
      expect(rows).toEqual([
        { name: 'capture', forced: true, policies: ['owner_definer_read', 'ws_isolation'] },
        { name: 'workspace_capture_channel', forced: true, policies: ['ws_isolation'] },
      ]);
    });
  });

  it('defaults a new capture to received, pending scan, unpinned and not AI-blocked', async () => {
    await withTestDb(async (tx) => {
      const ws = await newWorkspace(tx);
      await inWorkspace(tx, ws.id, async (s) => {
        const [row] = await s
          .insert(capture)
          .values({ workspaceId: ws.id, ...base })
          .returning();
        expect(row).toMatchObject({
          status: 'received',
          scanStatus: 'pending',
          pinned: false,
          aiBlocked: false,
          sha256: null,
          rawStorageKey: null,
          ttlAt: null,
          sourceMeta: {},
        });
      });
    });
  });

  it('rejects an unknown channel, status or scan status, a bad hash and a negative size', async () => {
    await withTestDb(async (tx) => {
      const ws = await newWorkspace(tx);
      await inWorkspace(tx, ws.id, async (s) => {
        const bad: Record<string, unknown>[] = [
          { channel: 'sms' },
          { status: 'done' },
          { scanStatus: 'unknown' },
          { sha256: 'ABC' },
          { sizeBytes: -1 },
        ];
        for (const patch of bad) {
          const state = await sqlState(
            s.transaction((sp) =>
              sp.insert(capture).values({ workspaceId: ws.id, ...base, ...patch } as never),
            ),
          );
          expect(state, JSON.stringify(patch)).toBe('23514');
        }
      });
    });
  });

  it('keeps links inside the workspace and clears them without nulling workspace_id', async () => {
    await withTestDb(async (tx) => {
      const a = await newWorkspace(tx);
      const b = await newWorkspace(tx);
      const matterB = await inWorkspace(tx, b.id, (s) =>
        s
          .insert(matter)
          .values({ workspaceId: b.id, title: 'B matter' })
          .returning({ id: matter.id }),
      );
      await inWorkspace(tx, a.id, async (s) => {
        // A matter hint from another workspace violates the composite FK.
        expect(
          await sqlState(
            s.transaction((sp) =>
              sp.insert(capture).values({
                workspaceId: a.id,
                ...base,
                matterHintId: matterB[0]?.id ?? '',
              }),
            ),
          ),
        ).toBe('23503');

        const [matterA] = await s
          .insert(matter)
          .values({ workspaceId: a.id, title: 'A matter' })
          .returning({ id: matter.id });
        const [original] = await s
          .insert(capture)
          .values({ workspaceId: a.id, ...base, sha256: sha() })
          .returning({ id: capture.id });
        const [dup] = await s
          .insert(capture)
          .values({
            workspaceId: a.id,
            ...base,
            status: 'duplicate',
            dedupeOfCaptureId: original?.id ?? '',
            matterHintId: matterA?.id ?? '',
          })
          .returning({ id: capture.id });
        const [doc] = await s
          .insert(document)
          .values({
            workspaceId: a.id,
            kind: 'order',
            storageKey: 'ws/x',
            sha256: sha(),
            sourceCaptureId: original?.id ?? '',
          } as never)
          .returning({ id: document.id });
        expect(doc?.id).toBeTruthy();

        // Deleting the original, and the matter, clears the links: workspace_id stays.
        await s.delete(document).where(eq(document.id, doc?.id ?? ''));
        await s.delete(capture).where(eq(capture.id, original?.id ?? ''));
        await s.delete(matter).where(eq(matter.id, matterA?.id ?? ''));
        const [after] = await s
          .select()
          .from(capture)
          .where(eq(capture.id, dup?.id ?? ''));
        expect(after).toMatchObject({
          workspaceId: a.id,
          dedupeOfCaptureId: null,
          matterHintId: null,
        });
      });
    });
  });

  it('a document keeps its source capture, and the link clears when the capture goes', async () => {
    await withTestDb(async (tx) => {
      const ws = await newWorkspace(tx);
      await inWorkspace(tx, ws.id, async (s) => {
        const [source] = await s
          .insert(capture)
          .values({ workspaceId: ws.id, ...base })
          .returning({ id: capture.id });
        const [doc] = await s
          .insert(document)
          .values({
            workspaceId: ws.id,
            kind: 'order',
            storageKey: 'ws/x',
            sha256: sha(),
            sourceCaptureId: source?.id ?? '',
          } as never)
          .returning({ id: document.id });
        await s.delete(capture).where(eq(capture.id, source?.id ?? ''));
        const [after] = await s
          .select()
          .from(document)
          .where(eq(document.id, doc?.id ?? ''));
        expect(after).toMatchObject({ workspaceId: ws.id, sourceCaptureId: null });
      });
    });
  });

  it('has the status and hash indexes', async () => {
    await withTestDb(async (tx) => {
      const rows = await tx.execute<{ indexdef: string }>(sql`
        select indexdef from pg_indexes
         where tablename = 'capture' and indexname in
               ('capture_workspace_status_created_idx', 'capture_workspace_sha256_idx')`);
      const defs = rows.map((row) => row.indexdef).join('\n');
      expect(defs).toContain('(workspace_id, status, created_at)');
      expect(defs).toContain('(workspace_id, sha256)');
    });
  });

  it('keeps one channel row per workspace and requires a disclosure version to enable', async () => {
    await withTestDb(async (tx) => {
      const ws = await newWorkspace(tx);
      await inWorkspace(tx, ws.id, async (s) => {
        await s.insert(workspaceCaptureChannel).values({ workspaceId: ws.id, channel: 'email' });
        expect(
          await sqlState(
            s.transaction((sp) =>
              sp.insert(workspaceCaptureChannel).values({
                workspaceId: ws.id,
                channel: 'email',
                enabled: true,
                disclosureVersion: 'v1',
              }),
            ),
          ),
        ).toBe('23505');
        expect(
          await sqlState(
            s.transaction((sp) =>
              sp
                .insert(workspaceCaptureChannel)
                .values({ workspaceId: ws.id, channel: 'ics', enabled: true }),
            ),
          ),
        ).toBe('23514');
        expect(
          await sqlState(
            s.transaction((sp) =>
              sp
                .insert(workspaceCaptureChannel)
                .values({ workspaceId: ws.id, channel: 'sms' as never }),
            ),
          ),
        ).toBe('23514');
      });
    });
  });

  it('lists workspaces with expired raw objects, ignoring pins, through the definer function', async () => {
    await withTestDb(async (tx) => {
      const ws = await newWorkspace(tx);
      const now = new Date('2026-10-19T10:00:00Z');
      const past = new Date(now.getTime() - 1000);
      await inWorkspace(tx, ws.id, async (s) => {
        await s.insert(capture).values([
          { workspaceId: ws.id, ...base, rawStorageKey: 'ws/k1', ttlAt: past, pinned: true },
          { workspaceId: ws.id, ...base, rawStorageKey: null, ttlAt: past },
        ]);
      });
      const none = await tx.execute<{ workspace_id: string }>(
        sql`select workspace_id::text from app_capture_retention_targets(${now.toISOString()}::timestamptz)`,
      );
      expect(none.map((row) => row.workspace_id)).not.toContain(ws.id);
      await inWorkspace(tx, ws.id, (s) =>
        s
          .insert(capture)
          .values({ workspaceId: ws.id, ...base, rawStorageKey: 'ws/k2', ttlAt: past }),
      );
      const some = await tx.execute<{ workspace_id: string }>(
        sql`select workspace_id::text from app_capture_retention_targets(${now.toISOString()}::timestamptz)`,
      );
      expect(some.map((row) => row.workspace_id)).toContain(ws.id);
    });
  });
});
