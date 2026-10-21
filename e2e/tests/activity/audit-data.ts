// Audit events on the worker database (#232). Written through `app_audit_append()` (migration
// 0008_audit), the only writer of `audit_event`, so every row is chained like a real one; as the
// superuser, so RLS does not apply. `created_at` is the insert time, so specs mask the timestamps
// in screenshots. Every test starts from the reset seed, so nothing leaks between tests.
import postgres from 'postgres';

import { E2E_WORKSPACES, e2eUser, type E2eWorkspaceSlug } from '../../fixtures/index.ts';
import { databaseUrl } from '../../support/db-reset.ts';

export interface SeedAuditEvent {
  action: string;
  actor: 'owner' | 'advocate' | 'junior' | 'system';
  target?: { kind: string; role: 'owner' | 'advocate' | 'junior' | 'clerk' | 'viewer' };
  outcome: 'success' | 'denied' | 'error';
  metadata?: Record<string, string | number | boolean>;
  ip?: string;
}

/** Oldest first: a role change, a refused export by a junior, a failed system purge. */
export const AUDIT_EVENTS: readonly SeedAuditEvent[] = [
  {
    action: 'member.role_changed',
    actor: 'owner',
    target: { kind: 'user', role: 'clerk' },
    outcome: 'success',
    metadata: { role: 'clerk' },
    ip: '203.0.113.42',
  },
  { action: 'audit.exported', actor: 'junior', outcome: 'denied', ip: '198.51.100.7' },
  { action: 'audit.retention_purged', actor: 'system', outcome: 'error', metadata: { rows: 0 } },
];

export function seedAudit(
  database: string,
  slug: E2eWorkspaceSlug,
  events: readonly SeedAuditEvent[] = AUDIT_EVENTS,
): Promise<void> {
  const workspaceId = E2E_WORKSPACES[slug].id;
  const sql = postgres(databaseUrl(database, 'superuser'), { max: 1, onnotice: () => undefined });
  return (async () => {
    try {
      for (const event of events) {
        const system = event.actor === 'system';
        const actorId = event.actor === 'system' ? null : e2eUser(event.actor, slug).id;
        const targetId = event.target ? e2eUser(event.target.role, slug).id : null;
        await sql`
          select id from app_audit_append(
            ${workspaceId}::uuid, ${actorId}::uuid,
            ${system ? 'system' : 'user'}::audit_actor_kind, ${event.action},
            ${event.target?.kind ?? null}, ${targetId},
            ${event.outcome}::audit_outcome, ${event.ip ?? null}::inet, ${null}, ${null},
            ${JSON.stringify(event.metadata ?? {})}::jsonb)`;
      }
    } finally {
      await sql.end();
    }
  })();
}
