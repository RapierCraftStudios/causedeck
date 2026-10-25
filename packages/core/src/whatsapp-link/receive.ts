// Receiving a forwarded WhatsApp media message (#680, part 3 of #502), modelled on the inbound
// email receive (#530). The webhook calls this once per message: the sender's number resolves to
// one verified link without an oracle (`app_resolve_whatsapp_sender`: unknown, unlinked and
// ambiguous numbers are the same `null`), the member must still be in the workspace, the media
// type must be on the allow-list and the `whatsapp` capture channel must be on. The message is
// stored once per `(workspace, provider message id)`; `afterInsert` (the `whatsapp.intake`
// enqueue) runs in the same transaction, so a failed enqueue rolls the row back and the provider's
// retry is not mistaken for a duplicate. The media itself is the job's: nothing is downloaded here.
import {
  resolveWhatsAppMedia,
  type WhatsAppInboundMessage,
  type WhatsAppInboundProvider,
} from '@causedeck/capture';
import { createMetaWhatsAppProvider } from '@causedeck/capture';
import {
  schema,
  withWorkspace,
  type Database,
  type Queryable,
  type Transaction,
} from '@causedeck/db';
import { sql } from 'drizzle-orm';

import { isChannelEnabled } from '../capture/index.ts';
import { memberRole } from '../workspaces/index.ts';

const { whatsappInboundMessage } = schema;

const E164 = new RegExp(schema.WHATSAPP_E164_PATTERN);

export interface InboundWhatsAppInput {
  message: WhatsAppInboundMessage;
  now?: Date;
}

export interface InboundWhatsAppTarget {
  workspaceId: string;
  userId: string;
  inboundMessageId: string;
}

export type InboundWhatsAppOutcome =
  | ({ status: 'accepted' } & InboundWhatsAppTarget)
  | { status: 'duplicate' }
  | {
      status: 'dropped';
      reason: 'unknown_sender' | 'unsupported_type' | 'channel_disabled';
    };

/**
 * The workspace and member a number is linked to, or null. Runs on the app database with no
 * workspace scope (the sender is not signed in); the function matches only the number.
 */
async function resolveSender(
  db: Queryable,
  e164: string,
): Promise<{ workspaceId: string; userId: string } | null> {
  if (!E164.test(e164)) return null;
  const rows = await db.execute<{ workspace_id: string; user_id: string }>(
    sql`select workspace_id, user_id from app_resolve_whatsapp_sender(${e164})`,
  );
  const [row] = rows;
  return row ? { workspaceId: row.workspace_id, userId: row.user_id } : null;
}

export async function receiveInboundWhatsApp(
  db: Database | Transaction,
  input: InboundWhatsAppInput,
  afterInsert?: (target: InboundWhatsAppTarget) => Promise<void>,
): Promise<InboundWhatsAppOutcome> {
  const { message } = input;
  const sender = await resolveSender(db, message.from);
  if (sender === null) return { status: 'dropped', reason: 'unknown_sender' };
  const { workspaceId, userId } = sender;
  if ((await memberRole(db, userId, workspaceId)) === null) {
    return { status: 'dropped', reason: 'unknown_sender' };
  }
  const media = resolveWhatsAppMedia(message.mime, message.filename);
  if (media === null) return { status: 'dropped', reason: 'unsupported_type' };

  return withWorkspace(db, { workspaceId }, async (tx): Promise<InboundWhatsAppOutcome> => {
    if (!(await isChannelEnabled(tx, workspaceId, 'whatsapp'))) {
      return { status: 'dropped', reason: 'channel_disabled' };
    }
    const [row] = await tx
      .insert(whatsappInboundMessage)
      .values({
        workspaceId,
        userId,
        providerMessageId: message.providerMessageId,
        mediaId: message.mediaId,
        mime: message.mime,
        filename: media.filename,
        status: 'received',
        receivedAt: input.now ?? new Date(),
      })
      .onConflictDoNothing({
        target: [whatsappInboundMessage.workspaceId, whatsappInboundMessage.providerMessageId],
      })
      .returning({ id: whatsappInboundMessage.id });
    if (row === undefined) return { status: 'duplicate' };
    const target = { workspaceId, userId, inboundMessageId: row.id };
    await afterInsert?.(target);
    return { status: 'accepted', ...target };
  });
}

/**
 * The inbound WhatsApp provider the process is configured with: `WHATSAPP_INBOUND_APP_SECRET`,
 * `WHATSAPP_INBOUND_VERIFY_TOKEN` and `WHATSAPP_INBOUND_ACCESS_TOKEN` (Meta Cloud API). Optional
 * deployment toggles outside the typed `serverEnv()` schema, like `INBOUND_EMAIL_*`; with any of
 * them missing there is no provider and the webhook rejects every call.
 */
export function whatsappInboundProviderFromProcess(): WhatsAppInboundProvider | null {
  // eslint-disable-next-line no-process-env -- optional WHATSAPP_INBOUND_* toggles, outside the typed env schema.
  const env = process.env;
  const appSecret = env['WHATSAPP_INBOUND_APP_SECRET'];
  const verifyToken = env['WHATSAPP_INBOUND_VERIFY_TOKEN'];
  const accessToken = env['WHATSAPP_INBOUND_ACCESS_TOKEN'];
  if (!appSecret || !verifyToken || !accessToken) return null;
  return createMetaWhatsAppProvider({ appSecret, verifyToken, accessToken });
}
