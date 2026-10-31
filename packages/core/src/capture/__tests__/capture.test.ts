// The capture inbox (#43), against the real test database: create, complete, de-duplicate, scan,
// quarantine, channel and sensitive-matter gates, manual capture, discard and retention. The
// object store is in memory; every test runs in a rolled-back transaction as causedeck_app.
import {
  CAPTURE_PIPELINE_VERSION,
  captureConfigFromEnv,
  CaptureTooLargeError,
  historyOf,
  IllegalTransitionError,
  MockEicarScanner,
  EICAR_TEST_STRING,
  UnsupportedTypeError,
} from '@causedeck/capture';
import { schema } from '@causedeck/db';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { seedTwoTenants } from '@causedeck/db/testing/two-tenants';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import {
  ChannelDisabledError,
  CAPTURE_DISCLOSURE_VERSION,
  completeUpload,
  createCapture,
  createManualCapture,
  disableChannel,
  discardCapture,
  enableChannel,
  handCaptureToListImport,
  listChannels,
  markCaptureFailed,
  pinCapture,
  runCaptureProcess,
  runCaptureScan,
  SensitiveMatterExcludedError,
  setExtractionTtl,
  sweepExpiredCaptures,
} from '../index.ts';

import {
  auditActions,
  Denied,
  harness,
  newMatter,
  NOW,
  PDF,
  PDF_B,
  PNG,
  putRaw,
  readCapture,
  sha256,
  WEBM,
} from './fixtures.ts';

const pdfInput = (bytes = PDF, extra: Record<string, unknown> = {}) => ({
  channel: 'upload' as const,
  filename: 'Order 12.10.2026.pdf',
  mime: 'application/pdf',
  sizeBytes: bytes.byteLength,
  sha256: sha256(bytes),
  ...extra,
});

describe('createCapture', () => {
  it('records a received capture and returns a 10-minute presigned PUT', async () => {
    await withTestDb(async (tx) => {
      const { a, ua } = await seedTwoTenants(tx);
      const h = harness(tx, a.id, ua);
      const created = await createCapture(h.ctx, pdfInput());
      // The in-memory store signs with the real clock.
      const lifetime = created.expiresAt.getTime() - Date.now();
      expect(lifetime).toBeGreaterThan(590_000);
      expect(lifetime).toBeLessThanOrEqual(600_000);
      expect(created.uploadUrl).toBeTruthy();
      expect(created.headers['content-length']).toBe(String(PDF.byteLength));

      const row = await readCapture(tx, a.id, created.captureId);
      expect(row).toMatchObject({
        status: 'received',
        channel: 'upload',
        mime: 'application/pdf',
        sizeBytes: PDF.byteLength,
        scanStatus: 'pending',
        aiBlocked: false,
        pinned: false,
        ttlAt: null,
        createdBy: ua,
        sha256: null,
      });
      expect(row.rawStorageKey).toMatch(new RegExp(`^ws/${a.id}/document/`));
      expect(row.sourceMeta['declaredSha256']).toBe(sha256(PDF));
    });
  });

  it('audits the create without the filename or any content', async () => {
    await withTestDb(async (tx) => {
      const { a, ua } = await seedTwoTenants(tx);
      const h = harness(tx, a.id, ua);
      await createCapture(h.ctx, pdfInput());
      expect(await auditActions(tx, a.id)).toContain('capture.created');
      const events = await inWorkspace(tx, a.id, (s) =>
        s.select().from(schema.auditEvent).where(eq(schema.auditEvent.action, 'capture.created')),
      );
      const text = JSON.stringify(events);
      expect(text).not.toContain('Order 12.10.2026');
      expect(events[0]?.metadata).toMatchObject({ channel: 'upload', mime: 'application/pdf' });
    });
  });

  it('rejects a type that is not on the allow-list, and an over-cap declared size', async () => {
    await withTestDb(async (tx) => {
      const { a, ua } = await seedTwoTenants(tx);
      const h = harness(tx, a.id, ua);
      await expect(
        createCapture(h.ctx, {
          ...pdfInput(),
          filename: 'setup.exe',
          mime: 'application/x-msdownload',
        }),
      ).rejects.toBeInstanceOf(UnsupportedTypeError);
      await expect(
        createCapture(h.ctx, { ...pdfInput(), sizeBytes: 51 * 1024 * 1024 }),
      ).rejects.toBeInstanceOf(CaptureTooLargeError);
      await expect(
        createCapture(h.ctx, {
          channel: 'upload',
          filename: 'hearing.ics',
          mime: 'text/calendar',
          sizeBytes: 1024 * 1024 + 1,
          sha256: sha256(PDF),
        }),
      ).rejects.toBeInstanceOf(CaptureTooLargeError);
    });
  });

  it('needs document.write', async () => {
    await withTestDb(async (tx) => {
      const { a, ua } = await seedTwoTenants(tx);
      const h = harness(tx, a.id, ua);
      h.allow.delete('document.write');
      await expect(createCapture(h.ctx, pdfInput())).rejects.toBeInstanceOf(Denied);
    });
  });

  it('stays under the 100 ms p95 budget excluding transfer', async () => {
    await withTestDb(async (tx) => {
      const { a, ua } = await seedTwoTenants(tx);
      const h = harness(tx, a.id, ua);
      await createCapture(h.ctx, pdfInput()); // warm up
      const times: number[] = [];
      for (let i = 0; i < 20; i += 1) {
        const started = performance.now();
        await createCapture(h.ctx, pdfInput());
        times.push(performance.now() - started);
      }
      times.sort((x, y) => x - y);
      const p95 = times[Math.ceil(times.length * 0.95) - 1] ?? Infinity;
      expect(p95).toBeLessThan(100);
    });
  });
});

