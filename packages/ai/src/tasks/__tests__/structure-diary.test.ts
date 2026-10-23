import { describe, expect, it } from 'vitest';

import { getTask } from '../registry.ts';

describe('structure_diary task', () => {
  const task = getTask('structure_diary');

  it('keeps the legacy text-only input and output', () => {
    expect(task.input.safeParse({ text: 'Diary page' }).success).toBe(true);
    const out = task.output.safeParse({ proposals: [], confidence: 0.5 });
    expect(out.success).toBe(true);
  });

  it('takes numbered lines and returns entries that cite a line', () => {
    expect(task.input.safeParse({ text: 'a', lines: [{ n: 1, page: 1, text: 'a' }] }).success).toBe(
      true,
    );
    const out = task.output.parse({
      entries: [{ text: 'a', kind: 'task', line: 1 }],
      confidence: 0.7,
    }) as { entries: { line: number }[]; proposals: unknown[] };
    expect(out.entries[0]?.line).toBe(1);
    expect(out.proposals).toEqual([]);
  });

  it('rejects an entry with no line or an unknown kind', () => {
    expect(
      task.output.safeParse({ entries: [{ text: 'a', kind: 'task' }], confidence: 0.7 }).success,
    ).toBe(false);
    expect(
      task.output.safeParse({ entries: [{ text: 'a', kind: 'advice', line: 1 }], confidence: 0.7 })
        .success,
    ).toBe(false);
  });
});
