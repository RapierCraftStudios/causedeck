// Demo mode (#93): anyone can explore a fictional, read-mostly sample workspace without importing
// data. `enterDemo` gives a visitor an ephemeral user and a membership in one of the two demo
// workspaces (Chennai solo, Bengaluru chamber); the sign-in endpoint then opens a session that
// expires after 4 hours. `resetDemo` restores a workspace to the seed version and writes an audit
// event; the nightly `system.demo.reset` job also removes visitors whose session has ended.
//
// A demo workspace is an ordinary tenant under RLS (a visitor reads nothing outside it). What makes
// it a sandbox is `organization.is_demo`: no outward email, push, WhatsApp, webhook, invitation or
// billing call and no AI spend is made for it (`isDemoWorkspace`, `shared/demo-guard.ts`).
import { randomUUID } from 'node:crypto';

import {
  DEMO_VERSION,
  DEMO_WORKSPACE_KEYS,
  demoWorkspace,
  isDemoWorkspaceKey,
  resetDemoWorkspace,
  visitorEmail,
  visitorEmailPattern,
  type DemoWorkspaceKey,
} from '@causedeck/db/seed/demo';
import { schema, withWorkspace, type Queryable } from '@causedeck/db';
import { eq, sql } from 'drizzle-orm';

import { record } from '../audit/index.ts';
import { invalid, notFound, rateLimited } from '../shared/errors.ts';

const { member, user, workspaceSettings } = schema;

/** A demo session lasts 4 hours; the session row expires then and the visitor is removed later. */
export const DEMO_SESSION_TTL_MS = 4 * 60 * 60 * 1000;

/** Visitors alive at once; more than this is refused until the sweep removes the expired ones. */
export const MAX_DEMO_VISITORS = 500;

/** The role a visitor holds: full product access, but outward actions are blocked by `is_demo`. */
export const DEMO_VISITOR_ROLE = 'advocate' as const;

export interface DemoDeps {
  db: Queryable;
  now?: () => Date;
}

export interface DemoWorkspaceSummary {
  key: DemoWorkspaceKey;
  workspaceId: string;
  slug: string;
  /** The seed version the workspace was last restored to (null when never seeded by version). */
  demoVersion: string | null;
}

export interface EnteredDemo {
  userId: string;
  workspaceId: string;
  slug: string;
  /** When the session must end. */
  expiresAt: Date;
}

export interface DemoResetSummary {
  key: DemoWorkspaceKey;
  workspaceId: string;
  rows: number;
  visitors: number;
  ms: number;
}

interface TargetRow {
  workspace_id: string;
  slug: string;
}

/** The demo workspaces that exist: found through the owner-defined `app_demo_workspaces()` (ids and slugs only), then read in their own scope. */
export async function listDemoWorkspaces(db: Queryable): Promise<DemoWorkspaceSummary[]> {
  const rows = await db.execute<TargetRow & Record<string, unknown>>(
    sql`select workspace_id::text, slug from app_demo_workspaces()`,
  );
  const found: DemoWorkspaceSummary[] = [];
  for (const key of DEMO_WORKSPACE_KEYS) {
    const spec = demoWorkspace(key);
    const row = [...rows].find((r) => r.workspace_id === spec.id && r.slug === spec.slug);
    if (row !== undefined) {
      // The version is a tenant row (`workspace_settings`), read in the workspace's own scope.
      const [settings] = await withWorkspace(db, { workspaceId: row.workspace_id }, (tx) =>
        tx
          .select({ demoVersion: workspaceSettings.demoVersion })
          .from(workspaceSettings)
          .where(eq(workspaceSettings.workspaceId, row.workspace_id)),
      );
      found.push({
        key,
        workspaceId: row.workspace_id,
        slug: row.slug,
        demoVersion: settings?.demoVersion ?? null,
      });
    }
  }
  return found;
}