describe('completeUpload', () => {
  it('verifies the bytes, queues the capture and enqueues one process job', async () => {
    await withTestDb(async (tx) => {
      const { a, ua } = await seedTwoTenants(tx);
      const h = harness(tx, a.id, ua);
      const { captureId } = await createCapture(h.ctx, pdfInput());
      await putRaw(tx, h, captureId, PDF);

      expect(await completeUpload(h.ctx, captureId, sha256(PDF))).toEqual({ status: 'queued' });
      const row = await readCapture(tx, a.id, captureId);
      expect(row).toMatchObject({
        status: 'queued',
        sha256: sha256(PDF),
        scanStatus: 'skipped',
        mime: 'application/pdf',
      });
      expect(historyOf(row.sourceMeta).map((entry) => entry.to)).toEqual(['queued']);
      expect(h.processes).toEqual([
        { workspaceId: a.id, captureId, pipelineVersion: CAPTURE_PIPELINE_VERSION },
      ]);
      expect(h.scans).toEqual([]);

      // Completing again changes nothing and sends nothing.
      expect(await completeUpload(h.ctx, captureId, sha256(PDF))).toEqual({ status: 'queued' });
      expect(h.processes).toHaveLength(1);
      expect(await auditActions(tx, a.id)).toContain('capture.completed');
    });
  });

  it('de-duplicates by sha256: one processable capture, no second raw object', async () => {
    await withTestDb(async (tx) => {
      const { a, ua } = await seedTwoTenants(tx);
      const h = harness(tx, a.id, ua);
      const first = await createCapture(h.ctx, pdfInput());
      await putRaw(tx, h, first.captureId, PDF);
      await completeUpload(h.ctx, first.captureId, sha256(PDF));

      const second = await createCapture(h.ctx, pdfInput());
      const secondKey = await putRaw(tx, h, second.captureId, PDF);
      expect(await completeUpload(h.ctx, second.captureId, sha256(PDF))).toEqual({
        status: 'duplicate',
        duplicateOf: first.captureId,
      });

      const row = await readCapture(tx, a.id, second.captureId);
      expect(row).toMatchObject({
        status: 'duplicate',
        dedupeOfCaptureId: first.captureId,
        rawStorageKey: null,
      });
      expect(await h.store.head(secondKey)).toBeNull();
      expect(h.processes).toHaveLength(1);
      // Reported again on a repeat complete.
      expect(await completeUpload(h.ctx, second.captureId, sha256(PDF))).toEqual({
        status: 'duplicate',
        duplicateOf: first.captureId,
      });
      // Different bytes are not a duplicate.
      const third = await createCapture(h.ctx, pdfInput(PDF_B));
      await putRaw(tx, h, third.captureId, PDF_B);
      expect((await completeUpload(h.ctx, third.captureId, sha256(PDF_B))).status).toBe('queued');
    });
  });

  it('does not de-duplicate against another workspace', async () => {
    await withTestDb(async (tx) => {
      const { a, b, ua, ub } = await seedTwoTenants(tx);
      const ha = harness(tx, a.id, ua);
      const hb = harness(tx, b.id, ub);
      const inA = await createCapture(ha.ctx, pdfInput());
      await putRaw(tx, ha, inA.captureId, PDF);
      await completeUpload(ha.ctx, inA.captureId, sha256(PDF));
      const inB = await createCapture(hb.ctx, pdfInput());
      await putRaw(tx, hb, inB.captureId, PDF);
      expect((await completeUpload(hb.ctx, inB.captureId, sha256(PDF))).status).toBe('queued');
    });
  });

  it('fails a wrong hash, deleting the object', async () => {
    await withTestDb(async (tx) => {
      const { a, ua } = await seedTwoTenants(tx);
      const h = harness(tx, a.id, ua);
      const { captureId } = await createCapture(h.ctx, pdfInput());
      const key = await putRaw(tx, h, captureId, PDF);
      await expect(completeUpload(h.ctx, captureId, sha256(PDF_B))).rejects.toMatchObject({
        name: 'WorkspaceError',
        code: 'VALIDATION',
      });
      const row = await readCapture(tx, a.id, captureId);
      expect(row).toMatchObject({ status: 'failed', rawStorageKey: null });
      expect(row.sourceMeta['failureReason']).toBe('hash_mismatch');
      expect(await h.store.head(key)).toBeNull();
    });
  });

  it('deletes an oversized upload and marks the capture failed too_large', async () => {
    await withTestDb(async (tx) => {
      const { a, ua } = await seedTwoTenants(tx);
      const h = harness(tx, a.id, ua, { env: { CAPTURE_MAX_BYTES_PDF: '200' } });
      const { captureId } = await createCapture(h.ctx, pdfInput());
      // The client sends more than it declared (and more than the cap).
      const big = new Uint8Array(Buffer.concat([Buffer.from(PDF), Buffer.alloc(400)]));
      const key = await putRaw(tx, h, captureId, big);
      await expect(completeUpload(h.ctx, captureId, sha256(PDF))).rejects.toBeInstanceOf(
        CaptureTooLargeError,
      );
      const row = await readCapture(tx, a.id, captureId);
      expect(row.status).toBe('failed');
      expect(row.sourceMeta['failureReason']).toBe('too_large');
      expect(await h.store.head(key)).toBeNull();
    });
  });

  it('rejects bytes that contradict the declared type and fails the capture', async () => {
    await withTestDb(async (tx) => {
      const { a, ua } = await seedTwoTenants(tx);
      const h = harness(tx, a.id, ua);
      const { captureId } = await createCapture(h.ctx, {
        ...pdfInput(PNG),
      });
      const key = await putRaw(tx, h, captureId, PNG);
      await expect(completeUpload(h.ctx, captureId, sha256(PNG))).rejects.toBeInstanceOf(
        UnsupportedTypeError,
      );
      expect((await readCapture(tx, a.id, captureId)).status).toBe('failed');
      expect(await h.store.head(key)).toBeNull();
    });
  });

  it('keeps the capture open when nothing was uploaded yet', async () => {
    await withTestDb(async (tx) => {
      const { a, ua } = await seedTwoTenants(tx);
      const h = harness(tx, a.id, ua);
      const { captureId } = await createCapture(h.ctx, pdfInput());
      await expect(completeUpload(h.ctx, captureId, sha256(PDF))).rejects.toMatchObject({
        code: 'VALIDATION',
      });
      expect((await readCapture(tx, a.id, captureId)).status).toBe('received');
    });
  });

  it('only the member who started the capture can complete it', async () => {
    await withTestDb(async (tx) => {
      const { a, ua, uboth } = await seedTwoTenants(tx);
      const owner = harness(tx, a.id, ua);
      const other = harness(tx, a.id, uboth);
      const { captureId } = await createCapture(owner.ctx, pdfInput());
      await putRaw(tx, owner, captureId, PDF);
      await expect(completeUpload(other.ctx, captureId, sha256(PDF))).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });
  });

  it('gives an audio capture a 30 day TTL', async () => {
    await withTestDb(async (tx) => {
      const { a, ua } = await seedTwoTenants(tx);
      const h = harness(tx, a.id, ua);
      const { captureId } = await createCapture(h.ctx, {
        channel: 'upload',
        filename: 'memo.webm',
        mime: 'audio/webm',
        sizeBytes: WEBM.byteLength,
        sha256: sha256(WEBM),
      });
      await putRaw(tx, h, captureId, WEBM, 'audio/webm');
      await completeUpload(h.ctx, captureId, sha256(WEBM));
      const row = await readCapture(tx, a.id, captureId);
      expect(row.ttlAt?.getTime()).toBe(NOW.getTime() + 30 * 24 * 60 * 60 * 1000);
    });
  });
});

