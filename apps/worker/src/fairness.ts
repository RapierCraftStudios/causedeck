// Per-group concurrency gate (#15). pg-boss `groupConcurrency` is enforced at fetch time and races
// when several local fetch loops poll at once (observed: 4 concurrent for a cap of 3 in CI). This gate
// makes the cap exact within a worker process; across processes pg-boss grouping still applies.

/** Fairness group for a job: an explicit `fairnessKey`, else the workspace (same rule as the producer). */
export function fairnessGroupOf(data: unknown): string | undefined {
  if (data === null || typeof data !== 'object') return undefined;
  const { fairnessKey, workspaceId } = data as { fairnessKey?: unknown; workspaceId?: unknown };
  if (typeof fairnessKey === 'string' && fairnessKey.length > 0) return fairnessKey;
  return typeof workspaceId === 'string' ? workspaceId : undefined;
}

/** Limits concurrent runs per group key; waiters are released in FIFO order. */
export class GroupGate {
  readonly #limit: number;
  readonly #active = new Map<string, number>();
  readonly #waiters = new Map<string, Array<() => void>>();

  constructor(limit: number) {
    if (!Number.isInteger(limit) || limit < 1) throw new RangeError('group limit must be a positive integer');
    this.#limit = limit;
  }

  async run<T>(group: string | undefined, fn: () => Promise<T>): Promise<T> {
    if (group === undefined) return fn();
    await this.#acquire(group);
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

  async #acquire(group: string): Promise<void> {
    const n = this.#active.get(group) ?? 0;
    if (n < this.#limit) {
      this.#active.set(group, n + 1);
      return;
    }
    await new Promise<void>((resolve) => {
      const q = this.#waiters.get(group) ?? [];
      q.push(resolve);
      this.#waiters.set(group, q);
    });
    // The releaser handed its slot over without decrementing, so the count is already correct.
  }

  #release(group: string): void {
    const q = this.#waiters.get(group);
    const next = q?.shift();
    if (next) {
      if (q && q.length === 0) this.#waiters.delete(group);
      next();
      return;
    }
    const n = (this.#active.get(group) ?? 1) - 1;
    if (n <= 0) this.#active.delete(group);
    else this.#active.set(group, n);
  }
}
