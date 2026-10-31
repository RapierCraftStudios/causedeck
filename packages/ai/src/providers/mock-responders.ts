// Deterministic mock answers for the research tasks (#896), so a fact-pattern search works end to end
// on the mock provider (dev, CI, staging) instead of returning the empty synthetic value. A fixture
// file for the same input still wins (see `mock.ts`). Both are pure functions of the input.
import type { TaskDef } from '../types.ts';

const STOP = new Set([
  'the',
  'and',
  'for',
  'with',
  'was',
  'were',
  'that',
  'this',
  'from',
  'had',
  'not',
  'but',
  'are',
  'his',
  'her',
  'case',
]);

const wordsOf = (text: string): string[] => text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

function plan(input: { query: string }): unknown {
  const keywords = [...new Set(wordsOf(input.query).filter((w) => w.length > 3 && !STOP.has(w)))];
  return {
    // The caller keeps the advocate's own words when this is too short to add anything.
    factDescription: input.query.slice(0, 1500),
    keywords: keywords.slice(0, 16),
    subjectAreas: [],
    statutes: [],
    courts: [],
    courtLevel: null,
    dateFrom: null,
    dateTo: null,
    outcome: null,
    offenceDate: null,
  };
}

/** The sentence of each of the first passages that shares the most words with the question. */
function answer(input: { query: string; segments: { id: string; text: string }[] }): unknown {
  const terms = new Set(wordsOf(input.query).filter((w) => w.length > 3 && !STOP.has(w)));
  const claims: { statement: string; segmentId: string; quote: string }[] = [];
  for (const segment of input.segments.slice(0, 3)) {
    let best: { sentence: string; hits: number } | undefined;
    for (const sentence of segment.text.split(/(?<=[.!?])\s+/)) {
      const hits = wordsOf(sentence).filter((w) => terms.has(w)).length;
      if (hits > 0 && (best === undefined || hits > best.hits)) best = { sentence, hits };
    }
    if (best !== undefined) {
      const quote = best.sentence.trim().slice(0, 500);
      claims.push({ statement: quote, segmentId: segment.id, quote });
    }
  }
  return { claims };
}

/** A deterministic reply for `task`, or undefined when the mock has none (it then synthesises). */
export function mockResponse(task: TaskDef, input: unknown): unknown {
  if (task.id !== 'plan_research_query' && task.id !== 'answer_research_query') return undefined;
  const parsed = task.input.safeParse(input);
  if (!parsed.success) return undefined;
  return task.id === 'plan_research_query'
    ? plan(parsed.data as { query: string })
    : answer(parsed.data as { query: string; segments: { id: string; text: string }[] });
}
