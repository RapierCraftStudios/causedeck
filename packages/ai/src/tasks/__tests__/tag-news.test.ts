import { describe, expect, it } from 'vitest';

import { getTask } from '../registry.ts';

describe('tag_news task', () => {
  const task = getTask('tag_news');

  it('takes a headline and an optional excerpt only', () => {
    expect(task.input.safeParse({ title: 'SC on s.138', excerpt: 'Cheque bounce.' }).success).toBe(
      true,
    );
    expect(task.input.safeParse({ excerpt: 'no title' }).success).toBe(false);
  });

  it('accepts only closed tag values, never free text', () => {
    expect(
      task.output.safeParse({ practiceAreas: ['tax'], forums: ['supreme_court'] }).success,
    ).toBe(true);
    expect(task.output.safeParse({ practiceAreas: ['made up'], forums: [] }).success).toBe(false);
    expect(
      task.output.safeParse({ practiceAreas: [], forums: ['a free text forum'] }).success,
    ).toBe(false);
    expect(task.output.safeParse({ practiceAreas: [], forums: [], summary: 'x' }).success).toBe(
      true,
    );
  });
});
