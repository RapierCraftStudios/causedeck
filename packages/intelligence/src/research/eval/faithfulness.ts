// Answer faithfulness: every quote must match the cited segment's text, and every cited id must
// exist in the corpus.
import type { Answer, EvalCorpus } from './types.ts';

const normalise = (s: string): string => s.replace(/\s+/g, ' ').trim().toLowerCase();

export interface Faithfulness {
  quotes: number;
  quotesMatching: number;
  citations: number;
  citationsExisting: number;
}

export function checkAnswer(answer: Answer, corpus: EvalCorpus): Faithfulness {
  const segments = new Map<string, { judgmentId: string; text: string }>();
  for (const j of corpus.judgments) {
    for (const s of j.segments) segments.set(s.id, { judgmentId: j.id, text: s.text });
  }
  const result: Faithfulness = { quotes: 0, quotesMatching: 0, citations: 0, citationsExisting: 0 };
  for (const q of answer.quotes) {
    const segment = segments.get(q.segmentId);
    // A citation is two ids: the judgment, and a segment that belongs to that judgment.
    result.citations += 1;
    if (segment !== undefined && segment.judgmentId === q.judgmentId) result.citationsExisting += 1;
    result.quotes += 1;
    const needle = normalise(q.text);
    if (segment !== undefined && needle.length > 0 && normalise(segment.text).includes(needle)) {
      result.quotesMatching += 1;
    }
  }
  return result;
}
