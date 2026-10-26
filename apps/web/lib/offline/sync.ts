// The offline outbox drain (#65 part 4, #745). Edits made offline are sealed into the outbox with a
// client key, then replayed in order through `pushOutboxAction` when the connection is back. The
// key is the idempotency key: a retry after a dropped connection resends the same key, and the
// server's operations set absolute values, so nothing is applied twice. A next date that changed
// on the server stops as a `conflict` entry (the conflict card) and is never retried blindly; a
// refusal stops as `failed`. Hearing captures are files and use the #50 outbox, not this one.
import type { Vault } from './crypto.ts';
import {
  type OfflineDb,
  type OutboxEntry,
  enqueueOutbox,
  listOutbox,
  removeOutbox,
  updateOutbox,
} from './db.ts';
import type { OutboxItem, OutboxResult } from '../../app/(app)/w/[slug]/_offline/outbox.ts';

export type { OutboxEntry };

/** The server's batch limit (`MAX_OUTBOX_ITEMS` in `_offline/outbox.ts`). */
export const BATCH_SIZE = 50;

/** An edit without its key; `enqueueEdit` adds one. */
export type OutboxEdit = OutboxItem extends infer T
  ? T extends unknown
    ? Omit<T, 'key'>
    : never
  : never;

export type PushBatch = (items: unknown[]) => Promise<OutboxResult[]>;

export interface DrainContext {
  db: OfflineDb;
  vault: Vault;
  push: PushBatch;
  now?: () => number;
}

export async function enqueueEdit(
  ctx: Pick<DrainContext, 'db' | 'vault' | 'now'>,
  workspaceId: string,
  edit: OutboxEdit,
  key: string = crypto.randomUUID(),
): Promise<OutboxEntry> {
  const now = (ctx.now ?? Date.now)();
  return enqueueOutbox(ctx.db, ctx.vault, workspaceId, key, { ...edit, key }, now);
}

export async function pendingCount(ctx: Pick<DrainContext, 'db' | 'vault'>): Promise<number> {
  return (await listOutbox(ctx.db, ctx.vault)).filter((e) => e.state === 'pending').length;
}

/** Entries that need the user: conflict cards and refusals. */
export async function stuckEntries(
  ctx: Pick<DrainContext, 'db' | 'vault'>,
): Promise<OutboxEntry[]> {
  return (await listOutbox(ctx.db, ctx.vault)).filter((e) => e.state !== 'pending');
}

export interface DrainSummary {
  sent: number;
  conflicts: number;
  failed: number;
  /** True when the connection dropped; the remaining entries stay queued for the next drain. */
  offline: boolean;
}

let draining: Promise<DrainSummary> | null = null;

/** Replay pending entries in order. Only one drain runs at a time; a second call joins it. */
export function drainOutbox(ctx: DrainContext): Promise<DrainSummary> {
  draining ??= run(ctx).finally(() => {
    draining = null;
  });
  return draining;
}

async function run(ctx: DrainContext): Promise<DrainSummary> {
  const now = ctx.now ?? Date.now;
  const summary: DrainSummary = { sent: 0, conflicts: 0, failed: 0, offline: false };
  const pending = (await listOutbox(ctx.db, ctx.vault)).filter((e) => e.state === 'pending');
  for (let i = 0; i < pending.length; i += BATCH_SIZE) {
    const batch = pending.slice(i, i + BATCH_SIZE);
    let results: OutboxResult[];
    try {
      results = await ctx.push(batch.map((e) => e.item));
    } catch {
      summary.offline = true;
      return summary;
    }
    const byKey = new Map(results.map((r) => [r.key, r]));
    for (const entry of batch) {
      const result = byKey.get(entry.key);
      if (!result) continue; // no answer: stays queued, resent with the same key
      if (result.status === 'applied' || result.status === 'duplicate') {
        await removeOutbox(ctx.db, entry.key);
        summary.sent += 1;
      } else if (result.status === 'conflict') {
        await updateOutbox(
          ctx.db,
          ctx.vault,
          {
            ...entry,
            state: 'conflict',
            ...(result.code === undefined ? {} : { code: result.code }),
            ...(result.serverDate === undefined ? {} : { serverDate: result.serverDate }),
          },
          now(),
        );
        summary.conflicts += 1;
      } else {
        await updateOutbox(
          ctx.db,
          ctx.vault,
          {
            ...entry,
            state: 'failed',
            ...(result.code === undefined ? {} : { code: result.code }),
          },
          now(),
        );
        summary.failed += 1;
      }
    }
  }
  return summary;
}

/** Drain when the browser comes back online. Returns the unsubscribe function. */
export function drainOnReconnect(ctx: DrainContext, target: EventTarget = globalThis): () => void {
  const handler = () => {
    void drainOutbox(ctx);
  };
  target.addEventListener('online', handler);
  return () => {
    target.removeEventListener('online', handler);
  };
}
