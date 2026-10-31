import { describe, expect, it } from 'vitest';

import { createMockProvider } from '../../providers/mock.ts';
import { getTask } from '../registry.ts';

const mock = createMockProvider({ fixturesDir: '/nonexistent' });

describe('plan_research_query', () => {
  const task = getTask('plan_research_query');

  it('is a platform-callable bedrock task with a validated schema', () => {
    expect(task.providers).toEqual(['bedrock']);
    expect(task.input.safeParse({ query: '' }).success).toBe(false);
    expect(task.input.safeParse({ query: 'post-operative infection' }).success).toBe(true);
  });

  it('the mock plans deterministically from the advocate words', async () => {
    const run = () =>
      mock.call(
        task,
        { query: 'Medical negligence with post-operative infection' },
        { suspicious: false },
      );
    const { output } = await run();
    expect(task.output.safeParse(output).success).toBe(true);
    expect(output).toMatchObject({
      keywords: ['medical', 'negligence', 'post', 'operative', 'infection'],
      courtLevel: null,
    });
    expect((await run()).output).toEqual(output);
  });
});

describe('answer_research_query', () => {
  const task = getTask('answer_research_query');
  const input = {
    query: 'surgery without informed consent',
    segments: [
      {
        id: 's1',
        text: 'The patient was operated. The surgery was done without informed consent.',
      },
      { id: 's2', text: 'Costs were awarded.' },
    ],
  };

  it('the mock quotes a passage sentence verbatim, only from passages that share words', async () => {
    const { output } = await mock.call(task, input, { suspicious: false });
    expect(task.output.safeParse(output).success).toBe(true);
    const { claims } = output as { claims: { segmentId: string; quote: string }[] };
    expect(claims).toHaveLength(1);
    expect(claims[0]?.segmentId).toBe('s1');
    expect(input.segments[0]?.text).toContain(claims[0]?.quote ?? '#');
  });

  it('the mock gives an empty answer when no passage matches', async () => {
    const { output } = await mock.call(
      task,
      { query: 'arbitration award', segments: [{ id: 's2', text: 'Costs were awarded.' }] },
      { suspicious: false },
    );
    expect(output).toEqual({ claims: [] });
  });
});