/** The ephemeral visitors alive now. */
async function visitorCount(db: Queryable): Promise<number> {
  const [row] = await db.execute<{ n: number } & Record<string, unknown>>(
    sql`select count(*)::int as n from "user" where email like ${visitorEmailPattern('%')}`,
  );
  return row?.n ?? 0;
}

/**
 * Create a visitor of the demo workspace `workspace`: an ephemeral user (reserved `.test` address,
 * fictional name) and a membership. The caller opens a session for `userId` that ends at
 * `expiresAt`. Never touches a non-demo workspace.
 */
export async function enterDemo(
  { db, now = () => new Date() }: DemoDeps,
  input: { workspace: string },
): Promise<EnteredDemo> {
  if (!isDemoWorkspaceKey(input.workspace)) throw invalid('Unknown demo workspace');
  const key = input.workspace;
  const target = (await listDemoWorkspaces(db)).find((w) => w.key === key);
  if (target === undefined) throw notFound('This demo is not available right now');
  if ((await visitorCount(db)) >= MAX_DEMO_VISITORS) throw rateLimited();

  const at = now();
  const userId = randomUUID();
  await db.insert(user).values({
    id: userId,
    name: 'Demo visitor (fictional)',
    email: visitorEmail(key, userId.replaceAll('-', '')),
    emailVerified: true,
    locale: 'en',
    createdAt: at,
    updatedAt: at,
  });
  await withWorkspace(db, { workspaceId: target.workspaceId }, (tx) =>
    tx.insert(member).values({
      organizationId: target.workspaceId,
      userId,
      role: DEMO_VISITOR_ROLE,
      joinedAt: at,
      roleGrantedAt: at,
      createdAt: at,
    }),
  );
  return {
    userId,
    workspaceId: target.workspaceId,
    slug: target.slug,
    expiresAt: new Date(at.getTime() + DEMO_SESSION_TTL_MS),
  };
}

/**
 * Restore demo workspaces to the seed version (all that exist, or `workspace`): rows and visitors
 * are removed, the seed is written again for today, and a `demo.reset` audit event is recorded.
 */
export async function resetDemo(
  { db }: DemoDeps,
  input: { workspace?: string; today?: string } = {},
): Promise<DemoResetSummary[]> {
  if (input.workspace !== undefined && !isDemoWorkspaceKey(input.workspace)) {
    throw invalid('Unknown demo workspace');
  }
  const existing = await listDemoWorkspaces(db);
  const targets = existing.filter(
    (w) => input.workspace === undefined || w.key === input.workspace,
  );
  const summaries: DemoResetSummary[] = [];
  for (const target of targets) {
    const started = Date.now();
    const result = await resetDemoWorkspace(
      db,
      target.key,
      input.today === undefined ? {} : { today: input.today },
    );
    const ms = Date.now() - started;
    await record(
      { db, workspaceId: target.workspaceId, actor: { userId: null, kind: 'system' } },
      {
        action: 'demo.reset',
        target: { kind: 'workspace', id: target.workspaceId },
        metadata: { demoVersion: DEMO_VERSION, rows: result.rows, visitors: result.visitors, ms },
      },
    );
    summaries.push({
      key: target.key,
      workspaceId: target.workspaceId,
      rows: result.rows,
      visitors: result.visitors,
      ms,
    });
  }
  return summaries;
}

/**
 * Remove visitors whose 4-hour session has ended (created more than `DEMO_SESSION_TTL_MS` ago).
 * Their memberships and sessions go with them. Returns how many were removed.
 */
export async function sweepExpiredDemoVisitors({
  db,
  now = () => new Date(),
}: DemoDeps): Promise<number> {
  const cutoff = new Date(now().getTime() - DEMO_SESSION_TTL_MS);
  const gone = await db.execute<{ n: number } & Record<string, unknown>>(
    sql`delete from "user" where email like ${visitorEmailPattern('%')} and created_at < ${cutoff.toISOString()}::timestamptz returning 1 as n`,
  );
  return [...gone].length;
}
