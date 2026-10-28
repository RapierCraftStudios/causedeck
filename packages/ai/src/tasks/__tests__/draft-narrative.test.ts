import { describe, expect, it } from 'vitest';

import { BEDROCK_TASKS } from '../../providers/bedrock.ts';
import { getTask } from '../registry.ts';

describe('draft_narrative task', () => {
  const task = getTask('draft_narrative');

  it('is a versioned, bedrock-only, drafting-tier task', () => {
    expect(task.promptId).toBe('draft_narrative.v1');
    expect(task.tier).toBe('drafting');
    expect(task.providers).toEqual(['bedrock']);
    expect(BEDROCK_TASKS).toContain('draft_narrative');
  });

  it('validates input and output', () => {
    expect(task.input.safeParse({ prompt: 'p', facts: { a: 'b' }, maxChars: 100 }).success).toBe(
      true,
    );
    expect(task.input.safeParse({ prompt: '', facts: {}, maxChars: 100 }).success).toBe(false);
    expect(task.output.safeParse({ text: 'x' }).success).toBe(true);
    expect(task.output.safeParse({}).success).toBe(false);
  });
});
