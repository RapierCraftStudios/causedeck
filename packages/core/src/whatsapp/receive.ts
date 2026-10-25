// Receiving a WhatsApp chat import (#526; PRD CA-6, docs/product/09 §3). The payload carries the
// messages the user selected in the browser. The server re-applies the exclusion rules and limits
// (`validateSelection`), stores only the messages that pass as one JSON object (excluded and
// unselected messages are never written), and queues the capture for `capture.process`, which hands
// it to the `whatsapp.import` job. Audio attachments are kept as references and never transcribed;
// attachment bytes arrive through the normal upload pipeline (allow-list, sniff, dedupe, #43).
import { createHash, randomUUID } from 'node:crypto';

import {
  CAPTURE_PIPELINE_VERSION,
  isWhatsAppSelectionError,
  transition,
  validateSelection,
} from '@causedeck/capture';
import { schema, withWorkspace, type Queryable } from '@causedeck/db';
import { objectKey } from '@causedeck/storage';
import { and, eq, isNotNull, ne } from 'drizzle-orm';

import { record } from '../audit/index.ts';
import { assertChannelEnabled, type CaptureCtx } from '../capture/index.ts';
import { invalid, notFound } from '../shared/errors.ts';

import {
  mediaKindOf,
  rebuildExportText,
  safeMediaName,
  WhatsAppImportInput,
  type StoredChat,
  type StoredChatMessage,
} from './payload.ts';

const { blob, capture, matter, proceeding } = schema;

export interface ReceivedWhatsAppImport {
  captureId: string;
  status: 'queued' | 'duplicate';
  /** Messages stored, and messages the rules held back (counts only). */
  stored: number;
  excluded: number;
  duplicateOf?: string;
}

const scope = (ctx: CaptureCtx) => ({ workspaceId: ctx.workspaceId, userId: ctx.userId });

/** Case numbers of the workspace's sensitive matters, so a message naming one is held back. */
async function sensitiveCaseNumbers(db: Queryable, workspaceId: string): Promise<string[]> {
  const rows = await db
    .select({
      caseType: proceeding.caseTypeCode,
      number: proceeding.number,
      year: proceeding.year,
    })
    .from(proceeding)
    .innerJoin(
      matter,
      and(eq(matter.workspaceId, proceeding.workspaceId), eq(matter.id, proceeding.matterId)),
    )
    .where(and(eq(proceeding.workspaceId, workspaceId), eq(matter.sensitive, true)));
  return rows.map((r) => `${r.caseType} ${String(r.number)}/${String(r.year)}`);
}

/** A matter hint at a sensitive matter blocks every AI step (CA-10); a hidden matter is not found. */
async function matterBlocksAi(
  db: Queryable,
  workspaceId: string,
  matterId: string | undefined,
): Promise<boolean> {
  if (matterId === undefined) return false;
  const [row] = await db
    .select({ sensitive: matter.sensitive })
    .from(matter)
    .where(and(eq(matter.id, matterId), eq(matter.workspaceId, workspaceId)));
  if (row === undefined) throw notFound('Matter not found');
  return row.sensitive;
}

