import { describe, expect, it } from 'vitest';
import { GroupGate, fairnessGroupOf } from './fairness';

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('fairnessGroupOf', () => {
  it('prefers fairnessKey, falls back to workspaceId, ignores non-objects', () => {
    expect(fairnessGroupOf({ fairnessKey: 'k', workspaceId: 'w' })).toBe('k');
    expect(fairnessGroupOf({ workspaceId: 'w' })).toBe('w');
    expect(fairnessGroupOf({ fairnessKey: '', workspaceId: 'w' })).toBe('w');
    expect(fairnessGroupOf(null)).toBeUndefined();
    expect(fairnessGroupOf('x')).toBeUndefined();
  });
});

describe('GroupGate', () => {
  it('never exceeds the per-group limit and releases waiters FIFO', async () => {
    const gate = new GroupGate(3);
    let active = 0;
    let max = 0;
    const order: number[] = [];
    await Promise.all(
      Array.from({ length: 9 }, (_, i) =>
        gate.run('ws', async () => {
          active += 1;
          max = Math.max(max, active);
          order.push(i);
          await tick(5);
          active -= 1;
        }),
      ),
    );
    expect(max).toBe(3);
    expect(order).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(gate.active('ws')).toBe(0);
  });

  it('runs different groups independently and ungrouped jobs unrestricted', async () => {
    const gate = new GroupGate(1);
    let active = 0;
    let max = 0;
    const job = async () => {
      active += 1;
      max = Math.max(max, active);
      await tick(5);
      active -= 1;
    };
    await Promise.all([
      gate.run('a', job),
      gate.run('b', job),
      gate.run(undefined, job),
      gate.run(undefined, job),
    ]);
    expect(max).toBe(4);
  });

  it('releases the slot when the job throws', async () => {
    const gate = new GroupGate(1);
    await expect(gate.run('g', async () => Promise.reject(new Error('boom')))).rejects.toThrow(
      'boom',
    );
    expect(gate.active('g')).toBe(0);
    await expect(gate.run('g', () => Promise.resolve('ok'))).resolves.toBe('ok');
  });

  it('rejects a non-positive limit', async () => {
    expect(() => new GroupGate(0)).toThrow(RangeError);
    await expect(new GroupGate(3).run('g', () => Promise.resolve(1), 0)).rejects.toThrow(
      RangeError,
    );
  });

  async function maxInFlight(gate: GroupGate, limit: number | undefined, jobs = 6) {
    let active = 0;
    let max = 0;
    const order: number[] = [];
    await Promise.all(
      Array.from({ length: jobs }, (_, i) =>
        gate.run(
          'ws',
          async () => {
            active += 1;
            max = Math.max(max, active);
            order.push(i);
            await tick(5);
            active -= 1;
          },
          limit,
        ),
      ),
    );
    expect(order).toEqual(Array.from({ length: jobs }, (_, i) => i));
    expect(gate.active('ws')).toBe(0);
    return max;
  }

  it('caps a group at a lower per-call limit (#221 plan defaults), FIFO', async () => {
    expect(await maxInFlight(new GroupGate(3), 1)).toBe(1);
    expect(await maxInFlight(new GroupGate(3), 2)).toBe(2);
  });

  it('clamps a per-call limit above the constructor limit', async () => {
    expect(await maxInFlight(new GroupGate(2), 5)).toBe(2);
  });
});
