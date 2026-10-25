// The `whatsapp.intake` job body (#680, part 3 of #502). One received forward is downloaded from
// the provider, checked against the allow-list, the size cap and its magic bytes, de-duplicated by
// sha256 within the workspace and stored as a `whatsapp` capture of the linked member, then queued
// for the scan or `capture.process`, as the email intake does. A message that cannot be stored for
// a reason retrying will not change (type, size, content, duplicate) is marked `dropped`; a
// provider or storage failure throws and the job retries. Idempotent: only a `received` message is
// worked. The media is data: nothing is opened or rendered here.
import {
  assertBytesMatch,
  CAPTURE_PIPELINE_VERSION,
  decideScan,
  isUnsupportedTypeError,
  resolveWhatsAppMedia,
  sizeCapBytes,
  transition,
  WhatsAppMediaTooLargeError,
  type CaptureConfig,
  type CaptureProcessPayload,
  type WhatsAppInboundProvider,
} from '@causedeck/capture';
import { schema, withWorkspace, type Database, type Transaction } from '@causedeck/db';
import { objectKey, type ObjectStore } from '@causedeck/storage';
import { and, eq, isNotNull, ne } from 'drizzle-orm';
import { createHash, randomUUID } from 'node:crypto';

import { record } from '../audit/index.ts';
import type { CaptureJobs } from '../capture/index.ts';

const { blob, capture, whatsappInboundMessage } = schema;

export interface WhatsAppIntakePayload {
  workspaceId: string;
  userId: string;
  inboundMessageId: string;
}

export interface WhatsAppIntakeDeps {
  db: Database | Transaction;
  store: ObjectStore;
  /** Downloads the media the webhook announced. */
  provider: Pick<WhatsAppInboundProvider, 'fetchMedia'>;
  config: CaptureConfig;
  /** The capture producer port (`capture.scan`, `capture.process`); the domain never imports jobs. */
  jobs: CaptureJobs;
  now?: () => Date;
}

export type WhatsAppIntakeOutcome =
  | { outcome: 'missing' }
  | { outcome: 'skipped' }
  | { outcome: 'dropped'; reason: 'unsupported_type' | 'too_large' | 'content_mismatch' | 'duplicate' | 'scan_required' }
  | { outcome: 'stored'; captureId: string };

type Dropped = Extract<WhatsAppIntakeOutcome, { outcome: 'dropped' }>['reason'];

export async function runWhatsAppIntake(
  deps: WhatsAppIntakeDeps,
  payload: WhatsAppIntakePayload,
): Promise<WhatsAppIntakeOutcome> {
  const { workspaceId, userId } = payload;
  const now = deps.now?.() ?? new Date();
  const [message] = await withWorkspace(deps.db, { workspaceId }, (tx) =>
    tx
      .select()
      .from(whatsappInboundMessage)
      .where(
        and(
          eq(whatsappInboundMessage.workspaceId, workspaceId),
          eq(whatsappInboundMessage.id, payload.inboundMessageId),
        ),
      ),
  );
  if (message === undefined) return { outcome: 'missing' };
  if (message.status !== 'received') return { outcome: 'skipped' };

  const markDropped = async (reason: Dropped): Promise<WhatsAppIntakeOutcome> => {
    await withWorkspace(deps.db, { workspaceId }, (tx) =>
      tx
        .update(whatsappInboundMessage)
        .set({ status: 'dropped' })
        .where(eq(whatsappInboundMessage.id, message.id)),
    );
    return { outcome: 'dropped', reason };
  };

  const media = resolveWhatsAppMedia(message.mime, message.filename);
  if (media === null) return markDropped('unsupported_type');
  const cap = sizeCapBytes(media.type, deps.config.sizeCapsBytes);
  let bytes: Uint8Array;
  try {
    bytes = await deps.provider.fetchMedia(message.mediaId, cap);
  } catch (error) {
    if (error instanceof WhatsAppMediaTooLargeError) return markDropped('too_large');
    throw error;
  }
  if (bytes.byteLength === 0) return markDropped('content_mismatch');
  try {
    await assertBytesMatch(media.type, bytes);
  } catch (error) {
    if (isUnsupportedTypeError(error)) return markDropped('content_mismatch');
    throw error;
  }

  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const scanning = deps.config.scan.clamav !== null;
  if (!scanning && !decideScan('skipped', deps.config.scan.required).ok) {
    return markDropped('scan_required');
  }

  return withWorkspace(deps.db, { workspaceId }, async (tx): Promise<WhatsAppIntakeOutcome> => {
    const [duplicate] = await tx
      .select({ id: capture.id })
      .from(capture)
      .where(
        and(
          eq(capture.workspaceId, workspaceId),
          eq(capture.sha256, sha256),
          eq(capture.channel, 'whatsapp'),
          isNotNull(capture.rawStorageKey),
          ne(capture.status, 'discarded'),
        ),
      )
      .limit(1);
    if (duplicate !== undefined) {
      await tx
        .update(whatsappInboundMessage)
        .set({ status: 'dropped' })
        .where(eq(whatsappInboundMessage.id, message.id));
      return { outcome: 'dropped', reason: 'duplicate' };
    }

    const state = transition(
      { status: 'received', sourceMeta: { providerMessageId: message.providerMessageId, history: [] } },
      scanning ? 'scanning' : 'queued',
      now,
    );
    const blobId = randomUUID();
    const key = objectKey({ workspaceId, kind: media.type.kind, id: blobId }, now);
    await deps.store.put({ key, body: Buffer.from(bytes), contentType: media.type.mime });
    try {
      await tx.insert(blob).values({
        id: blobId,
        workspaceId,
        key,
        kind: media.type.kind,
        filename: media.filename,
        size: bytes.byteLength,
        sha256,
        mime: media.type.mime,
        scanStatus: scanning ? 'pending' : 'skipped',
        createdBy: userId,
        createdAt: now,
        finalizedAt: now,
      });
      const [row] = await tx
        .insert(capture)
        .values({
          workspaceId,
          channel: 'whatsapp',
          status: state.status,
          rawStorageKey: key,
          sha256,
          mime: media.type.mime,
          sizeBytes: bytes.byteLength,
          originalFilename: media.filename,
          sourceMeta: state.sourceMeta,
          aiBlocked: false,
          scanStatus: scanning ? 'pending' : 'skipped',
          createdBy: userId,
          createdAt: now,
        })
        .returning({ id: capture.id });
      if (row === undefined) throw new Error('capture insert returned no row');
      await record(
        { db: tx, workspaceId, actor: { userId, kind: 'user' } },
        {
          action: 'capture.created',
          target: { kind: 'capture', id: row.id },
          metadata: {
            channel: 'whatsapp',
            mime: media.type.mime,
            sizeBytes: bytes.byteLength,
            aiBlocked: false,
          },
        },
      );
      await tx
        .update(whatsappInboundMessage)
        .set({ status: 'stored' })
        .where(eq(whatsappInboundMessage.id, message.id));
      if (scanning) await deps.jobs.scan({ workspaceId, captureId: row.id, sha256 });
      else {
        const process: CaptureProcessPayload = {
          workspaceId,
          captureId: row.id,
          pipelineVersion: CAPTURE_PIPELINE_VERSION,
        };
        await deps.jobs.process(process);
      }
      return { outcome: 'stored', captureId: row.id };
    } catch (error) {
      await deps.store.delete(key).catch(() => undefined);
      throw error;
    }
  });
}
