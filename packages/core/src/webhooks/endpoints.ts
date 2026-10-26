// Webhook endpoints (#626, #487 part 3): a workspace's HTTPS receivers for change events. Managing
// them needs `workspace.manage`, like API keys (an API key acts as the member who issued it). The
// signing secret is returned once, by `createWebhookEndpoint`; lists and reads never carry it.
import { schema, withWorkspace, type Database, type Transaction } from '@causedeck/db';
import { and, desc, eq } from 'drizzle-orm';

import { record } from '../audit/index.ts';
import { requireCan } from '../workspaces/index.ts';

import { generateWebhookSecret } from './sign.ts';

const { webhookEndpoint, WEBHOOK_EVENT_TYPES } = schema;

type Queryable = Database | Transaction;

export const MAX_WEBHOOK_ENDPOINTS_PER_WORKSPACE = 10;
export const MAX_WEBHOOK_URL_LENGTH = 2048;
/** Consecutive failed deliveries after which an endpoint is switched off. */
export const WEBHOOK_DISABLE_AFTER_FAILURES = 10;

export class WebhookError extends Error {
  constructor(
    readonly reason: 'INVALID' | 'NOT_FOUND' | 'LIMIT',
    message: string,
  ) {
    super(message);
    this.name = 'WebhookError';
  }
}

export interface WebhookEndpointSummary {
  id: string;
  url: string;
  events: string[];
  active: boolean;
  consecutiveFailures: number;
  createdBy: string;
  createdAt: Date;
  disabledAt: Date | null;
}

const summaryColumns = {
  id: webhookEndpoint.id,
  url: webhookEndpoint.url,
  events: webhookEndpoint.events,
  active: webhookEndpoint.active,
  consecutiveFailures: webhookEndpoint.consecutiveFailures,
  createdBy: webhookEndpoint.createdBy,
  createdAt: webhookEndpoint.createdAt,
  disabledAt: webhookEndpoint.disabledAt,
};

export interface CreateWebhookEndpointInput {
  workspaceId: string;
  /** The member registering the endpoint; it must be allowed `workspace.manage`. */
  actorUserId: string;
  url: string;
  /** Event types to receive; omit for all of them. */
  events?: readonly string[];
}

export interface CreatedWebhookEndpoint {
  endpoint: WebhookEndpointSummary;
  /** The only time the signing secret is returned. */
  secret: string;
}

function validUrl(raw: string): string | null {
  if (raw.length === 0 || raw.length > MAX_WEBHOOK_URL_LENGTH) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** Register an endpoint. Throws `WebhookError` INVALID for a bad URL or event, LIMIT past the cap. */
export async function createWebhookEndpoint(
  db: Queryable,
  input: CreateWebhookEndpointInput,
): Promise<CreatedWebhookEndpoint> {
  const url = validUrl(input.url.trim());
  if (url === null) {
    throw new WebhookError('INVALID', 'A webhook URL is an https URL without credentials.');
  }
  const events = [...new Set(input.events ?? WEBHOOK_EVENT_TYPES)];
  const known: readonly string[] = WEBHOOK_EVENT_TYPES;
  if (events.length === 0 || !events.every((event) => known.includes(event))) {
    throw new WebhookError('INVALID', 'Events must be a non-empty list of known event types.');
  }
  const secret = generateWebhookSecret();
  const endpoint = await withWorkspace(
    db,
    { workspaceId: input.workspaceId, userId: input.actorUserId },
    async (tx) => {
      await requireCan(tx, input.workspaceId, input.actorUserId, 'workspace.manage');
      const existing = await tx
        .select({ id: webhookEndpoint.id })
        .from(webhookEndpoint)
        .where(eq(webhookEndpoint.workspaceId, input.workspaceId));
      if (existing.length >= MAX_WEBHOOK_ENDPOINTS_PER_WORKSPACE) {
        throw new WebhookError('LIMIT', 'This workspace has reached its webhook endpoint limit.');
      }
      const [row] = await tx
        .insert(webhookEndpoint)
        .values({
          workspaceId: input.workspaceId,
          url,
          secret,
          events,
          createdBy: input.actorUserId,
        })
        .returning(summaryColumns);
      if (!row) throw new Error('webhook endpoint insert returned no row');
      await record(
        {
          db: tx,
          workspaceId: input.workspaceId,
          actor: { userId: input.actorUserId, kind: 'user' },
        },
        {
          action: 'webhook_endpoint.created',
          target: { kind: 'webhook_endpoint', id: row.id },
          metadata: { events: events.join(',') },
        },
      );
      return row;
    },
  );
  return { endpoint, secret };
}

/** The workspace's endpoints, newest first (never the secret). */
export function listWebhookEndpoints(
  db: Queryable,
  workspaceId: string,
  actorUserId: string,
): Promise<WebhookEndpointSummary[]> {
  return withWorkspace(db, { workspaceId, userId: actorUserId }, async (tx) => {
    await requireCan(tx, workspaceId, actorUserId, 'workspace.manage');
    return tx
      .select(summaryColumns)
      .from(webhookEndpoint)
      .where(eq(webhookEndpoint.workspaceId, workspaceId))
      .orderBy(desc(webhookEndpoint.createdAt), desc(webhookEndpoint.id));
  });
}

/** Remove an endpoint and its deliveries. Another workspace's id is `NOT_FOUND`. */
export function deleteWebhookEndpoint(
  db: Queryable,
  workspaceId: string,
  actorUserId: string,
  endpointId: string,
): Promise<void> {
  return withWorkspace(db, { workspaceId, userId: actorUserId }, async (tx) => {
    await requireCan(tx, workspaceId, actorUserId, 'workspace.manage');
    const removed = await tx
      .delete(webhookEndpoint)
      .where(and(eq(webhookEndpoint.workspaceId, workspaceId), eq(webhookEndpoint.id, endpointId)))
      .returning({ id: webhookEndpoint.id });
    if (removed.length === 0) throw new WebhookError('NOT_FOUND', 'No such webhook endpoint.');
    await record(
      { db: tx, workspaceId, actor: { userId: actorUserId, kind: 'user' } },
      { action: 'webhook_endpoint.deleted', target: { kind: 'webhook_endpoint', id: endpointId } },
    );
  });
}
