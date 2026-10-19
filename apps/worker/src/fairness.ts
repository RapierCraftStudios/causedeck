// Per-group concurrency gate (#15). pg-boss `groupConcurrency` is enforced at fetch time and races
// when several local fetch loops poll at once (observed: 4 concurrent for a cap of 3 in CI). This gate
// makes the cap exact within a worker process; across processes pg-boss grouping still applies.
// A call may pass a lower per-group limit (the workspace plan's default, #221); the gate never goes
// above its constructor limit.

/** Fairness group for a job: an explicit `fairnessKey`, else the workspace (same rule as the producer). */
export function fairnessGroupOf(data: unknown): string | undefined {
  if (data === null || typeof data !== 'object') return undefined;
  const { fairnessKey, workspaceId } = data as { fairnessKey?: unknown; workspaceId?: unknown };
  if (typeof fairnessKey === 'string' && fairnessKey.length > 0) return fairnessKey;
  return typeof workspaceId === 'string' ? workspaceId : undefined;
}

interface Waiter {
  limit: number;
  resolve: () => void;
}

/** Limits concurrent runs per group key; waiters are released in FIFO order. */
export class GroupGate {
  readonly #limit: number;
  readonly #active = new Map<string, number>();
  readonly #waiters = new Map<string, Waiter[]>();

  constructor(limit: number) {
    if (!Number.isInteger(limit) || limit < 1)
      throw new RangeError('group limit must be a positive integer');
    this.#limit = limit;
  }

  /** Run `fn` within the group's limit: `min(constructor limit, limit)` when `limit` is given. */
  async run<T>(group: string | undefined, fn: () => Promise<T>, limit?: number): Promise<T> {
    if (group === undefined) return fn();
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
      throw new RangeError('group limit must be a positive integer');
    }
    await this.#acquire(group, Math.min(this.#limit, limit ?? this.#limit));
    try {
      return await fn();
    } finally {
      this.#release(group);
    }
  }

  /** Current in-flight count for a group (tests and diagnostics). */
  active(group: string): number {
    return this.#active.get(group) ?? 0;
  }

  async #acquire(group: string, limit: number): Promise<void> {
    const n = this.#active.get(group) ?? 0;
    if (n < limit && !this.#waiters.has(group)) {
      this.#active.set(group, n + 1);
      return;
    }
    await new Promise<void>((resolve) => {
      const q = this.#waiters.get(group) ?? [];
      q.push({ limit, resolve });
      this.#waiters.set(group, q);
    });
    // The releaser handed its slot over without decrementing, so the count is already correct.
  }

  #release(group: string): void {
    const n = (this.#active.get(group) ?? 1) - 1;
    const q = this.#waiters.get(group);
    const next = q?.[0];
    // Hand the slot to the head waiter (FIFO) when it fits that waiter's limit.
    if (q && next && n < next.limit) {
      q.shift();
      if (q.length === 0) this.#waiters.delete(group);
      next.resolve();
      return;
    }
    if (n <= 0) this.#active.delete(group);
    else this.#active.set(group, n);
  }
}
