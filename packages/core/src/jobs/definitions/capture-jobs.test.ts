// The capture job definitions (#43): names and policies, id-only payloads, the retention schedule
// and its target listing, the scan job's retry-then-fail behaviour and the process job's hand-off.
import { CAPTURE_JOB_NAMES, CAPTURE_JOB_RETRIES } from '@causedeck/capture';
import { schema } from '@causedeck/db';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { seedTwoTenants } from '@causedeck/db/testing/two-tenants';
import { createMemoryObjectStore, objectKey } from '@causedeck/storage';
import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

import { harness, NOW, PDF, putRaw, readCapture, sha256 } from './capture-test-fixtures.ts';
import { completeUpload, createCapture } from '../../capture/index.ts';
import { contentFieldViolations, registry } from '../registry.ts';

import { captureProcess, captureProcessSchema, runCaptureProcessJob } from './capture-process.ts';
import {
  captureRetention,
  runCaptureRetentionSchedule,
  systemCaptureRetention,
} from './capture-retention.ts';
import { captureScan, captureScanSchema, runCaptureScanJob } from './capture-scan.ts';

const WORKSPACE = '6f9619ff-8b86-4011-b42d-00c04fc964ff';
const CAPTURE = '7f9619ff-8b86-4011-b42d-00c04fc964fe';
const SHA = 'a'.repeat(64);

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
const jobCtx = (db: never, attempt = 1) => ({ db, log: log as never, attempt });

describe('definitions', () => {
  it('registers the three jobs and the daily 02:00 IST retention tick', () => {
    const names = registry.definitions.map((def) => def.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'capture.scan',
        'capture.process',
        'capture.retention',
        'system.capture.retention',
      ]),
    );
    expect(CAPTURE_JOB_NAMES.retentionTick).toBe('system.capture.retention');
    expect(systemCaptureRetention.schedule).toEqual({ cron: '0 2 * * *', payload: {} });
    expect(contentFieldViolations([captureScan, captureProcess, captureRetention])).toEqual([]);
  });

  it('retries five attempts in all with exponential backoff', () => {
    for (const def of [captureScan, captureProcess]) {
      expect(def.retry).toMatchObject({ limit: 4, backoff: true });
    }
    expect(CAPTURE_JOB_RETRIES).toBe(4);
  });

  it('payloads carry identifiers only and are singleton per capture and hash', () => {
    expect(
      captureScanSchema.safeParse({ workspaceId: WORKSPACE, captureId: CAPTURE, sha256: SHA })
        .success,
    ).toBe(true);
    expect(
      captureScanSchema.safeParse({ workspaceId: WORKSPACE, captureId: CAPTURE, sha256: 'x' })
        .success,
    ).toBe(false);
    expect(
      captureProcessSchema.safeParse({
        workspaceId: WORKSPACE,
        captureId: CAPTURE,
        pipelineVersion: 'l1',
      }).success,
    ).toBe(true);
    expect(
      captureScan.singleton?.key({ workspaceId: WORKSPACE, captureId: CAPTURE, sha256: SHA }),
    ).toBe(`capture-scan:${CAPTURE}:${SHA}`);
    expect(
      captureProcess.singleton?.key({
        workspaceId: WORKSPACE,
        captureId: CAPTURE,
        pipelineVersion: 'l1',
      }),
    ).toBe(`capture-process:${CAPTURE}:l1`);
  });
});

describe('process job', () => {
  it('retries a capture that is not visible yet, and hands a queued one on once', async () => {
    await withTestDb(async (tx) => {
      const { a, ua } = await seedTwoTenants(tx);
      const h = harness(tx, a.id, ua);
      const { captureId } = await createCapture(h.ctx, {
        channel: 'upload',
        filename: 'order.pdf',
        mime: 'application/pdf',
        sizeBytes: PDF.byteLength,
        sha256: sha256(PDF),
      });
      await putRaw(tx, h, captureId, PDF);
      await completeUpload(h.ctx, captureId, sha256(PDF));
      const payload = { workspaceId: a.id, captureId, pipelineVersion: 'l1' };

      await runCaptureProcessJob(jobCtx(tx as never), payload);
      await runCaptureProcessJob(jobCtx(tx as never), payload);
      expect((await readCapture(tx, a.id, captureId)).status).toBe('processing');

      await expect(
        runCaptureProcessJob(jobCtx(tx as never), { ...payload, captureId: CAPTURE }),
      ).rejects.toMatchObject({ code: 'CAPTURE_NOT_VISIBLE' });
    });
  });
});

describe('scan job', () => {
  it('scans through the injected store and queues a clean capture', async () => {
    await withTestDb(async (tx) => {
      const { a, ua } = await seedTwoTenants(tx);
      const h = harness(tx, a.id, ua, { env: { CAPTURE_CLAMAV_HOST: '127.0.0.1' } });
      const { captureId } = await createCapture(h.ctx, {
        channel: 'upload',
        filename: 'order.pdf',
        mime: 'application/pdf',
        sizeBytes: PDF.byteLength,
        sha256: sha256(PDF),
      });
      await putRaw(tx, h, captureId, PDF);
      // The job takes its scanner from the environment: with no ClamAV host it skips the scan,
      // which is allowed unless CAPTURE_SCAN_REQUIRED is set.
      await completeUpload(h.ctx, captureId, sha256(PDF));
      await runCaptureScanJob(
        jobCtx(tx as never),
        { workspaceId: a.id, captureId, sha256: sha256(PDF) },
        { store: h.store, jobs: h.ctx.jobs, now: () => NOW },
      );
      const row = await readCapture(tx, a.id, captureId);
      expect(row.status).toBe('queued');
      expect(row.scanStatus).toBe('skipped');
      expect(h.processes).toHaveLength(1);
    });
  });

  it('retries a capture that is not visible yet', async () => {
    await withTestDb(async (tx) => {
      const { a } = await seedTwoTenants(tx);
      await expect(
        runCaptureScanJob(
          jobCtx(tx as never),
          { workspaceId: a.id, captureId: CAPTURE, sha256: SHA },
          { store: createMemoryObjectStore() },
        ),
      ).rejects.toMatchObject({ code: 'CAPTURE_NOT_VISIBLE' });
    });
  });
});

describe('retention schedule', () => {
  it('queues capture.retention for each workspace with expired raw objects', async () => {
    await withTestDb(async (tx) => {
      const { a, b } = await seedTwoTenants(tx);
      const key = objectKey({ workspaceId: a.id, kind: 'document', id: crypto.randomUUID() }, NOW);
      await inWorkspace(tx, a.id, (s) =>
        s
          .update(schema.capture)
          .set({ rawStorageKey: key, ttlAt: new Date(NOW.getTime() - 1000) })
          .where(eq(schema.capture.id, a.rows['capture']?.id ?? '')),
      );
      const sent: string[] = [];
      const targets = await runCaptureRetentionSchedule(jobCtx(tx as never), {
        enqueue: (workspaceId) => Promise.resolve(sent.push(workspaceId)),
        now: () => NOW,
      });
      expect(targets).toContain(a.id);
      expect(targets).not.toContain(b.id);
      expect(sent).toEqual(targets);
    });
  });
});
