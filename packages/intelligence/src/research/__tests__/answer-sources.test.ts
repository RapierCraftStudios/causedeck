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

describe('answerMatterQuestion: the written answer (#1167)', () => {
  const written = (answer: string | undefined, claims: unknown[]) => () =>
    Promise.resolve(answer === undefined ? { claims } : { claims, answer });
  const ok = (statement: string) => ({ statement, sourceId: 'seg:s1', quote: 'Surgery was done' });
  const bad = (statement: string) => ({
    statement,
    sourceId: 'seg:s1',
    quote: 'surgery was never done',
  });

  it('drops the marker of an unverified claim and renumbers the rest to the verified order', async () => {
    const out = await answerMatterQuestion(
      'q',
      sources,
      written('Surgery happened [1]. Consent was taken [2]. Notice was missing [3].', [
        ok('A'),
        bad('B'),
        { statement: 'C', sourceId: 'doc:d1:3', quote: 'not given notice' },
      ]),
    );
    expect(out.claims.map((c) => c.statement)).toEqual(['A', 'C']);
    expect(out.answer).toBe('Surgery happened [1]. Consent was taken. Notice was missing [2].');
    expect(out.answerText).toBe('A C');
  });

  it('never shows an out-of-range, zero or orphan marker, and keeps verified ones of a list', async () => {
    const out = await answerMatterQuestion(
      'q',
      sources,
      written('One [1, 2, 9]. Two [0]. Three [7] , four [2,1].', [ok('A'), bad('B')]),
    );
    expect(out.answer).toBe('One [1]. Two. Three, four [1].');
    expect(out.answer).not.toMatch(/\[(?:0|2|7|9)\]/);
  });

  it('renumbers a comma list and removes duplicates', async () => {
    const out = await answerMatterQuestion(
      'q',
      sources,
      written('Both [2, 3] and again [3,3].', [bad('A'), ok('B'), ok('C')]),
    );
    expect(out.answer).toBe('Both [1, 2] and again [2].');
  });

  it('composes the answer from the verified statements when none is given or no marker survives', async () => {
    const none = await answerMatterQuestion('q', sources, written(undefined, [ok('A'), bad('B')]));
    expect(none.answer).toBe('A [1]');
    const orphaned = await answerMatterQuestion(
      'q',
      sources,
      written('Only [2] is cited.', [ok('A'), bad('B')]),
    );
    expect(orphaned.answer).toBe('A [1]');
    const blank = await answerMatterQuestion('q', sources, written('   ', [ok('A'), ok('B')]));
    expect(blank.answer).toBe('A [1] B [2]');
  });

  it('is an empty answer when no claim verified, whatever the model wrote', async () => {
    const out = await answerMatterQuestion(
      'q',
      sources,
      written('Consent was taken [1].', [bad('B')]),
    );
    expect(out.claims).toEqual([]);
    expect(out.answer).toBe('');
    expect(out.answerText).toBe('');
    const empty = await answerMatterQuestion('q', sources, written('Nothing [1].', []));
    expect(empty).toMatchObject({ noAuthority: true, answer: '' });
    expect((await answerMatterQuestion('q', [], written('x', []))).answer).toBe('');
  });
});

describe('answerMatterQuestion: the bottom line (#1192, D-004)', () => {
  const ok = (statement: string) => ({ statement, sourceId: 'seg:s1', quote: 'Surgery was done' });
  const bad = (statement: string) => ({
    statement,
    sourceId: 'seg:s1',
    quote: 'surgery was never done',
  });
  const led = (bottomLine: string | undefined, claims: unknown[]) => () =>
    Promise.resolve({
      claims,
      answer: 'Details [1].',
      ...(bottomLine === undefined ? {} : { bottomLine }),
    });

  it('keeps a bottom line citing a verified claim, renumbered to the verified order', async () => {
    const out = await answerMatterQuestion(
      'q',
      sources,
      led('Yes, if consent was not taken [1, 2].', [bad('A'), ok('B')]),
    );
    expect(out.bottomLine).toBe('Yes, if consent was not taken [1].');
    expect(out.answerText).toBe('B');
  });

  it('drops a bottom line whose markers are all unverified or that cites nothing', async () => {
    const unverified = await answerMatterQuestion(
      'q',
      sources,
      led('No, unless notice was given [1].', [bad('A'), ok('B')]),
    );
    expect(unverified.bottomLine).toBe('');
    const uncited = await answerMatterQuestion('q', sources, led('Yes, plainly.', [ok('A')]));
    expect(uncited.bottomLine).toBe('');
    const absent = await answerMatterQuestion('q', sources, led(undefined, [ok('A')]));
    expect(absent.bottomLine).toBe('');
    expect(absent.answer).toBe('Details [1].');
  });

  it('is empty when no claim verified or there are no sources', async () => {
    const none = await answerMatterQuestion('q', sources, led('Yes [1].', [bad('A')]));
    expect(none).toMatchObject({ claims: [], bottomLine: '', answer: '' });
    expect((await answerMatterQuestion('q', [], led('Yes [1].', []))).bottomLine).toBe('');
  });
});

describe('createExtractiveMatterAnswerResolver', () => {
  const matterFacts: CopilotSource[] = [
    { id: 'fact:matter', text: 'Matter: Rao v State. Status: open.', page: null },
    { id: 'fact:obligation:o1', text: 'Open obligation (overdue, 2026-10-20): File the counter.', page: null },
    { id: 'fact:obligations', text: 'Open obligations: 1.', page: null },
    { id: 'fact:stage', text: 'Stage: Arguments.', page: null },
    { id: 'fact:next_date', text: 'Next date: 2026-11-10. Stage: Arguments.', page: null },
    ...sources.slice(1),
  ];

  it('answers a next-date question from the date, stage and obligation facts first, with markers', async () => {
    const answer = await answerMatterQuestion(
      'What is the next date and what should I prepare?',
      matterFacts,
      createExtractiveMatterAnswerResolver(),
    );
    expect(answer.unsupported).toEqual([]);
    expect(answer.claims.map((c) => c.sourceId)).toEqual([
      'fact:next_date',
      'fact:stage',
      'fact:obligations',
      'fact:obligation:o1',
    ]);
    expect(answer.answer).toBe(
      'Next date: 2026-11-10. Stage: Arguments. [1] Stage: Arguments. [2] Open obligations: 1. [3] ' +
        'Open obligation (overdue, 2026-10-20): File the counter. [4]',
    );
  });

  it('does not treat a question without matter intent as one (negative examples)', async () => {
    for (const question of [
      'Was notice given to the appellant before the order?',
      'Is the dueling clause valid?',
      'What did the staged accident show?',
      'Preparedness of the hospital',
    ]) {
      const answer = await answerMatterQuestion(
        question,
        matterFacts,
        createExtractiveMatterAnswerResolver(),
      );
      expect(answer.claims.map((c) => c.sourceId).filter((id) => id !== 'fact:matter')).not.toContain(
        'fact:next_date',
      );
    }
  });

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
    expect(answer.answer).toMatch(/^The appellant was not given notice before the order\. \[1\]/);
  });

  it('claims nothing when no sentence shares a word with the question', async () => {
    const resolve = createExtractiveMatterAnswerResolver();
    expect(await resolve({ question: 'zebra', sources })).toEqual({ claims: [] });
    const answer = await answerMatterQuestion('zebra', sources, resolve);
    expect(answer.noAuthority).toBe(true);
  });
});
