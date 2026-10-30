// A deterministic BM25 ranker over judgment text: the system under test until the hybrid retriever
// (ADR 0051) lands. It also answers, quoting the best sentence of the top judgment.
import type { Answer, EvalCorpus, EvalQuery, Ranker } from './types.ts';

const STOP = new Set([
  'a',
  'an',
  'and',
  'the',
  'of',
  'to',
  'in',
  'for',
  'on',
  'with',
  'is',
  'was',
  'no',
  'by',
  'at',
]);
const K1 = 1.2;
const B = 0.75;

export const tokenize = (text: string): string[] =>
  (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((t) => !STOP.has(t));

export function bm25Ranker(): Ranker {
  return {
    name: 'bm25',
    rank(query, corpus) {
      const docs = corpus.judgments.map((j) => ({
        id: j.id,
        tokens: tokenize([j.title, ...j.segments.map((s) => s.text)].join(' ')),
      }));
      const avg = docs.reduce((n, d) => n + d.tokens.length, 0) / docs.length;
      const df = new Map<string, number>();
      for (const d of docs) for (const t of new Set(d.tokens)) df.set(t, (df.get(t) ?? 0) + 1);
      const terms = [...new Set(tokenize(query.text))];
      const scored = docs.map((d) => {
        const tf = new Map<string, number>();
        for (const t of d.tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
        let score = 0;
        for (const t of terms) {
          const f = tf.get(t) ?? 0;
          if (f === 0) continue;
          const n = df.get(t) ?? 0;
          const idf = Math.log(1 + (docs.length - n + 0.5) / (n + 0.5));
          score += (idf * f * (K1 + 1)) / (f + K1 * (1 - B + (B * d.tokens.length) / avg));
        }
        return { id: d.id, score };
      });
      // Ties break on id so the ranking is stable across runs.
      scored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
      return scored.map((s) => s.id);
    },
    answer(query: EvalQuery, corpus: EvalCorpus, ranked: string[]): Answer {
      const top = corpus.judgments.find((j) => j.id === ranked[0]);
      if (top === undefined) return { quotes: [] };
      const terms = new Set(tokenize(query.text));
      let best: { segmentId: string; text: string; hits: number } | undefined;
      for (const segment of top.segments) {
        for (const sentence of segment.text.split(/(?<=\.)\s+/)) {
          const hits = tokenize(sentence).filter((t) => terms.has(t)).length;
          if (best === undefined || hits > best.hits) {
            best = { segmentId: segment.id, text: sentence, hits };
          }
        }
      }
      return best === undefined
        ? { quotes: [] }
        : { quotes: [{ judgmentId: top.id, segmentId: best.segmentId, text: best.text }] };
    },
  };
}
