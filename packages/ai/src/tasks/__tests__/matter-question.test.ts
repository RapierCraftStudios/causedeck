import { describe, expect, it } from 'vitest';

import { createMockProvider } from '../../providers/mock.ts';
import { TASK_IDS } from '../../types.ts';
import { getTask, TASKS } from '../registry.ts';

import { readFileSync } from 'node:fs';
import path from 'node:path';

const mock = createMockProvider({ fixturesDir: '/nonexistent' });
const task = getTask('answer_matter_question');
const input = {
  question: 'surgery without informed consent',
  sources: [
    { id: 'doc:d1:2', text: 'The patient was operated. The surgery was done without informed consent.' },
    { id: 'fact:f1', text: 'Costs were awarded.' },
  ],
};

describe('answer_matter_question', () => {
  it('is registered in the ids, the registry and the bedrock task list', () => {
    expect(TASK_IDS).toContain('answer_matter_question');
    expect(TASKS.answer_matter_question).toBe(task);
    const bedrock = readFileSync(
      path.resolve(import.meta.dirname, '../../providers/bedrock.ts'),
      'utf8',
    );
    expect(bedrock).toContain("'answer_matter_question'");
  });

  it('is a tool-less drafting-tier bedrock task', () => {
    expect(task.providers).toEqual(['bedrock']);
    expect(task.tier).toBe('drafting');
    expect(task.input.safeParse({ question: '', sources: [] }).success).toBe(false);
    expect(task.input.safeParse(input).success).toBe(true);
  });

  it('the mock replies deterministically with a verbatim quote of the best-overlapping source', async () => {
    const { output } = await mock.call(task, input, { suspicious: false });
    expect(task.output.safeParse(output).success).toBe(true);
    const { claims } = output as { claims: { sourceId: string; quote: string }[] };
    expect(claims).toHaveLength(1);
    expect(claims[0]?.sourceId).toBe('doc:d1:2');
    expect(input.sources[0]?.text).toContain(claims[0]?.quote ?? '#');
    expect((await mock.call(task, input, { suspicious: false })).output).toEqual(output);
  });
});
