import { describe, expect, it } from 'vitest';

import {
  answerMatterQuestion,
  createExtractiveMatterAnswerResolver,
  type CopilotSource,
} from '../answer-sources.ts';

const sources: CopilotSource[] = [
  { id: 'fact:header', text: 'Matter: Rao v State. Status: open.', page: null },
  {
    id: 'doc:d1:3',
    text: 'Intro line.\n\n12. The appellant was not given notice before the order.\n\n13. Costs follow.',
    page: 3,
    documentId: 'd1',
  },
  { id: 'seg:s1', text: 'Surgery was done without informed consent.', page: 7, judgmentId: 'j1' },
];

const reply = (claims: unknown[]) => () => Promise.resolve({ claims });

describe('answerMatterQuestion', () => {
  it('verifies a quote per source kind and computes the pinpoint from the text', async () => {
    const out = await answerMatterQuestion(
      'q',
      sources,
      reply([
        { statement: 'S1', sourceId: 'doc:d1:3', quote: 'THE appellant was  not given notice' },
        { statement: 'S2', sourceId: 'seg:s1', quote: 'without informed consent' },
        { statement: 'S3', sourceId: 'fact:header', quote: 'Status: open' },
      ]),
    );
    expect(out.unsupported).toEqual([]);
    expect(out.claims.map((c) => [c.kind, c.pinpoint])).toEqual([
      ['doc', { page: 3, paragraph: 12 }],
      ['seg', { page: 7, paragraph: null }],
      ['fact', { page: null, paragraph: null }],
    ]);
    expect(out.claims[0]?.documentId).toBe('d1');
    expect(out.claims[1]?.judgmentId).toBe('j1');
    expect(out.answerText).toBe('S1 S2 S3');
  });

  it('pinpoints the numbered paragraph of a judgment segment (#1132)', async () => {
    const segment: CopilotSource = {
      id: 'seg:s2',
      text: '11. Earlier text.\n12. No written consent was taken.\n13. Costs follow.',
      page: 7,
      judgmentId: 'j2',
    };
    const out = await answerMatterQuestion(
      'q',
      [segment],
      reply([{ statement: 'S', sourceId: 'seg:s2', quote: 'no written consent was taken' }]),
    );
    expect(out.claims.map((c) => [c.kind, c.pinpoint])).toEqual([
      ['seg', { page: 7, paragraph: 12 }],
    ]);
  });

  it('flags a fabricated source id and an altered quote, never verified, left out of the text', async () => {
    const out = await answerMatterQuestion(
      'q',
      sources,
      reply([
        { statement: 'bad id', sourceId: 'seg:invented', quote: 'without informed consent' },
        { statement: 'bad kind', sourceId: 'x:1', quote: 'x' },
        { statement: 'altered', sourceId: 'seg:s1', quote: 'without any informed consent' },
        { statement: 'empty', sourceId: 'seg:s1', quote: '   ' },
        { statement: 'ok', sourceId: 'seg:s1', quote: 'Surgery was done' },
      ]),
    );
    expect(out.unsupported.map((u) => u.reason)).toEqual([
      'unknown_source',
      'unknown_source',
      'quote_not_found',
      'quote_not_found',
    ]);
    expect(out.claims).toHaveLength(1);
    expect(out.answerText).toBe('ok');
    expect(out.noAuthority).toBe(false);
  });

  it('ignores a pinpoint or title the model adds', async () => {
    const out = await answerMatterQuestion(
      'q',
      sources,
      reply([
        {
          statement: 'S',
          sourceId: 'seg:s1',
          quote: 'Surgery was done',
          pinpoint: { page: 99, paragraph: 99 },
          title: 'Invented v State',
        },
      ]),
    );
    expect(out.claims[0]?.pinpoint).toEqual({ page: 7, paragraph: null });
    expect(out.claims[0]).not.toHaveProperty('title');
  });

  it('is noAuthority with no sources (the model is not called) or no claims', async () => {
    let called = false;
    const none = await answerMatterQuestion('q', [], () => {
      called = true;
      return Promise.resolve({ claims: [] });
    });
    expect(none).toMatchObject({ noAuthority: true, claims: [], unsupported: [] });
    expect(called).toBe(false);
    expect((await answerMatterQuestion('q', sources, reply([]))).noAuthority).toBe(true);
  });

  it('throws on a failing model call or a malformed reply', async () => {
    await expect(
      answerMatterQuestion('q', sources, () => Promise.reject(new Error('down'))),
    ).rejects.toThrow('down');
    await expect(
      answerMatterQuestion('q', sources, () => Promise.resolve({ nope: 1 })),
    ).rejects.toThrow('schema');
  });
});

describe('createExtractiveMatterAnswerResolver', () => {
  it('quotes the best-matching sentences, all verified, with server pinpoints', async () => {
    const answer = await answerMatterQuestion(
      'Was notice given to the appellant before the order?',
      sources,
      createExtractiveMatterAnswerResolver(),
    );
    expect(answer.unsupported).toEqual([]);
    expect(answer.claims[0]).toMatchObject({
      sourceId: 'doc:d1:3',
      kind: 'doc',
      pinpoint: { page: 3, paragraph: 12 },
    });
    expect(answer.claims.map((c) => c.sourceId)).not.toContain('seg:s1');
  });

  it('claims nothing when no sentence shares a word with the question', async () => {
    const resolve = createExtractiveMatterAnswerResolver();
    expect(await resolve({ question: 'zebra', sources })).toEqual({ claims: [] });
    const answer = await answerMatterQuestion('zebra', sources, resolve);
    expect(answer.noAuthority).toBe(true);
  });
});
