// The `whatsapp.import` job body (#526): structure a received chat with the `structure_chat` task
// and stage what it finds as proposals. Only an internal chat on a capture that is not `ai_blocked`
// is ever sent to the gateway; a client chat (or a sensitive-matter capture) is finished without a
// model call. Every item is anchored to the message it came from, and the capture's raw text
// starts its 30-day clock once extracted (pin to keep it). Nothing is auto-applied here: the
// engine's matrix decides each draft's level.
import { can, isRole } from '@causedeck/auth/policy';
import {
  buildStructureInput,
  chatItemsToDrafts,
  verifyChatItems,
  type ChatMessage,
  type RawChatItem,
  type VerifiedChatItem,
} from '@causedeck/capture';
import { serverEnv } from '@causedeck/config/env';
import { schema, withWorkspace, type Database, type Transaction } from '@causedeck/db';
import { createObjectStoreFromEnv, objectKey, type ObjectStore } from '@causedeck/storage';
import type { AiGateway } from '@causedeck/ai';
import { and, eq } from 'drizzle-orm';
import { createHash, randomUUID } from 'node:crypto';

import { createCoreAiGateway } from '../ai/index.ts';
import { submitProposals } from '../automation/index.ts';
import { finishCapture, setExtractionTtl } from '../capture/index.ts';
import { createDocument, type GraphEvents, type MatterGraphDeps } from '../matter-graph/index.ts';
import { forbidden } from '../shared/errors.ts';
import { getRoleSettings, memberRole, toPolicySettings } from '../workspaces/index.ts';

import type { StoredChat } from './payload.ts';

const { anchor, blob, capture } = schema;

const NO_EVENTS: GraphEvents = {
  emit() {
    // The import has no event subscribers.
  },
};

export interface WhatsAppImportDeps {
  db: Database | Transaction;
  store?: ObjectStore;
  /** Defaults to the core gateway over `db` (mock provider unless providers are configured). */
  gateway?: AiGateway;
  events?: GraphEvents;
  now?: () => Date;
}

export type WhatsAppImportOutcome =
  | { outcome: 'missing' }
  | { outcome: 'skipped' }
  | { outcome: 'failed' }
  | { outcome: 'imported'; structured: boolean; items: number; proposals: number };

/** One text of the cited messages, with each message's character range (for the anchors). */
function evidenceText(
  items: readonly VerifiedChatItem[],
  messages: ReadonlyMap<string, ChatMessage>,
) {
  let text = '';
  const ranges = new Map<string, { start: number; end: number; line: string }>();
  for (const item of items) {
    if (ranges.has(item.ref)) continue;
    const source = messages.get(item.ref);
    if (source === undefined) continue;
    const line = `[${source.ts}] ${source.sender ?? ''}: ${source.text}`;
    ranges.set(item.ref, { start: text.length, end: text.length + line.length, line });
    text += `${line}\n`;
  }
  return { text, ranges };
}

/** Store the cited messages as a document of the matter and anchor each one (`document`). */
async function recordEvidence(
  deps: { store: ObjectStore; graph: MatterGraphDeps; now: Date },
  tx: Transaction,
  actor: { userId: string; workspaceId: string },
  matterId: string,
  items: readonly VerifiedChatItem[],
  messages: ReadonlyMap<string, ChatMessage>,
): Promise<Map<string, string>> {
  const { text, ranges } = evidenceText(items, messages);
  const anchors = new Map<string, string>();
  if (ranges.size === 0) return anchors;
  const body = Buffer.from(text, 'utf8');
  const sha256 = createHash('sha256').update(body).digest('hex');
  const blobId = randomUUID();
  const key = objectKey({ workspaceId: actor.workspaceId, kind: 'document', id: blobId }, deps.now);
  await deps.store.put({ key, body, contentType: 'text/plain' });
  await tx.insert(blob).values({
    id: blobId,
    workspaceId: actor.workspaceId,
    key,
    kind: 'document',
    filename: 'whatsapp-evidence.txt',
    size: body.byteLength,
    sha256,
    mime: 'text/plain',
    scanStatus: 'skipped',
    createdBy: actor.userId,
    createdAt: deps.now,
    finalizedAt: deps.now,
  });
  const document = await createDocument(deps.graph, actor, {
    matterId,
    kind: 'other',
    storageKey: key,
    sha256,
  });
  for (const [ref, range] of ranges) {
    const [row] = await tx
      .insert(anchor)
      .values({
        workspaceId: actor.workspaceId,
        documentId: document.id,
        pageNo: 1,
        quote: range.line.slice(0, schema.ANCHOR_QUOTE_MAX),
        charStart: range.start,
        charEnd: range.end,
        kind: 'document',
      })
      .returning({ id: anchor.id });
    if (row === undefined) throw new Error('anchor insert returned no row');
    anchors.set(ref, row.id);
  }
  return anchors;
}

