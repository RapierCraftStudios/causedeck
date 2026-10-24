// Receiving an inbound email (#54 part 3, #530). The webhook calls this once per recipient: the
// address resolves to a workspace and member without an oracle (`resolveAddress`), the `email`
// channel must be on, and the message is stored once per `(workspace, message id)` with its raw
// MIME reference and a 30-day expiry. `afterInsert` (the `email.intake` enqueue) runs in the same
// transaction, so a failed enqueue rolls the row back and the provider's retry is not mistaken for
// a duplicate. Nothing is read from the message here: parsing and trust are the job's.
import { RAW_TTL_DAYS } from '@causedeck/capture';
import { schema, withWorkspace, type Database, type Transaction } from '@causedeck/db';

import { isChannelEnabled } from '../capture/index.ts';

import { resolveAddress } from './address.ts';

const { intakeMessage } = schema;

const DAY_MS = 86_400_000;

export interface InboundEmailInput {
  /** The envelope recipient the message was sent to. */
  address: string;
  /** The `Message-ID` (or the provider's id). */
  messageId: string;
  /** The provider's reference to the raw MIME (`InboundNotification.rawRef`). */
  rawMimeRef: string;
  now?: Date;
}

export interface InboundEmailTarget {
  workspaceId: string;
  userId: string;
  intakeMessageId: string;
}

export type InboundEmailOutcome =
  | ({ status: 'accepted' } & InboundEmailTarget)
  | { status: 'duplicate' }
  | { status: 'dropped'; reason: 'unknown_address' | 'channel_disabled' };

export async function receiveInboundEmail(
  db: Database | Transaction,
  input: InboundEmailInput,
  afterInsert?: (target: InboundEmailTarget) => Promise<void>,
): Promise<InboundEmailOutcome> {
  const resolved = await resolveAddress(db, input.address);
  if (resolved === null) return { status: 'dropped', reason: 'unknown_address' };
  const { workspaceId, userId } = resolved;
  const now = input.now ?? new Date();

  return withWorkspace(db, { workspaceId }, async (tx): Promise<InboundEmailOutcome> => {
    if (!(await isChannelEnabled(tx, workspaceId, 'email'))) {
      return { status: 'dropped', reason: 'channel_disabled' };
    }
    const [row] = await tx
      .insert(intakeMessage)
      .values({
        workspaceId,
        messageId: input.messageId,
        status: 'received',
        rawMimeRef: input.rawMimeRef,
        rawExpiresAt: new Date(now.getTime() + RAW_TTL_DAYS * DAY_MS),
        receivedAt: now,
      })
      .onConflictDoNothing({ target: [intakeMessage.workspaceId, intakeMessage.messageId] })
      .returning({ id: intakeMessage.id });
    if (row === undefined) return { status: 'duplicate' };
    const target = { workspaceId, userId, intakeMessageId: row.id };
    await afterInsert?.(target);
    return { status: 'accepted', ...target };
  });
}
