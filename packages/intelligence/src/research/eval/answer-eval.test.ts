// #1119: the answer metrics of the copilot quality gate, on the committed cases and on hand-built ones.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { loadAnswers, runAnswerEval, type AnswerCase } from './answer-eval.ts';
import { loadPinnedSet } from './runner.ts';

const FIXTURES = fileURLToPath(new URL('../../../../../fixtures/research-eval', import.meta.url));
const set = loadPinnedSet(FIXTURES);

const research = (
  id: string,
  queryId: string,
  claim: { segmentId: string; quote: string; pinpoint?: unknown },
  expected: AnswerCase['expect'][number],
): AnswerCase => ({
  id,
  queryId,
  task: 'answer_research_query',
  replies: { claims: [{ statement: id, ...claim }] },
  expect: [expected],
});

const doc = {
  id: 'doc:D9:7',
  text: '1. The notice was posted on 2 May.\n2. It was returned unclaimed on 9 May.',
  page: 7,
  documentId: 'D9',
};
const matter = (
  id: string,
  claim: { sourceId: string; quote: string; pinpoint?: unknown },
  expected: AnswerCase['expect'][number],
): AnswerCase => ({
  id,
  queryId: 'Q01',
  task: 'answer_matter_question',
  sources: [doc],
  replies: { claims: [{ statement: id, ...claim }] },
  expect: [expected],
});

describe('committed answer cases', () => {
  it('verify every good claim, reject every adversarial one and never false-verify', async () => {
    const cases = loadAnswers(FIXTURES) ?? [];
    expect(cases.length).toBeGreaterThanOrEqual(12);
    const tasks = new Set(cases.map((c) => c.task));
    expect(tasks).toEqual(new Set(['answer_research_query', 'answer_matter_question']));
    const metrics = await runAnswerEval(cases, set);
    expect(metrics.mismatches).toEqual([]);
    expect(metrics).toMatchObject({
      falseVerified: 0,
      citationAccuracy: 1,
      quoteVerificationRate: 1,
      pinpointAccuracy: 1,
    });
    // The adversarial cases are really there: some claims are expected to fail.
    expect(cases.flatMap((c) => c.expect).filter((e) => !e.verified).length).toBeGreaterThanOrEqual(8);
  });

  it('returns null for a set without answers.json', () => {
    expect(loadAnswers(mkdtempSync(path.join(tmpdir(), 'answers-')))).toBeNull();
  });
});

describe('answer verdicts', () => {
  it('rejects an altered quote and a foreign segment in /research answers', async () => {
    const metrics = await runAnswerEval(
      [
        research('altered', 'Q01', { segmentId: 'J01-p1', quote: 'Written consent was obtained' }, { verified: false }),
        research('foreign', 'Q01', { segmentId: 'J06-p1', quote: 'A cheque of Rs 5 lakh was dishonoured' }, { verified: false }),
      ],
      set,
    );
    expect(metrics).toMatchObject({ falseVerified: 0, mismatches: [] });
  });

  it('counts a claim expected unsupported but shown verified as false-verified', async () => {
    const metrics = await runAnswerEval(
      [research('wrong-expectation', 'Q01', { segmentId: 'J01-p1', quote: 'No written consent' }, { verified: false })],
      set,
    );
    expect(metrics.falseVerified).toBe(1);
    expect(metrics.mismatches).toEqual([
      { caseId: 'wrong-expectation', claimIndex: 0, expected: 'verified false', actual: 'verified true' },
    ]);
  });

  it('tells an unknown fact id from a quote not found in the copilot verifier', async () => {
    const metrics = await runAnswerEval(
      [
        matter('unknown', { sourceId: 'fact:nothing', quote: 'x' }, { verified: false, reason: 'unknown_source' }),
        matter('altered', { sourceId: doc.id, quote: 'posted on 3 May' }, { verified: false, reason: 'quote_not_found' }),
        matter('mislabelled', { sourceId: doc.id, quote: 'posted on 3 May' }, { verified: false, reason: 'unknown_source' }),
      ],
      set,
    );
    expect(metrics.mismatches).toEqual([
      { caseId: 'mislabelled', claimIndex: 0, expected: 'reason unknown_source', actual: 'reason quote_not_found' },
    ]);
  });

  it('ignores a model-claimed pinpoint and scores the computed one', async () => {
    const claim = { sourceId: doc.id, quote: 'returned unclaimed', pinpoint: { page: 1, paragraph: 1 } };
    const right = await runAnswerEval(
      [matter('right', claim, { verified: true, pinpoint: { page: 7, paragraph: 2 } })],
      set,
    );
    expect(right).toMatchObject({ pinpointAccuracy: 1, mismatches: [] });
    const wrong = await runAnswerEval(
      [matter('wrong', claim, { verified: true, pinpoint: { page: 1, paragraph: 1 } })],
      set,
    );
    expect(wrong.pinpointAccuracy).toBe(0);
    expect(wrong.mismatches[0]?.actual).toBe('pinpoint page 7, paragraph 2');
  });

  it('computes each rate over its own denominator', async () => {
    const metrics = await runAnswerEval(
      [
        research('good', 'Q04', { segmentId: 'J04-p1', quote: 'Section 37 bars bail' }, { verified: true, pinpoint: { page: 1, paragraph: null } }),
        research('good-wrong-pin', 'Q04', { segmentId: 'J04-p2', quote: 'reasonable grounds' }, { verified: true, pinpoint: { page: 1, paragraph: null } }),
        research('missed', 'Q04', { segmentId: 'J04-p1', quote: 'bail is always granted' }, { verified: true }),
        research('bad', 'Q04', { segmentId: 'J04-p1', quote: 'never' }, { verified: false }),
      ],
      set,
    );
    expect(metrics).toMatchObject({
      cases: 4,
      claims: 4,
      citationAccuracy: 1,
      quoteVerificationRate: 2 / 3,
      pinpointAccuracy: 1 / 2,
      falseVerified: 0,
    });
  });

  it('refuses a case naming an unknown query', async () => {
    await expect(
      runAnswerEval([research('x', 'Q99', { segmentId: 'J01-p1', quote: 'x' }, { verified: false })], set),
    ).rejects.toThrow(/unknown query Q99/);
  });
});