describe('scanning', () => {
  const withClam = { CAPTURE_CLAMAV_HOST: 'clamav.test' };

  it('goes to scanning and enqueues capture.scan when a scanner is configured', async () => {
    await withTestDb(async (tx) => {
      const { a, ua } = await seedTwoTenants(tx);
      const h = harness(tx, a.id, ua, { env: withClam });
      const { captureId } = await createCapture(h.ctx, pdfInput());
      await putRaw(tx, h, captureId, PDF);
      expect(await completeUpload(h.ctx, captureId, sha256(PDF))).toEqual({ status: 'scanning' });
      expect(h.scans).toEqual([{ workspaceId: a.id, captureId, sha256: sha256(PDF) }]);
      expect(h.processes).toEqual([]);
    });
  });

  it('a clean scan queues the capture and enqueues capture.process once, however often it runs', async () => {
    await withTestDb(async (tx) => {
      const { a, ua } = await seedTwoTenants(tx);
      const h = harness(tx, a.id, ua, { env: withClam });
      const { captureId } = await createCapture(h.ctx, pdfInput());
      await putRaw(tx, h, captureId, PDF);
      await completeUpload(h.ctx, captureId, sha256(PDF));

      const deps = {
        db: tx,
        store: h.store,
        config: h.ctx.config,
        scanner: new MockEicarScanner(),
        jobs: h.ctx.jobs,
        now: () => NOW,
      };
      const payload = { workspaceId: a.id, captureId, sha256: sha256(PDF) };
      expect(await runCaptureScan(deps, payload)).toBe('clean');
      expect(await runCaptureScan(deps, payload)).toBe('skipped');
      const row = await readCapture(tx, a.id, captureId);
      expect(row).toMatchObject({ status: 'queued', scanStatus: 'clean' });
      expect(h.processes).toHaveLength(1);
    });
  });

  it('quarantines an infected capture: raw object moved, nothing enqueued downstream', async () => {
    await withTestDb(async (tx) => {
      const { a, ua } = await seedTwoTenants(tx);
      const h = harness(tx, a.id, ua, { env: withClam });
      const infected = new Uint8Array(
        Buffer.from(`%PDF-1.7\n% ${EICAR_TEST_STRING}\n%%EOF\n`, 'latin1'),
      );
      const { captureId } = await createCapture(h.ctx, pdfInput(infected));
      const key = await putRaw(tx, h, captureId, infected);
      await completeUpload(h.ctx, captureId, sha256(infected));

      const outcome = await runCaptureScan(
        {
          db: tx,
          store: h.store,
          config: h.ctx.config,
          scanner: new MockEicarScanner(),
          jobs: h.ctx.jobs,
          now: () => NOW,
        },
        { workspaceId: a.id, captureId, sha256: sha256(infected) },
      );
      expect(outcome).toBe('quarantined');
      const row = await readCapture(tx, a.id, captureId);
      expect(row).toMatchObject({ status: 'quarantined', scanStatus: 'infected' });
      expect(row.rawStorageKey).toMatch(new RegExp(`^ws/${a.id}/quarantine/`));
      expect(await h.store.head(key)).toBeNull();
      expect(await h.store.head(row.rawStorageKey as never)).not.toBeNull();
      expect(h.processes).toEqual([]);
      expect(await auditActions(tx, a.id)).toContain('capture.quarantined');
      // A quarantined blob can no longer be downloaded.
      const [blobRow] = await inWorkspace(tx, a.id, (s) =>
        s
          .select()
          .from(schema.blob)
          .where(eq(schema.blob.key, row.rawStorageKey ?? '')),
      );
      expect(blobRow?.scanStatus).toBe('infected');
    });
  });

  it('a scanner error throws so the job retries, leaving the capture scanning', async () => {
    await withTestDb(async (tx) => {
      const { a, ua } = await seedTwoTenants(tx);
      const h = harness(tx, a.id, ua, { env: withClam });
      const { captureId } = await createCapture(h.ctx, pdfInput());
      await putRaw(tx, h, captureId, PDF);
      await completeUpload(h.ctx, captureId, sha256(PDF));
      const broken = { name: 'broken', scan: () => Promise.resolve({ outcome: 'error' as const }) };
      await expect(
        runCaptureScan(
          { db: tx, store: h.store, config: h.ctx.config, scanner: broken, jobs: h.ctx.jobs },
          { workspaceId: a.id, captureId, sha256: sha256(PDF) },
        ),
      ).rejects.toMatchObject({ code: 'SCAN_UNAVAILABLE' });
      expect((await readCapture(tx, a.id, captureId)).status).toBe('scanning');
    });
  });

  it('CAPTURE_SCAN_REQUIRED fails a capture when no scanner is configured', async () => {
    await withTestDb(async (tx) => {
      const { a, ua } = await seedTwoTenants(tx);
      const h = harness(tx, a.id, ua, { env: { CAPTURE_SCAN_REQUIRED: 'true' } });
      const { captureId } = await createCapture(h.ctx, pdfInput());
      const key = await putRaw(tx, h, captureId, PDF);
      await expect(completeUpload(h.ctx, captureId, sha256(PDF))).rejects.toMatchObject({
        code: 'VALIDATION',
      });
      const row = await readCapture(tx, a.id, captureId);
      expect(row.status).toBe('failed');
      expect(row.sourceMeta['failureReason']).toBe('scan_required');
      expect(await h.store.head(key)).toBeNull();
      expect(h.processes).toEqual([]);
    });
  });

  it('re-running scan for a capture whose bytes changed does nothing', async () => {
    await withTestDb(async (tx) => {
      const { a, ua } = await seedTwoTenants(tx);
      const h = harness(tx, a.id, ua, { env: withClam });
      const { captureId } = await createCapture(h.ctx, pdfInput());
      await putRaw(tx, h, captureId, PDF);
      await completeUpload(h.ctx, captureId, sha256(PDF));
      const result = await runCaptureScan(
        {
          db: tx,
          store: h.store,
          config: h.ctx.config,
          scanner: new MockEicarScanner(),
          jobs: h.ctx.jobs,
        },
        { workspaceId: a.id, captureId, sha256: sha256(PDF_B) },
      );
      expect(result).toBe('skipped');
      expect((await readCapture(tx, a.id, captureId)).status).toBe('scanning');
    });
  });
});

