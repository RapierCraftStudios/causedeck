// Export privacy (#301): export contents never reach a log line or an audit event; the archive
// goes only to the configured object store (no other network call); download tokens carry a
// 256-bit nonce, are unique, bound to the export, the requester and the workspace, and a token is
// revoked when a new link is issued or the export expires.
import { schema, withWorkspace, type Database } from '@causedeck/db';
import type { TwoTenants } from '@causedeck/db/testing/two-tenants';
import type { MemoryObjectStore, ObjectStore } from '@causedeck/storage';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  EXPORT_TOKEN_NONCE_BYTES,
  issueExportDownload,
  openExportDownload,
  readExportToken,
  requestExport,
  runExportBuild,
  type ExportJob,
} from '../index.ts';

import {
  captureLog,
  cleanup,
  lifecycleDb,
  newStore,
  readAll,
  SECRET,
  seedWorkspaces,
  stepUpSession,
  testKeys,
} from './fixtures.ts';

const keys = testKeys();
let db: Database;
let store: MemoryObjectStore;
let seeded: TwoTenants;
let job: ExportJob;
let lines: string[];
let putStreams: string[];
let buffered: number;
const MARKER = 'confidential-marker-7f3a';

beforeAll(async () => {
  db = lifecycleDb();
  store = newStore();
  seeded = await seedWorkspaces(db, store);
  // Content that must never be logged: a member name and a notification body.
  await db.update(schema.user).set({ name: MARKER }).where(eq(schema.user.id, seeded.ua));
  const fetchSpy = vi.spyOn(globalThis, 'fetch');
  putStreams = [];
  buffered = 0;
  const watched: ObjectStore = {
    ...store,
    putStream: (input) => {
      putStreams.push(input.key);
      return store.putStream(input);
    },
    put: (input) => {
      buffered += 1;
      return store.put(input);
    },
  };
  job = await requestExport(
    {
      db,
      workspaceId: seeded.a.id,
      userId: seeded.ua,
      sessionId: await stepUpSession(db, seeded.ua),
    },
    { scope: 'workspace' },
    { enqueue: () => Promise.resolve(null) },
  );
  const captured = captureLog();
  lines = captured.lines;
  await runExportBuild(
    { db, log: captured.log },
    { workspaceId: seeded.a.id, jobId: job.id },
    { store: watched, keys },
  );
  expect(fetchSpy).not.toHaveBeenCalled();
  fetchSpy.mockRestore();
});

afterAll(async () => {
  await cleanup(db, [seeded.a.id, seeded.b.id]);
});

const ctx = () => ({ db, workspaceId: seeded.a.id, userId: seeded.ua });

describe('export privacy', () => {
  it('logs ids and counts only, never row contents', () => {
    expect(lines.length).toBeGreaterThan(0);
    const all = lines.join('\n');
    expect(all).not.toContain(MARKER);
    expect(all).not.toContain('seed file');
    expect(all).not.toContain('@example.test');
  });

  it('streams the archive to the configured store only, in parts, never buffered whole', () => {
    expect(putStreams).toHaveLength(1);
    expect(putStreams[0]).toMatch(new RegExp(`^ws/${seeded.a.id}/export/`));
    expect(buffered).toBe(0);
  });

  it('keeps contents out of the audit events it writes', async () => {
    await issueExportDownload(ctx(), job.id, { secret: SECRET });
    const events = await withWorkspace(db, { workspaceId: seeded.a.id }, (tx) =>
      tx
        .select({ action: schema.auditEvent.action, metadata: schema.auditEvent.metadata })
        .from(schema.auditEvent)
        .where(eq(schema.auditEvent.workspaceId, seeded.a.id)),
    );
    const exportEvents = events.filter((e) => e.action.startsWith('export.'));
    expect(exportEvents.map((e) => e.action)).toEqual(
      expect.arrayContaining(['export.requested', 'export.download_link_issued']),
    );
    expect(JSON.stringify(exportEvents)).not.toContain(MARKER);
  });

  it('issues unguessable, unique tokens (>= 128-bit nonce) and stores only a hash', async () => {
    expect(EXPORT_TOKEN_NONCE_BYTES * 8).toBeGreaterThanOrEqual(128);
    const tokens = new Set<string>();
    for (let i = 0; i < 20; i++) {
      tokens.add((await issueExportDownload(ctx(), job.id, { secret: SECRET })).token);
    }
    expect(tokens.size).toBe(20);
    const last = [...tokens].at(-1) ?? '';
    const payload = readExportToken(last, SECRET);
    expect(Buffer.from(payload?.n ?? '', 'base64url').byteLength).toBe(EXPORT_TOKEN_NONCE_BYTES);
    const [row] = await withWorkspace(db, { workspaceId: seeded.a.id }, (tx) =>
      tx.select().from(schema.exportJob).where(eq(schema.exportJob.id, job.id)),
    );
    expect(row?.downloadTokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row?.downloadTokenHash).not.toContain(payload?.n ?? 'x');
  });

  it('rejects forged, tampered, revoked and expired tokens', async () => {
    const deps = { store, keys, secret: SECRET };
    const first = await issueExportDownload(ctx(), job.id, { secret: SECRET });
    const second = await issueExportDownload(ctx(), job.id, { secret: SECRET });
    const code = (p: Promise<unknown>) =>
      p.then(
        () => 'ok',
        (e: unknown) => (e as { code?: string }).code,
      );
    // Revoked by the newer link.
    expect(await code(openExportDownload(ctx(), job.id, first.token, deps))).toBe('NOT_FOUND');
    // Wrong secret, tampered body.
    expect(readExportToken(second.token, 'another-secret')).toBeNull();
    const [body, mac] = second.token.split('.');
    const tampered = `${Buffer.from(
      Buffer.from(body ?? '', 'base64url')
        .toString()
        .replace(seeded.ua, seeded.uboth),
    ).toString('base64url')}.${mac ?? ''}`;
    expect(readExportToken(tampered, SECRET)).toBeNull();
    // Another member of the same workspace cannot use the requester's link.
    expect(
      await code(
        openExportDownload({ ...ctx(), userId: seeded.uboth }, job.id, second.token, deps),
      ),
    ).toMatch(/^(FORBIDDEN|NOT_FOUND)$/);
    // After expiry.
    const later = () => new Date(Date.now() + 25 * 60 * 60 * 1000);
    expect(
      await code(openExportDownload({ ...ctx(), now: later }, job.id, second.token, deps)),
    ).toBe('NOT_FOUND');
    // The current link works, and the download is audited.
    const download = await openExportDownload(ctx(), job.id, second.token, deps);
    expect((await readAll(download.body)).byteLength).toBe(download.sizeBytes);
    const downloads = await withWorkspace(db, { workspaceId: seeded.a.id }, (tx) =>
      tx
        .select({ id: schema.auditEvent.id })
        .from(schema.auditEvent)
        .where(
          and(
            eq(schema.auditEvent.workspaceId, seeded.a.id),
            eq(schema.auditEvent.action, 'export.downloaded'),
          ),
        ),
    );
    expect(downloads).toHaveLength(1);
  });
});
