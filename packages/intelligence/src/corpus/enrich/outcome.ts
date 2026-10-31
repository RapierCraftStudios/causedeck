// How a judgment ended (#894, ADR 0051 §Enrichment): read from the sentences of the decision segment
// and anchored to the page and sentence it came from. No decision sentence, or one that cannot be
// found on a page, means `unknown`: an outcome is never guessed without an anchor.
export type OutcomeValue =
  'allowed' | 'partly_allowed' | 'dismissed' | 'remanded' | 'disposed' | 'unknown';

export interface OutcomeSegment {
  role: string;
  pageFrom: number;
  pageTo: number;
  text: string;
}

export interface OutcomePage {
  pageNo: number;
  text: string;
}

export interface OutcomeResult {
  outcome: OutcomeValue;
  anchor: { page: number; quote: string } | null;
}

const QUOTE_MAX = 240;
const UNKNOWN: OutcomeResult = { outcome: 'unknown', anchor: null };

const SUBJECT = String.raw`(?:appeals?|petitions?|applications?|writ petitions?|revisions?|suits?|complaints?|claims?|slps?|special leave petitions?|orders?|rule)`;
const PARTLY =
  /\b(?:partly|partially|in part)\b[^.]{0,80}\b(?:allowed|accepted|decreed)\b|\b(?:allowed|accepted|decreed)\b[^.]{0,40}\b(?:in part|partly|partially|to the extent)\b/;
const ALLOWED = new RegExp(
  String.raw`\b${SUBJECT}\b[^.;]{0,80}\b(?:is|are|stands?|be|hereby)\s+(?:hereby\s+)?(?:allowed|accepted|decreed|made absolute)\b`,
);
const DISMISSED = new RegExp(
  String.raw`\b${SUBJECT}\b[^.;]{0,80}\b(?:is|are|stands?|be|hereby)\s+(?:hereby\s+)?(?:dismissed|rejected)\b`,
);
const REMANDED = /\b(?:remanded|remitted|remand the|remit the)\b/;
const DISPOSED = /\b(?:disposed of|stands disposed|are disposed|is disposed)\b/;

/** Higher wins across the decision; among equals the last sentence wins. */
const RANK: Record<Exclude<OutcomeValue, 'unknown'>, number> = {
  partly_allowed: 3,
  allowed: 3,
  dismissed: 3,
  remanded: 2,
  disposed: 1,
};

function classify(sentence: string): Exclude<OutcomeValue, 'unknown'> | null {
  const s = sentence.toLowerCase();
  if (PARTLY.test(s)) return 'partly_allowed';
  const allowed = ALLOWED.test(s);
  const dismissed = DISMISSED.test(s);
  if (allowed && dismissed) return 'partly_allowed';
  if (allowed) return 'allowed';
  if (dismissed) return 'dismissed';
  if (REMANDED.test(s)) return 'remanded';
  if (DISPOSED.test(s)) return 'disposed';
  return null;
}

const squash = (text: string) => text.replace(/\s+/g, ' ').trim();

/** The page in `from..to` whose text holds the start of `sentence`, or null. */
function pageOf(
  sentence: string,
  pages: readonly OutcomePage[],
  from: number,
  to: number,
): number | null {
  const head = squash(sentence).slice(0, 60);
  const page = pages.find(
    (p) => p.pageNo >= from && p.pageNo <= to && squash(p.text).includes(head),
  );
  return page?.pageNo ?? null;
}

/** The outcome of a judgment from its decision segments, with the page and sentence it rests on. */
export function extractOutcome(
  segments: readonly OutcomeSegment[],
  pages: readonly OutcomePage[],
): OutcomeResult {
  let best: { outcome: Exclude<OutcomeValue, 'unknown'>; page: number; quote: string } | null =
    null;
  for (const segment of segments) {
    if (segment.role !== 'decision') continue;
    for (const raw of segment.text.split(/(?<=[A-Za-z)][.;])\s+|\n+/)) {
      const sentence = squash(raw);
      const outcome = classify(sentence);
      if (outcome === null) continue;
      if (best !== null && RANK[outcome] < RANK[best.outcome]) continue;
      const page = pageOf(sentence, pages, segment.pageFrom, segment.pageTo);
      if (page === null) continue;
      best = { outcome, page, quote: sentence.slice(0, QUOTE_MAX) };
    }
  }
  return best === null
    ? UNKNOWN
    : { outcome: best.outcome, anchor: { page: best.page, quote: best.quote } };
}