describe('channels', () => {
  it('only manual and upload are enabled by default', async () => {
    await withTestDb(async (tx) => {
      const { a, ua } = await seedTwoTenants(tx);
      const h = harness(tx, a.id, ua);
      const states = await listChannels(tx, a.id);
      const enabled = (await inWorkspace(tx, a.id, (s) => listChannels(s, a.id)))
        .filter((c) => c.enabled)
        .map((c) => c.channel)
        .sort();
      expect(states).toHaveLength(10);
      // A's seeded row enables `email`; the defaults are untouched otherwise.
      expect(enabled).toEqual(['email', 'manual', 'upload']);
      await expect(
        createCapture(h.ctx, {
          ...pdfInput(),
          channel: 'whatsapp_export',
          filename: 'c.zip',
          mime: 'application/zip',
        }),
      ).rejects.toBeInstanceOf(ChannelDisabledError);
    });
  });

  it('enabling needs workspace.manage and the current disclosure, and records the version', async () => {
    await withTestDb(async (tx) => {
      const { b, ub } = await seedTwoTenants(tx);
      const h = harness(tx, b.id, ub);
      const input = { channel: 'voice', disclosureVersion: CAPTURE_DISCLOSURE_VERSION };
      // B's seed enables `email` only: `voice` is off.
      await expect(
        createCapture(h.ctx, {
          ...pdfInput(WEBM),
          channel: 'voice',
          filename: 'm.webm',
          mime: 'audio/webm',
        }),
      ).rejects.toBeInstanceOf(ChannelDisabledError);

      h.allow.delete('workspace.manage');
      await expect(enableChannel(h.ctx, input)).rejects.toBeInstanceOf(Denied);
      h.allow.add('workspace.manage');
      await expect(
        enableChannel(h.ctx, { channel: 'voice', disclosureVersion: 'stale' }),
      ).rejects.toMatchObject({ code: 'VALIDATION' });
      await expect(
        enableChannel(h.ctx, { channel: 'sms', disclosureVersion: CAPTURE_DISCLOSURE_VERSION }),
      ).rejects.toMatchObject({ code: 'VALIDATION' });

      const state = await enableChannel(h.ctx, input);
      expect(state).toMatchObject({
        channel: 'voice',
        enabled: true,
        disclosureVersion: CAPTURE_DISCLOSURE_VERSION,
      });
      const [row] = await inWorkspace(tx, b.id, (s) =>
        s
          .select()
          .from(schema.workspaceCaptureChannel)
          .where(eq(schema.workspaceCaptureChannel.channel, 'voice')),
      );
      expect(row).toMatchObject({
        enabled: true,
        enabledBy: ub,
        disclosureVersion: CAPTURE_DISCLOSURE_VERSION,
      });

      const created = await createCapture(h.ctx, {
        channel: 'voice',
        filename: 'm.webm',
        mime: 'audio/webm',
        sizeBytes: WEBM.byteLength,
        sha256: sha256(WEBM),
      });
      expect(created.captureId).toBeTruthy();

      expect((await disableChannel(h.ctx, 'voice')).enabled).toBe(false);
      await expect(
        createCapture(h.ctx, {
          channel: 'voice',
          filename: 'm.webm',
          mime: 'audio/webm',
          sizeBytes: 10,
          sha256: sha256(WEBM),
        }),
      ).rejects.toBeInstanceOf(ChannelDisabledError);
      const actions = await auditActions(tx, b.id);
      expect(actions).toContain('capture.channel_enabled');
      expect(actions).toContain('capture.channel_disabled');
    });
  });
});

