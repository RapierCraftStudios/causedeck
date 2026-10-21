// Integration tokens (#287): the private email intake address and the private ICS feed URL on the
// settings integrations page, one `workspace_integration` row per (workspace, kind). A token is 32
// random bytes (base64url) and only its sha256 hex is stored; the plaintext exists once, in the
// result of `rotateIntegrationToken`, and is never logged or audited. Rotating replaces the hash,
// so the old token stops working at once. Members with `workspace.manage` rotate, audited
// fail-closed as `workspace.integration_token_rotated` in the caller's transaction. What the tokens
// unlock (inbound email, the feed endpoint) is the Capture milestone (#54, #53).
import { createHash, randomBytes } from 'node:crypto';

import { schema, type Database, type Transaction } from '@causedeck/db';
import { RotateIntegrationTokenInput } from '@causedeck/validators/workspace';
import { and, eq } from 'drizzle-orm';

import { record } from '../audit/index.ts';

import { invalid } from './errors.ts';
import { requireCan } from './members.ts';

type Queryable = Database | Transaction;

const { workspaceIntegration } = schema;

/** The integration tokens, in display order. */
export const INTEGRATION_KINDS = schema.INTEGRATION_KINDS;

export type IntegrationKind = schema.IntegrationKind;

/** What the settings page may know about a token: never the token or its hash. */
export interface IntegrationStatus {
  createdAt: Date;
  /** When the token was last replaced; null until the first rotation. */
  rotatedAt: Date | null;
}

/** Each kind's status; null when no token has been created yet. */
export type IntegrationStatuses = Record<IntegrationKind, IntegrationStatus | null>;

/** 32 random bytes, base64url: the only copy is the one returned to the member. */
export function generateIntegrationToken(): string {
  return randomBytes(32).toString('base64url');
}

/** sha256 hex of a token, as stored in `token_hash` (and looked up by the Capture endpoints). */
export function hashIntegrationToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** The workspace's integration tokens; every kind null when it has none (or is not visible). */
export async function getIntegrations(
  db: Queryable,
  workspaceId: string,
): Promise<IntegrationStatuses> {
  const rows = await db
    .select({
      kind: workspaceIntegration.kind,
      createdAt: workspaceIntegration.createdAt,
      rotatedAt: workspaceIntegration.rotatedAt,
    })
    .from(workspaceIntegration)
    .where(eq(workspaceIntegration.workspaceId, workspaceId));
  const statuses = Object.fromEntries(INTEGRATION_KINDS.map((kind) => [kind, null])) as Record<
    IntegrationKind,
    IntegrationStatus | null
  >;
  for (const row of rows)
    statuses[row.kind] = { createdAt: row.createdAt, rotatedAt: row.rotatedAt };
  return statuses;
}

export interface RotateIntegrationTokenRequest {
  workspaceId: string;
  actorUserId: string;
  kind: IntegrationKind;
  /** Request metadata for the audit row. */
  requestId?: string;
  userAgent?: string;
  ip?: string;
}

export interface RotateIntegrationTokenResult extends IntegrationStatus {
  kind: IntegrationKind;
  /** The new token. Shown once: it is not stored anywhere. */
  token: string;
}

/**
 * Create the kind's token, or replace it (the old one stops working at once). Needs
 * `workspace.manage`; runs in one transaction (a savepoint when `db` is already one), so the new
 * hash and its audit event commit together. The audit metadata names the kind only.
 */
export async function rotateIntegrationToken(
  db: Queryable,
  request: RotateIntegrationTokenRequest,
): Promise<RotateIntegrationTokenResult> {
  const parsed = RotateIntegrationTokenInput.safeParse({ kind: request.kind });
  if (!parsed.success) throw invalid('Unknown integration');
  const { kind } = parsed.data;
  const { workspaceId, actorUserId } = request;

  return db.transaction(async (tx) => {
    await requireCan(tx, workspaceId, actorUserId, 'workspace.manage');
    const token = generateIntegrationToken();
    const tokenHash = hashIntegrationToken(token);
    const now = new Date();
    const [existing] = await tx
      .select({ id: workspaceIntegration.id })
      .from(workspaceIntegration)
      .where(
        and(eq(workspaceIntegration.workspaceId, workspaceId), eq(workspaceIntegration.kind, kind)),
      )
      .for('update');

    const [row] = existing
      ? await tx
          .update(workspaceIntegration)
          .set({ tokenHash, rotatedAt: now })
          .where(eq(workspaceIntegration.id, existing.id))
          .returning({
            createdAt: workspaceIntegration.createdAt,
            rotatedAt: workspaceIntegration.rotatedAt,
          })
      : await tx
          .insert(workspaceIntegration)
          .values({ workspaceId, kind, tokenHash, createdAt: now })
          .returning({
            createdAt: workspaceIntegration.createdAt,
            rotatedAt: workspaceIntegration.rotatedAt,
          });
    if (!row) throw new Error('workspace_integration write returned no row');

    await record(
      {
        db: tx,
        workspaceId,
        actor: { userId: actorUserId, kind: 'user' as const },
        ...(request.requestId === undefined ? {} : { requestId: request.requestId }),
        ...(request.userAgent === undefined ? {} : { userAgent: request.userAgent }),
        ...(request.ip === undefined ? {} : { ip: request.ip }),
      },
      {
        action: 'workspace.integration_token_rotated',
        target: { kind: 'workspace', id: workspaceId },
        metadata: { kind },
      },
    );
    return { kind, token, createdAt: row.createdAt, rotatedAt: row.rotatedAt };
  });
}
