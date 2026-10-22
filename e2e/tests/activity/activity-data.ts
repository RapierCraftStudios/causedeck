// Automation activities on the worker database (#49), for the feed specs. Written as the superuser
// (RLS does not apply), the way the engine would leave them after an auto-apply: an `activity` row
// with its `undo_payload`, and the task it created, so Undo really removes something. Every test
// starts from the reset seed, so nothing leaks between tests.
import postgres from 'postgres';

import { E2E_WORKSPACES, e2eUser, type E2eWorkspaceSlug } from '../../fixtures/index.ts';
import { MATTERS } from '../../fixtures/matters-data.ts';
import { databaseUrl } from '../../support/db-reset.ts';

export const CAPTURE_ID = '00000000-0000-4000-8000-0000000000c1';
const DAY_MS = 24 * 60 * 60 * 1000;

export interface SeedActivity {
  /** Stable handle for the spec. */
  key: string;
  summary: string;
  kind?: string;
  level?: 'L1' | 'L2' | 'L3';
  /** Days ago; may be fractional. */
  daysAgo?: number;
  /** Create a task and point the undo payload at it (an undoable `task`). */
  withTask?: boolean;
  matterId?: string;
  captureId?: string;
  confirmed?: boolean;
  source?: Record<string, unknown>;
  confidence?: number;
}

export interface SeededActivity extends SeedActivity {
  id: string;
  taskId: string | null;
}

/** Today's auto-applied task and attach, a confirmed proposal yesterday and an old capture. */
export const FEED: readonly SeedActivity[] = [
  {
    key: 'task',
    summary: 'Created a task: call the clerk about the certified copy',
    kind: 'task',
    level: 'L3',
    daysAgo: 0.1,
    withTask: true,
    matterId: MATTERS.appeal.id,
    captureId: CAPTURE_ID,
    source: {
      input: 'document',
      aiCall: { model: 'sarvam-m', modelVersion: '2026-09', region: 'ap-south-1' },
    },
    confidence: 0.93,
  },
  {
    key: 'attach',
    summary: 'Attached order to W.P. 12345 of 2026 · matched by case number',
    kind: 'document_attach',
    level: 'L3',
    daysAgo: 0.2,
    matterId: MATTERS.appeal.id,
    captureId: CAPTURE_ID,
    source: { input: 'document' },
    confidence: 0.97,
  },
  {
    key: 'confirmed',
    summary: 'You confirmed the next date, 14 Nov 2026',
    kind: 'next_date',
    level: 'L2',
    daysAgo: 1,
    confirmed: true,
    source: { input: 'email' },
  },
  {
    key: 'old',
    summary: 'Added the matter from the cause list',
    kind: 'new_matter',
    level: 'L1',
    daysAgo: 9,
    source: { input: 'list' },
  },
];

export async function seedActivities(
  database: string,
  slug: E2eWorkspaceSlug,
  items: readonly SeedActivity[] = FEED,
): Promise<Record<string, SeededActivity>> {
  const workspaceId = E2E_WORKSPACES[slug].id;
  const owner = e2eUser('owner', slug).id;
  const sql = postgres(databaseUrl(database, 'superuser'), { max: 1, onnotice: () => undefined });
  const out: Record<string, SeededActivity> = {};
  try {
    for (const item of items) {
      const created = new Date(Date.now() - (item.daysAgo ?? 0) * DAY_MS);
      const expires = new Date(created.getTime() + 7 * DAY_MS);
      let taskId: string | null = null;
      if (item.withTask === true) {
        const [task] = await sql<{ id: string }[]>`
          insert into task (workspace_id, title, matter_id, source_type, source_ref, confirmation_state)
          values (${workspaceId}, 'Call the clerk', ${item.matterId ?? null}, 'ai', 'e2e', 'auto_applied')
          returning id`;
        taskId = task?.id ?? null;
      }
      const refs: Record<string, unknown> = {
        ...(item.matterId === undefined ? {} : { matterId: item.matterId }),
        ...(taskId === null ? {} : { taskIds: [taskId] }),
      };
      const [row] = await sql<{ id: string }[]>`
        insert into activity (
          workspace_id, capture_id, kind, level, actor, actor_user_id, summary, entity_refs,
          undo_payload, undo_expires_at, confirmed_at, confirmed_by, confidence, source, created_at
        ) values (
          ${workspaceId}, ${item.captureId ?? null}, ${item.kind ?? 'task'}, ${item.level ?? 'L3'},
          ${item.confirmed === true ? 'user' : 'system'}, ${item.confirmed === true ? owner : null},
          ${item.summary}, ${sql.json(refs as never)},
          ${taskId === null ? null : sql.json({ taskId })}, ${expires},
          ${item.confirmed === true ? created : null}, ${item.confirmed === true ? owner : null},
          ${item.confidence ?? null}, ${sql.json((item.source ?? {}) as never)}, ${created}
        ) returning id`;
      if (!row) throw new Error('activity insert returned no row');
      out[item.key] = { ...item, id: row.id, taskId };
    }
  } finally {
    await sql.end();
  }
  return out;
}

/** What is left in the database for one seeded activity: the task and the activity's own state. */
export async function activityState(
  database: string,
  activityId: string,
  taskId: string | null,
): Promise<{ undone: boolean; taskExists: boolean }> {
  const sql = postgres(databaseUrl(database, 'superuser'), { max: 1, onnotice: () => undefined });
  try {
    const [a] = await sql<{ undone_at: Date | null }[]>`
      select undone_at from activity where id = ${activityId}`;
    const tasks =
      taskId === null ? [] : await sql<{ id: string }[]>`select id from task where id = ${taskId}`;
    return { undone: a?.undone_at != null, taskExists: tasks.length > 0 };
  } finally {
    await sql.end();
  }
}

/** The owner confirmed the result after the page was loaded: the engine now refuses to undo it. */
export async function confirmActivity(database: string, activityId: string): Promise<void> {
  const sql = postgres(databaseUrl(database, 'superuser'), { max: 1, onnotice: () => undefined });
  try {
    await sql`update activity set confirmed_at = now() where id = ${activityId}`;
  } finally {
    await sql.end();
  }
}