describe('sensitive-matter gate', () => {
  it('a hint at a sensitive matter sets ai_blocked, and the flag survives completion and processing', async () => {
    await withTestDb(async (tx) => {
      const { a, ua } = await seedTwoTenants(tx);
      const h = harness(tx, a.id, ua);
      const sensitive = await newMatter(tx, a.id, true);
      const plain = await newMatter(tx, a.id, false);

      const open = await createCapture(h.ctx, pdfInput(PDF, { matterHintId: plain }));
      expect((await readCapture(tx, a.id, open.captureId)).aiBlocked).toBe(false);

      const { captureId } = await createCapture(
        h.ctx,
        pdfInput(PDF_B, { matterHintId: sensitive }),
      );
      expect((await readCapture(tx, a.id, captureId)).aiBlocked).toBe(true);
      await putRaw(tx, h, captureId, PDF_B);
      await completeUpload(h.ctx, captureId, sha256(PDF_B));
      expect((await readCapture(tx, a.id, captureId)).aiBlocked).toBe(true);

      // `process` reads the flag from the row, whatever the payload says.
      const outcome = await runCaptureProcess(
        { db: tx, now: () => NOW },
        { workspaceId: a.id, captureId, pipelineVersion: 'x' },
      );
      expect(outcome).toMatchObject({ outcome: 'started', aiSteps: false });

      // Unblocked captures may run AI steps.
      await putRaw(tx, h, open.captureId, PDF);
      await completeUpload(h.ctx, open.captureId, sha256(PDF));
      expect(
        await runCaptureProcess(
          { db: tx },
          { workspaceId: a.id, captureId: open.captureId, pipelineVersion: 'x' },
        ),
      ).toMatchObject({ outcome: 'started', aiSteps: true });
    });
  });

  it('bulk import excludes sensitive matters by default', async () => {
    await withTestDb(async (tx) => {
      const { a, ua } = await seedTwoTenants(tx);
      const h = harness(tx, a.id, ua);
      const sensitive = await newMatter(tx, a.id, true);
      await inWorkspace(tx, a.id, (s) =>
        s.insert(schema.workspaceCaptureChannel).values({
          workspaceId: a.id,
          channel: 'bulk_import',
          enabled: true,
          disclosureVersion: 'v1',
        }),
      );
      await expect(
        createCapture(h.ctx, pdfInput(PDF, { channel: 'bulk_import', matterHintId: sensitive })),
      ).rejects.toBeInstanceOf(SensitiveMatterExcludedError);
    });
  });

  it('a hint at a matter that does not exist is not found', async () => {
    await withTestDb(async (tx) => {
      const { a, ua } = await seedTwoTenants(tx);
      const h = harness(tx, a.id, ua);
      await expect(
        createCapture(h.ctx, pdfInput(PDF, { matterHintId: crypto.randomUUID() })),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });
});

describe('manual capture', () => {
  it('stores a typed note raw, bypasses scanning and queues it', async () => {
    await withTestDb(async (tx) => {
      const { a, ua } = await seedTwoTenants(tx);
      const h = harness(tx, a.id, ua, {
        env: { CAPTURE_CLAMAV_HOST: 'clamav.test', CAPTURE_SCAN_REQUIRED: 'true' },
      });
      const result = await createManualCapture(h.ctx, { text: 'Hearing moved to Monday 10:30' });
      expect(result.status).toBe('queued');
      const row = await readCapture(tx, a.id, result.captureId);
      expect(row).toMatchObject({
        channel: 'manual',
        status: 'queued',
        scanStatus: 'skipped',
        mime: 'text/plain',
        aiBlocked: false,
      });
      expect(row.rawStorageKey).not.toBeNull();
      expect(h.scans).toEqual([]);
      expect(h.processes).toHaveLength(1);
      const stored = await h.store.get(row.rawStorageKey as never);
      expect(Buffer.from(stored.body).toString('utf8')).toBe('Hearing moved to Monday 10:30');
    });
  });

  it('applies the same sensitive-matter rule and rejects an empty note', async () => {
    await withTestDb(async (tx) => {
      const { a, ua } = await seedTwoTenants(tx);
      const h = harness(tx, a.id, ua);
      const sensitive = await newMatter(tx, a.id, true);
      const result = await createManualCapture(h.ctx, {
        text: 'Privileged note',
        matterHintId: sensitive,
      });
      expect((await readCapture(tx, a.id, result.captureId)).aiBlocked).toBe(true);
      await expect(createManualCapture(h.ctx, { text: '' })).rejects.toMatchObject({
        code: 'VALIDATION',
      });
    });
  });
});

describe('discard, pin and retention', () => {
  async function queued(
    tx: Parameters<typeof harness>[0],
    h: ReturnType<typeof harness>,
    bytes = PDF,
  ) {
    const { captureId } = await createCapture(h.ctx, pdfInput(bytes));
    const key = await putRaw(tx, h, captureId, bytes);
    await completeUpload(h.ctx, captureId, sha256(bytes));
    return { captureId, key };
  }

  it('a member discards their own capture; the sweep then deletes the raw object, keeping the row', async () => {
    await withTestDb(async (tx) => {
      const { a, ua } = await seedTwoTenants(tx);
      const h = harness(tx, a.id, ua);
      const { captureId, key } = await queued(tx, h);

      const discarded = await discardCapture(h.ctx, captureId);
      expect(discarded).toMatchObject({ status: 'discarded', pinned: false });
      expect(discarded.ttlAt?.getTime()).toBe(NOW.getTime());
      // Discarding again is a no-op.
      expect((await discardCapture(h.ctx, captureId)).status).toBe('discarded');

      expect(
        await sweepExpiredCaptures(
          { db: tx, store: h.store, now: () => new Date(NOW.getTime() + 1000) },
          a.id,
        ),
      ).toEqual({ deleted: 1 });
      expect(await h.store.head(key)).toBeNull();
      const row = await readCapture(tx, a.id, captureId);
      expect(row).toMatchObject({ status: 'discarded', rawStorageKey: null, sha256: sha256(PDF) });
      const blobs = await inWorkspace(tx, a.id, (s) =>
        s.select().from(schema.blob).where(eq(schema.blob.key, key)),
      );
      expect(blobs).toEqual([]);
      // Idempotent: nothing left to delete.
      expect(
        await sweepExpiredCaptures(
          { db: tx, store: h.store, now: () => new Date(NOW.getTime() + 2000) },
          a.id,
        ),
      ).toEqual({ deleted: 0 });
      expect(await auditActions(tx, a.id)).toContain('capture.discarded');
    });
  });

  it('another member needs workspace.manage to discard', async () => {
    await withTestDb(async (tx) => {
      const { a, ua, uboth } = await seedTwoTenants(tx);
      const owner = harness(tx, a.id, ua);
      const other = harness(tx, a.id, uboth);
      const { captureId } = await queued(tx, owner);
      other.allow.delete('workspace.manage');
      await expect(discardCapture(other.ctx, captureId)).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      other.allow.add('workspace.manage');
      expect((await discardCapture(other.ctx, captureId)).status).toBe('discarded');
    });
  });

  it('terminal captures cannot be discarded', async () => {
    await withTestDb(async (tx) => {
      const { a, ua } = await seedTwoTenants(tx);
      const h = harness(tx, a.id, ua);
      const first = await queued(tx, h);
      const dup = await createCapture(h.ctx, pdfInput());
      await putRaw(tx, h, dup.captureId, PDF);
      await completeUpload(h.ctx, dup.captureId, sha256(PDF));
      expect((await readCapture(tx, a.id, dup.captureId)).status).toBe('duplicate');
      await expect(discardCapture(h.ctx, dup.captureId)).rejects.toBeInstanceOf(
        IllegalTransitionError,
      );
      expect(first.captureId).toBeTruthy();
    });
  });

  it('hands a photographed cause list to list import: needs_you -> ready, audited, anything else refused (#1073)', async () => {
    await withTestDb(async (tx) => {
      const { a, b, ua, ub } = await seedTwoTenants(tx);
      const h = harness(tx, a.id, ua);
      const seed = (
        channel: 'camera' | 'upload',
        route: string | null,
        status: 'needs_you' | 'ready' = 'needs_you',
      ) =>
        inWorkspace(tx, a.id, async (s) => {
          const [row] = await s
            .insert(schema.capture)
            .values({
              workspaceId: a.id,
              channel,
              status,
              mime: 'image/jpeg',
              sizeBytes: 10,
              createdBy: ua,
              sourceMeta: route === null ? {} : { cameraRoute: route },
            })
            .returning({ id: schema.capture.id });
          if (!row) throw new Error('capture insert failed');
          return row.id;
        });
      const list = await seed('camera', 'cause_list');
      const moved = await handCaptureToListImport(h.ctx, list);
      expect(moved.status).toBe('ready');
      expect(await auditActions(tx, a.id)).toContain('capture.completed');
      // Idempotent once ready.
      expect((await handCaptureToListImport(h.ctx, list)).status).toBe('ready');

      for (const id of [await seed('camera', null), await seed('upload', 'cause_list')]) {
        await expect(handCaptureToListImport(h.ctx, id)).rejects.toMatchObject({
          code: 'CONFLICT',
        });
      }
      const receipt = await seed('camera', 'receipt');
      await expect(handCaptureToListImport(h.ctx, receipt)).rejects.toMatchObject({
        code: 'CONFLICT',
      });
      // Another workspace's member cannot see it.
      await expect(handCaptureToListImport(harness(tx, b.id, ub).ctx, list)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });
  });

  it('sweeps expired audio, but a pin keeps it (until unpinned)', async () => {
    await withTestDb(async (tx) => {
      const { a, ua } = await seedTwoTenants(tx);
      const h = harness(tx, a.id, ua);
      const { captureId } = await createCapture(h.ctx, {
        channel: 'upload',
        filename: 'memo.webm',
        mime: 'audio/webm',
        sizeBytes: WEBM.byteLength,
        sha256: sha256(WEBM),
      });
      const key = await putRaw(tx, h, captureId, WEBM, 'audio/webm');
      await completeUpload(h.ctx, captureId, sha256(WEBM));
      const later = () => new Date(NOW.getTime() + 31 * 24 * 60 * 60 * 1000);

      expect((await pinCapture(h.ctx, captureId, true)).pinned).toBe(true);
      expect(await sweepExpiredCaptures({ db: tx, store: h.store, now: later }, a.id)).toEqual({
        deleted: 0,
      });
      expect(await h.store.head(key)).not.toBeNull();

      await pinCapture(h.ctx, captureId, false);
      // Not yet due: only 29 days on.
      expect(
        await sweepExpiredCaptures(
          { db: tx, store: h.store, now: () => new Date(NOW.getTime() + 29 * 24 * 60 * 60 * 1000) },
          a.id,
        ),
      ).toEqual({ deleted: 0 });
      expect(await sweepExpiredCaptures({ db: tx, store: h.store, now: later }, a.id)).toEqual({
        deleted: 1,
      });
      expect(await h.store.head(key)).toBeNull();
      expect((await readCapture(tx, a.id, captureId)).rawStorageKey).toBeNull();
    });
  });

  it('forwarded raw text expires 30 days after extraction unless pinned', async () => {
    await withTestDb(async (tx) => {
      const { a, ua } = await seedTwoTenants(tx);
      const h = harness(tx, a.id, ua);
      const [row] = await inWorkspace(tx, a.id, (s) =>
        s
          .insert(schema.capture)
          .values({
            workspaceId: a.id,
            channel: 'email',
            mime: 'text/plain',
            sizeBytes: 3,
            rawStorageKey: 'ws/x',
            createdBy: ua,
          })
          .returning({ id: schema.capture.id }),
      );
      const id = row?.id ?? '';
      const extractedAt = new Date('2026-11-02T08:00:00Z');
      const ttl = await setExtractionTtl(tx, a.id, id, extractedAt);
      expect(ttl?.getTime()).toBe(extractedAt.getTime() + 30 * 24 * 60 * 60 * 1000);
      await inWorkspace(tx, a.id, (s) =>
        s
          .update(schema.capture)
          .set({ pinned: true })
          .where(and(eq(schema.capture.id, id))),
      );
      expect(await setExtractionTtl(tx, a.id, id, extractedAt)).toBeNull();
      expect(h.processes).toEqual([]);
    });
  });

  it('markCaptureFailed fails an open capture with a user-safe reason, and leaves finished ones', async () => {
    await withTestDb(async (tx) => {
      const { a, ua } = await seedTwoTenants(tx);
      const h = harness(tx, a.id, ua);
      const { captureId } = await queued(tx, h);
      expect(await markCaptureFailed(tx, a.id, captureId, 'processing_failed', NOW)).toBe(true);
      const row = await readCapture(tx, a.id, captureId);
      expect(row.status).toBe('failed');
      expect(row.sourceMeta['failureReason']).toBe('processing_failed');
      expect(await markCaptureFailed(tx, a.id, captureId, 'processing_failed', NOW)).toBe(false);
    });
  });
});

describe('process job body', () => {
  it('claims a queued capture once and skips it afterwards', async () => {
    await withTestDb(async (tx) => {
      const { a, ua } = await seedTwoTenants(tx);
      const h = harness(tx, a.id, ua);
      const { captureId } = await createCapture(h.ctx, pdfInput());
      await putRaw(tx, h, captureId, PDF);
      await completeUpload(h.ctx, captureId, sha256(PDF));
      const payload = { workspaceId: a.id, captureId, pipelineVersion: CAPTURE_PIPELINE_VERSION };
      expect((await runCaptureProcess({ db: tx }, payload)).outcome).toBe('started');
      expect((await runCaptureProcess({ db: tx }, payload)).outcome).toBe('skipped');
      expect((await readCapture(tx, a.id, captureId)).status).toBe('processing');
      expect(
        (await runCaptureProcess({ db: tx }, { ...payload, captureId: crypto.randomUUID() }))
          .outcome,
      ).toBe('missing');
    });
  });
});

describe('config', () => {
  it('captureConfigFromEnv feeds the services', () => {
    expect(captureConfigFromEnv({}).presignTtlSeconds).toBe(600);
  });
});
