// `capture.scan` body (#43): stream the raw object to the scanner and move the capture on. Clean
// (or skipped when scanning is optional) goes `scanning -> queued` and enqueues `capture.process`;
// infected goes `scanning -> quarantined`, the raw object is moved to the quarantine prefix and no
// downstream job is enqueued. A scanner error throws so the job retries with backoff.
//
// Idempotent: only a capture still `scanning` with the same sha256 is scanned, so a re-run after
// the first completed (or after a quarantine) has no effect. The object is never opened or parsed
// here; the scanner only sees bytes.
import {
  CAPTURE_PIPELINE_VERSION,
  decideScan,
  type CaptureFailureReason,
} from '@causedeck/capture';
import { schema, withWorkspace } from '@causedeck/db';
import {
  objectKey,
  ObjectNotFoundError,
  type ObjectKey,
  type StoredObjectStream,
} from '@causedeck/storage';
import { and, eq } from 'drizzle-orm';

import { auditCaptureSystem } from './audit.ts';
import type { CaptureJobDeps } from './context.ts';
import { loadCapture, moveCapture } from './state.ts';

const { blob } = schema;

export type CaptureScanOutcome = 'missing' | 'skipped' | 'clean' | 'quarantined' | 'failed';

/** A scan that could not finish; the job retries it. Carries no file detail. */
export class ScanUnavailableError extends Error {
  override name = 'ScanUnavailableError';
  readonly code = 'SCAN_UNAVAILABLE' as const;

  constructor() {
    super('the scanner could not scan this capture');
  }
}

export async function runCaptureScan(
  deps: CaptureJobDeps,
  payload: { workspaceId: string; captureId: string; sha256: string },
): Promise<CaptureScanOutcome> {
  const { workspaceId, captureId } = payload;
  const now = deps.now?.() ?? new Date();
  return withWorkspace(deps.db, { workspaceId }, async (tx): Promise<CaptureScanOutcome> => {
    const row = await loadCapture(tx, workspaceId, captureId);
    if (row === null) return 'missing';
    if (row.status !== 'scanning' || row.sha256 !== payload.sha256) return 'skipped';
    const key = row.rawStorageKey as ObjectKey | null;
    if (key === null) return 'skipped';

    let stream: StoredObjectStream;
    try {
      stream = await deps.store.getStream(key);
    } catch (error) {
      if (!(error instanceof ObjectNotFoundError)) throw error;
      const reason: CaptureFailureReason = 'upload_missing';
      await moveCapture(tx, row, 'failed', now, { rawStorageKey: null }, reason);
      return 'failed';
    }

    const result = await deps.scanner.scan(stream.body);
    const decision = decideScan(result.outcome, deps.config.scan.required);

    if (decision.ok) {
      await tx
        .update(blob)
        .set({ scanStatus: decision.scanStatus })
        .where(and(eq(blob.key, key), eq(blob.workspaceId, workspaceId)));
      await moveCapture(tx, row, 'queued', now, { scanStatus: decision.scanStatus });
      await deps.jobs.process({
        workspaceId,
        captureId,
        pipelineVersion: CAPTURE_PIPELINE_VERSION,
      });
      return 'clean';
    }

    if (decision.quarantine) {
      const quarantineKey = objectKey({ workspaceId, kind: 'quarantine', id: captureId }, now);
      const source = await deps.store.getStream(key);
      await deps.store.putStream({
        key: quarantineKey,
        body: source.body,
        contentType: 'application/octet-stream',
      });
      await tx
        .update(blob)
        .set({ key: quarantineKey, scanStatus: 'infected' })
        .where(and(eq(blob.key, key), eq(blob.workspaceId, workspaceId)));
      await moveCapture(tx, row, 'quarantined', now, {
        scanStatus: 'infected',
        rawStorageKey: quarantineKey,
        ttlAt: null,
      });
      await deps.store.delete(key);
      await auditCaptureSystem(
        tx,
        workspaceId,
        'capture.quarantined',
        { kind: 'capture', id: captureId },
        {
          channel: row.channel,
          mime: row.mime,
          sizeBytes: row.sizeBytes,
          signature: result.signature ?? 'unknown',
        },
      );
      return 'quarantined';
    }

    // The scanner errored, or scanning is required and was skipped: retry the job.
    throw new ScanUnavailableError();
  });
}