export async function receiveWhatsAppImport(
  ctx: CaptureCtx,
  rawInput: unknown,
): Promise<ReceivedWhatsAppImport> {
  await ctx.authorize('document.write');
  const parsedInput = WhatsAppImportInput.safeParse(rawInput);
  if (!parsedInput.success) throw invalid('Invalid WhatsApp import');
  const input = parsedInput.data;
  const ids = new Set(input.messages.map((m) => m.id));
  if (ids.size !== input.messages.length) throw invalid('Message ids must be unique');
  const now = ctx.now?.() ?? new Date();

  return withWorkspace(ctx.db, scope(ctx), async (tx) => {
    await assertChannelEnabled(tx, ctx.workspaceId, 'whatsapp_export');
    const aiBlocked = await matterBlocksAi(tx, ctx.workspaceId, input.matterHintId);

    const text = rebuildExportText(input.messages, input.dateOrder);
    const confirmed = new Set(input.confirmedIds ?? []);
    let validated;
    try {
      validated = validateSelection({
        text,
        chatType: input.chatType,
        expectedChatType: input.openedFor,
        selectedIndexes: input.messages.map((_, i) => i),
        confirmedIndexes: input.messages.flatMap((m, i) => (confirmed.has(m.id) ? [i] : [])),
        dateOrder: input.dateOrder,
        sensitiveCaseNumbers: await sensitiveCaseNumbers(tx, ctx.workspaceId),
        sizeCapsBytes: ctx.config.sizeCapsBytes,
      });
    } catch (error) {
      if (isWhatsAppSelectionError(error)) throw invalid(error.message);
      throw error;
    }
    // A re-parse that finds a different number of messages means a message body held a line that
    // reads as a message header: refuse rather than guess which message is which.
    if (validated.messages.length + validated.excluded.length !== input.messages.length) {
      throw invalid('The selection does not match the messages sent');
    }

    const stored: StoredChatMessage[] = [];
    for (const parsed of validated.messages) {
      const source = input.messages[parsed.index];
      if (source === undefined) throw invalid('The selection does not match the messages sent');
      const entry: StoredChatMessage = {
        id: source.id,
        ts: source.ts,
        sender: source.sender,
        text: source.text,
      };
      if (source.mediaRef !== undefined) {
        if (mediaKindOf(source.mediaRef) === 'audio') entry.voiceNote = true;
        const name = safeMediaName(source.mediaRef);
        if (name !== null) entry.mediaRef = name;
      }
      stored.push(entry);
    }
    if (stored.length === 0) throw invalid('Every selected message was held back by the rules');

    const object: StoredChat = {
      v: 1,
      chatTitleHash: input.chatTitleHash,
      chatType: input.chatType,
      dateOrder: validated.dateOrder,
      messages: stored,
    };
    const bytes = Buffer.from(JSON.stringify(object), 'utf8');
    const sha256 = createHash('sha256').update(bytes).digest('hex');

    const [duplicate] = await tx
      .select({ id: capture.id })
      .from(capture)
      .where(
        and(
          eq(capture.workspaceId, ctx.workspaceId),
          eq(capture.sha256, sha256),
          eq(capture.channel, 'whatsapp_export'),
          isNotNull(capture.rawStorageKey),
          ne(capture.status, 'discarded'),
        ),
      )
      .limit(1);
    if (duplicate !== undefined) {
      return {
        captureId: duplicate.id,
        status: 'duplicate',
        stored: stored.length,
        excluded: validated.excluded.length,
        duplicateOf: duplicate.id,
      };
    }

    const blobId = randomUUID();
    const key = objectKey({ workspaceId: ctx.workspaceId, kind: 'document', id: blobId }, now);
    await ctx.store.put({ key, body: bytes, contentType: 'application/json' });
    try {
      await tx.insert(blob).values({
        id: blobId,
        workspaceId: ctx.workspaceId,
        key,
        kind: 'document',
        filename: 'whatsapp-chat.json',
        size: bytes.byteLength,
        sha256,
        mime: 'application/json',
        scanStatus: 'skipped',
        createdBy: ctx.userId,
        createdAt: now,
        finalizedAt: now,
      });
      const next = transition({ status: 'received', sourceMeta: {} }, 'queued', now);
      const [row] = await tx
        .insert(capture)
        .values({
          workspaceId: ctx.workspaceId,
          channel: 'whatsapp_export',
          status: next.status,
          rawStorageKey: key,
          sha256,
          mime: 'application/json',
          sizeBytes: bytes.byteLength,
          originalFilename: 'whatsapp-chat.json',
          sourceMeta: {
            ...next.sourceMeta,
            chatTitleHash: input.chatTitleHash,
            chatType: input.chatType,
            whatsappImport: { stored: stored.length, excluded: validated.excluded.length },
          },
          matterHintId: input.matterHintId ?? null,
          aiBlocked,
          scanStatus: 'skipped',
          createdBy: ctx.userId,
          createdAt: now,
        })
        .returning({ id: capture.id });
      if (row === undefined) throw new Error('capture insert returned no row');
      await record(
        {
          db: tx,
          workspaceId: ctx.workspaceId,
          actor: { userId: ctx.userId, kind: 'user' },
          ...(ctx.requestId === undefined ? {} : { requestId: ctx.requestId }),
          ...(ctx.userAgent === undefined ? {} : { userAgent: ctx.userAgent }),
          ...(ctx.ip === undefined ? {} : { ip: ctx.ip }),
        },
        {
          action: 'capture.created',
          target: { kind: 'capture', id: row.id },
          metadata: {
            channel: 'whatsapp_export',
            mime: 'application/json',
            sizeBytes: bytes.byteLength,
            aiBlocked,
          },
        },
      );
      await ctx.jobs.process({
        workspaceId: ctx.workspaceId,
        captureId: row.id,
        pipelineVersion: CAPTURE_PIPELINE_VERSION,
      });
      return {
        captureId: row.id,
        status: 'queued',
        stored: stored.length,
        excluded: validated.excluded.length,
      };
    } catch (error) {
      await ctx.store.delete(key).catch(() => undefined);
      throw error;
    }
  });
}