export async function runWhatsAppImport(
  deps: WhatsAppImportDeps,
  payload: { workspaceId: string; captureId: string },
): Promise<WhatsAppImportOutcome> {
  const { workspaceId, captureId } = payload;
  const now = deps.now?.() ?? new Date();
  return withWorkspace(deps.db, { workspaceId }, async (tx): Promise<WhatsAppImportOutcome> => {
    const [row] = await tx
      .select()
      .from(capture)
      .where(and(eq(capture.id, captureId), eq(capture.workspaceId, workspaceId)))
      .for('update');
    if (row === undefined) return { outcome: 'missing' };
    if (row.status !== 'processing' || row.channel !== 'whatsapp_export') {
      return { outcome: 'skipped' };
    }
    const userId = row.createdBy;
    const key = row.rawStorageKey;
    if (userId === null || key === null) {
      await finishCapture(tx, row, 'failed', {}, now, 'processing_failed');
      return { outcome: 'failed' };
    }
    const store = deps.store ?? createObjectStoreFromEnv(serverEnv());
    const object = await store.get(key as Parameters<ObjectStore['get']>[0]);
    const chat = JSON.parse(Buffer.from(object.body).toString('utf8')) as StoredChat;

    // The one gate in front of the gateway: internal chats on a capture that may reach AI.
    if (chat.chatType !== 'internal' || row.aiBlocked) {
      await finishCapture(
        tx,
        row,
        'ready',
        {
          whatsappImport: {
            structured: false,
            reason: row.aiBlocked ? 'ai_blocked' : 'client_chat',
          },
        },
        now,
      );
      await setExtractionTtl(tx, workspaceId, captureId, now);
      return { outcome: 'imported', structured: false, items: 0, proposals: 0 };
    }

    const role = await memberRole(tx, userId, workspaceId);
    if (role === null || !isRole(role)) throw forbidden('The importer is no longer a member');
    const actor = { userId, workspaceId, role };
    if (!can(actor, 'matter.write').allow) throw forbidden('You cannot import a chat');

    const messages: ChatMessage[] = chat.messages.map((m) => ({
      id: m.id,
      ts: m.ts,
      sender: m.sender,
      text: m.text,
    }));
    const gateway = deps.gateway ?? createCoreAiGateway(tx, { now: () => now });
    const result = await gateway.run<{ items: RawChatItem[]; confidence: number }>(
      'structure_chat',
      buildStructureInput(chat.chatType, messages),
      {
        workspaceId,
        userId,
        captureId,
        ...(row.matterHintId === null ? {} : { matterId: row.matterHintId }),
        purpose: 'capture.structure_chat',
        automationLevel: 2,
        idempotencyKey: `whatsapp-import:${captureId}`,
      },
    );
    const verified = verifyChatItems(result.output.items, messages, { dateOrder: chat.dateOrder });

    const settings = toPolicySettings(await getRoleSettings(tx, workspaceId));
    const graph: MatterGraphDeps = {
      db: tx,
      events: deps.events ?? NO_EVENTS,
      settings,
      now: () => now,
    };
    const graphActor = { workspaceId, userId };
    const byId = new Map(messages.map((m) => [m.id, m]));
    const anchorIds =
      row.matterHintId === null || verified.length === 0
        ? new Map<string, string>()
        : await recordEvidence(
            { store, graph, now },
            tx,
            graphActor,
            row.matterHintId,
            verified,
            byId,
          );
    const drafts = chatItemsToDrafts(verified, {
      captureId,
      aiCallId: result.callId,
      matterId: row.matterHintId,
      anchorIds,
    });
    const submitted =
      drafts.length === 0 ? { items: [] } : await submitProposals(graph, graphActor, drafts);
    const proposals = submitted.items.filter((i) => i.status !== 'refused').length;

    await finishCapture(
      tx,
      row,
      proposals > 0 ? 'needs_you' : 'ready',
      { whatsappImport: { structured: true, items: verified.length, proposals } },
      now,
    );
    await setExtractionTtl(tx, workspaceId, captureId, now);
    return { outcome: 'imported', structured: true, items: verified.length, proposals };
  });
}
