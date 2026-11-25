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
    {
      id: 'doc:d1:2',
      text: 'The patient was operated. The surgery was done without informed consent.',
    },
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

  it('is a tool-less drafting-tier bedrock task, with the preview plan provider after it', () => {
    expect(task.providers).toEqual(['bedrock', 'chatgpt-plan']);
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

  it('v2 output takes an optional written answer of at most 2000 characters (#1167)', () => {
    const claims = [{ statement: 'S', sourceId: 'fact:next_date', quote: 'Next date' }];
    expect(task.output.safeParse({ claims }).success).toBe(true);
    expect(task.output.safeParse({ claims, answer: 'The next date is set [1].' }).success).toBe(
      true,
    );
    expect(task.output.safeParse({ claims, answer: 'x'.repeat(2001) }).success).toBe(false);
    expect(task.output.safeParse({ claims, answer: 3 }).success).toBe(false);
  });

  it('v3 output takes an optional one-sentence bottom line of at most 300 characters (#1192)', () => {
    expect(task.promptId).toBe('answer_matter_question.v3');
    const claims = [{ statement: 'S', sourceId: 'fact:next_date', quote: 'Next date' }];
    expect(task.output.safeParse({ claims, answer: 'A [1].' }).success).toBe(true);
    expect(
      task.output.safeParse({ claims, answer: 'A [1].', bottomLine: 'Yes, on 10 Nov [1].' })
        .success,
    ).toBe(true);
    expect(task.output.safeParse({ claims, bottomLine: 'x'.repeat(301) }).success).toBe(false);
    expect(task.output.safeParse({ claims, bottomLine: 1 }).success).toBe(false);
    const { shape } = task.output as unknown as {
      shape: { bottomLine: { unwrap: () => { description?: string } } };
    };
    expect(shape.bottomLine.unwrap().description).toMatch(/Yes or No/);
  });

  it('the mock answers a next-date question from the matter facts with [n] markers', async () => {
    const facts = {
      question: 'What is the next date and what should I prepare?',
      sources: [
        { id: 'fact:matter', text: 'Matter: Rao v State. Status: open.' },
        { id: 'fact:next_date', text: 'Next date: 2026-11-10. Stage: Arguments.' },
        { id: 'fact:obligations', text: 'Open obligations: 1.' },
        {
          id: 'fact:obligation:o1',
          text: 'Open obligation (due later, 2026-11-09): File the reply.',
        },
        { id: 'fact:stage', text: 'Stage: Arguments.' },
      ],
    };
    const { output } = await mock.call(task, facts, { suspicious: false });
    expect(task.output.safeParse(output).success).toBe(true);
    const reply = output as { claims: { sourceId: string; quote: string }[]; answer: string };
    expect(reply.claims.map((c) => c.sourceId)).toEqual([
      'fact:next_date',
      'fact:stage',
      'fact:obligations',
      'fact:obligation:o1',
    ]);
    for (const c of reply.claims) {
      expect(facts.sources.find((s) => s.id === c.sourceId)?.text).toContain(c.quote);
    }
    expect(reply.answer).toContain('Next date: 2026-11-10. Stage: Arguments. [1]');
    expect(reply.answer).toContain('[4]');
    expect(reply.answer).not.toContain('[5]');
  });

  it('the mock does not claim matter facts for a question without matter intent', async () => {
    const { output } = await mock.call(
      task,
      {
        question: 'Is the dueling clause valid?',
        sources: [{ id: 'fact:next_date', text: 'Next date: 2026-11-10.' }],
      },
      { suspicious: false },
    );
    expect(output).toEqual({ claims: [] });
  });
});
