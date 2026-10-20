// Support sessions on the worker database (#313). A staff member (an enabled `staff_user` row) and
// their sessions in one seeded workspace, written as the superuser so RLS and the app role's
// read-only grant on `staff_user` do not apply. The staff request flow itself lives in the admin
// app (#314); here a request is seeded the way `requestSession` writes it, including the owner's
// `security.alert` in-app notice (the notify path and the email delivery are covered by the core
// support tests). Every test starts from the reset seed, so nothing leaks between tests.
import postgres from 'postgres';

import { E2E_WORKSPACES, e2eUser, type E2eWorkspaceSlug } from '../../fixtures/index.ts';
import { databaseUrl } from '../../support/db-reset.ts';

export const STAFF_ID = '00000000-0000-4000-8000-0000000f0313';
export const SUPPORT_REASON = 'Customer reported that hearing dates stopped syncing';

export type SeedSessionState = 'requested' | 'granted' | 'elapsed';

export interface SeedSupportSession {
  id: string;
  state: SeedSessionState;
  scope?: 'view' | 'metadata';
  /** For `granted`: minutes left (default 60). */
  minutes?: number;
}

function connect(database: string) {
  return postgres(databaseUrl(database, 'superuser'), { max: 1, onnotice: () => undefined });
}

/** Seed the staff member and `sessions` in workspace `slug`; pending ones notify the owner. */
export async function seedSupport(
  database: string,
  slug: E2eWorkspaceSlug,
  sessions: readonly SeedSupportSession[],
): Promise<void> {
  const workspaceId = E2E_WORKSPACES[slug].id;
  const ownerId = e2eUser('owner', slug).id;
  const sql = connect(database);
  try {
    await sql`insert into "user" (id, name, email, email_verified)
              values (${STAFF_ID}::uuid, 'CauseDeck Support', 'support-313@causedeck.test', true)
              on conflict (id) do nothing`;
    await sql`insert into staff_user (user_id, role) values (${STAFF_ID}::uuid, 'support')
              on conflict (user_id) do nothing`;
    for (const s of sessions) {
      const scope = s.scope ?? 'view';
      if (s.state === 'requested') {
        await sql`insert into support_session (id, workspace_id, requested_by_staff, scope, reason)
                  values (${s.id}::uuid, ${workspaceId}::uuid, ${STAFF_ID}::uuid,
                          ${scope}::support_session_scope, ${SUPPORT_REASON})`;
        await sql`insert into notification
                    (workspace_id, user_id, category, title, body, href, dedupe_key)
                  values (${workspaceId}::uuid, ${ownerId}::uuid, 'security.alert',
                          'CauseDeck support asked to view this workspace',
                          ${`Read-only access to your workspace. Reason: ${SUPPORT_REASON}.`},
                          ${`/w/${slug}/settings/support`}, ${`support.requested:${s.id}`})`;
        continue;
      }
      // A grant `minutes` from now, or one that ran out 5 minutes ago (before the expiry job).
      const offset = s.state === 'elapsed' ? -5 : (s.minutes ?? 60);
      await sql`insert into support_session
                  (id, workspace_id, requested_by_staff, granted_by_user, scope, reason, status,
                   granted_at, expires_at)
                values (${s.id}::uuid, ${workspaceId}::uuid, ${STAFF_ID}::uuid, ${ownerId}::uuid,
                        ${scope}::support_session_scope, ${SUPPORT_REASON}, 'granted',
                        now() + make_interval(mins => ${offset - 60}),
                        now() + make_interval(mins => ${offset}))`;
    }
  } finally {
    await sql.end();
  }
}

/** The session row as the database holds it now. */
export async function supportSessionRow(
  database: string,
  id: string,
): Promise<{ status: string; expiresAt: Date | null; grantedAt: Date | null } | undefined> {
  const sql = connect(database);
  try {
    const [row] = await sql<{ status: string; expires_at: Date | null; granted_at: Date | null }[]>`
      select status, expires_at, granted_at from support_session where id = ${id}::uuid`;
    return row && { status: row.status, expiresAt: row.expires_at, grantedAt: row.granted_at };
  } finally {
    await sql.end();
  }
}

/** `HH:MM` in the app time zone, 24-hour, as the banner and the page show it. */
export function shellTime(at: Date): string {
  return new Intl.DateTimeFormat('en', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: 'Asia/Kolkata',
  }).format(at);
}
