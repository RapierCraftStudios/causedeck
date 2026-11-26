// The verified answer over mixed sources (#1115, ADR 0051, D-004). The copilot model gets the question
// and numbered sources of three kinds (`fact:` a matter-graph fact, `doc:` a page of a matter
// document, `seg:` a passage of an anonymised judgment) and returns claims that each name one source
// id and quote it. Every claim is checked here against the text this module was given: the id must be
// one the model was shown, the quote must occur in that text (whitespace and case normalised), and the
// pinpoint (page, and the court's paragraph number when the text carries one) is computed from the
// stored text, never read from the model. A claim failing a check is returned in `unsupported`, never
// shown as verified and left out of `answerText`. No sources, or no claims, is `noAuthority`; a model
// failure or a reply that does not match the schema throws, so the caller reports an error and no
// answer is invented. The written `answer` (#1167) cites claims by `[n]` markers, 1-based into the
// model's claim order: only markers of verified claims are kept, renumbered to the verified claims'
// order, so a marker with no verified claim is never shown. A reply without a usable marker gets an
// answer composed from the verified statements; no verified claim is an empty answer.
import type { AiGateway, RunContext } from '@causedeck/ai';
import { z } from 'zod';

import { splitParagraphs } from '../corpus/index.ts';

export type SourceKind = 'fact' | 'doc' | 'seg';

/** What the caller knows of a source besides its text: where it lives, for links and pinpoints. */
export interface CopilotSource {
  /** `fact:<key>`, `doc:<documentId>:<page>` or `seg:<segmentId>`. */
  id: string;
  /** The stored text shown to the model; quotes are verified against exactly this string. */
  text: string;
  /** The page of the source; null for a fact. */
  page: number | null;
  /** The document of a `doc:` source, the judgment of a `seg:` source. */
  documentId?: string;
  judgmentId?: string;
}

export interface Pinpoint {
  page: number | null;
  /** The paragraph number as the text prints it; null when the text carries none. */
  paragraph: number | null;
}

export interface VerifiedClaim {
  statement: string;
  sourceId: string;
  kind: SourceKind;
  quote: string;
  pinpoint: Pinpoint;
  documentId: string | null;
  judgmentId: string | null;
}

export interface UnsupportedClaim {
  statement: string;
  sourceId: string;
  quote: string;
  reason: 'unknown_source' | 'quote_not_found';
}

export interface MatterAnswer {
  claims: VerifiedClaim[];
  unsupported: UnsupportedClaim[];
  /** The verified statements only (hashed for audit, scored by the eval). */
  answerText: string;
  /**
   * The written answer with `[n]` markers, n 1-based into `claims` (verified claims only); '' when no
   * claim verified.
   */
  answer: string;
  /**
   * One sentence leading with the answer ("Yes, if…"), `[n]` markers renumbered like `answer`. Held to
   * D-004 like a claim: '' unless at least one of its markers points at a verified claim (#1192).
   */
  bottomLine: string;
  /** No sources, or nothing to claim: "no authority found". */
  noAuthority: boolean;
}

export interface MatterAnswerInput {
  question: string;
  sources: { id: string; text: string }[];
}

export type MatterAnswerResolver = (input: MatterAnswerInput) => Promise<unknown>;

export function createGatewayMatterAnswerResolver(options: {
  gateway: AiGateway;
  scope: Pick<RunContext, 'workspaceId'> & Partial<Pick<RunContext, 'matterId' | 'userId' | 'idempotencyKey'>>;
}): MatterAnswerResolver {
  return async (input) => {
    const result = await options.gateway.run('answer_matter_question', input, {
      ...options.scope,
      purpose: 'copilot.answer',
    });
    return result.output;
  };
}

/** The task caps a reply at 12 claims. */
const MAX_CLAIMS = 12;

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'was', 'were', 'that', 'this', 'from', 'had', 'not', 'but', 'are',
  'his', 'her', 'case',
]);
const wordsOf = (text: string): string[] => text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

/**
 * A question about the matter's own calendar and work (next date, hearing, what to prepare, what is
 * pending or due, the stage, obligations). The mock `answer_matter_question` responder uses the same
 * pattern.
 */
const MATTER_INTENT =
  /\b(?:next\s+dates?|hearings?|prepare|preparation|obligations?|pending|stages?|due)\b/i;

/** The matter facts a matter-intent question is answered from, in the order they are claimed. */
const intentRank = (id: string): number => {
  if (id === 'fact:next_date') return 0;
  if (id === 'fact:stage') return 1;
  if (id === 'fact:obligations') return 2;
  return id.startsWith('fact:obligation:') ? 3 : -1;
};

/** The deterministic written answer of the extractive resolvers: each statement with its marker. */
const composeAnswer = (statements: readonly string[]): string =>
  statements.map((s, i) => `${s} [${String(i + 1)}]`).join(' ');

/**
 * A deterministic resolver that calls no model: for the sources sharing the most words with the
 * question, the best-matching sentence of each, quoted as is (the algorithm of the mock `answer_matter_question`
 * responder in `@causedeck/ai`). A matter-intent question (`MATTER_INTENT`) claims the next-date,
 * stage and obligation facts first, each quoted whole. The written answer is the claims' statements
 * with their markers. Used where no AI call may be made (a demo workspace, #93); its claims still go
 * through `answerMatterQuestion`, so nothing is shown unverified.
 */
export function createExtractiveMatterAnswerResolver(maxSources = 3): MatterAnswerResolver {
  return (input) => {
    const facts = MATTER_INTENT.test(input.question)
      ? input.sources
          .filter((s) => intentRank(s.id) >= 0 && s.text.trim() !== '')
          .sort((a, b) => intentRank(a.id) - intentRank(b.id))
          .map((s) => {
            const quote = s.text.trim().slice(0, 500);
            return { statement: quote, sourceId: s.id, quote };
          })
      : [];
    const claimed = new Set(facts.map((f) => f.sourceId));
    const terms = new Set(
      wordsOf(input.question).filter((w) => w.length > 3 && !STOP_WORDS.has(w)),
    );
    const picks: { sourceId: string; sentence: string; hits: number }[] = [];
    for (const source of input.sources) {
      if (claimed.has(source.id)) continue;
      let best: { sentence: string; hits: number } | undefined;
      for (const sentence of source.text.split(/(?<=[.!?])\s+/)) {
        const hits = wordsOf(sentence).filter((w) => terms.has(w)).length;
        if (hits > 0 && (best === undefined || hits > best.hits)) best = { sentence, hits };
      }
      if (best !== undefined) picks.push({ sourceId: source.id, ...best });
    }
    // The best-overlapping sources first; ties keep the order the sources were given in.
    const matched = picks
      .sort((a, b) => b.hits - a.hits)
      .slice(0, maxSources)
      .map((p) => {
        const quote = p.sentence.trim().slice(0, 500);
        return { statement: quote, sourceId: p.sourceId, quote };
      });
    const claims = [...facts, ...matched].slice(0, MAX_CLAIMS);
    if (claims.length === 0) return Promise.resolve({ claims });
    return Promise.resolve({ claims, answer: composeAnswer(claims.map((c) => c.statement)) });
  };
}

const replySchema = z.object({
  claims: z.array(z.object({ statement: z.string(), sourceId: z.string(), quote: z.string() })),
  answer: z.string().optional(),
  bottomLine: z.string().optional(),
});

const MARKER = /\[\s*(\d+(?:\s*,\s*\d+)*)\s*\]/g;

/**
 * `answer` with every marker rewritten through `renumber` (a model claim position, 1-based, to its
 * verified position, or undefined): a marker keeps only its verified positions and disappears when
 * none is left. Spacing left by a dropped marker is tidied. Null when no marker survives.
 */
function rewriteMarkers(
  answer: string,
  renumber: (n: number) => number | undefined,
): string | null {
  let kept = 0;
  const text = answer.replace(MARKER, (_m, list: string) => {
    const ns = [
      ...new Set(
        list
          .split(',')
          .map((n) => renumber(Number(n.trim())))
          .filter((n): n is number => n !== undefined),
      ),
    ];
    kept += ns.length;
    return ns.length === 0 ? '' : `[${ns.join(', ')}]`;
  });
  if (kept === 0) return null;
  return text
    .replace(/[ \t]+([.,;:!?])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ +\n/g, '\n')
    .trim();
}

const normalise = (s: string): string => s.replace(/\s+/g, ' ').trim().toLowerCase();

export function sourceKind(id: string): SourceKind | null {
  const prefix = id.slice(0, id.indexOf(':'));
  return prefix === 'fact' || prefix === 'doc' || prefix === 'seg' ? prefix : null;
}

/** The page of `source` and the paragraph of its text that holds `quote`, from the stored text only. */
export function pinpointOf(source: CopilotSource, quote: string): Pinpoint {
  const needle = normalise(quote);
  const holder = splitParagraphs(source.text).find((p) => normalise(p.text).includes(needle));
  return { page: source.page, paragraph: holder?.number ?? null };
}

export async function answerMatterQuestion(
  question: string,
  sources: readonly CopilotSource[],
  resolve: MatterAnswerResolver,
): Promise<MatterAnswer> {
  if (sources.length === 0) {
    return {
      claims: [],
      unsupported: [],
      answerText: '',
      answer: '',
      bottomLine: '',
      noAuthority: true,
    };
  }
  const reply = replySchema.safeParse(
    await resolve({ question, sources: sources.map((s) => ({ id: s.id, text: s.text })) }),
  );
  if (!reply.success) throw new Error('copilot answer: the model reply did not match its schema');

  const byId = new Map(sources.map((s) => [s.id, s]));
  const claims: VerifiedClaim[] = [];
  const unsupported: UnsupportedClaim[] = [];
  // The model's claim position (1-based) to the verified claim's position (1-based).
  const verifiedAt = new Map<number, number>();
  for (const [index, c] of reply.data.claims.entries()) {
    const source = byId.get(c.sourceId);
    const kind = sourceKind(c.sourceId);
    const needle = normalise(c.quote);
    if (source === undefined || kind === null) {
      unsupported.push({ ...c, reason: 'unknown_source' });
    } else if (needle === '' || !normalise(source.text).includes(needle)) {
      unsupported.push({ ...c, reason: 'quote_not_found' });
    } else {
      claims.push({
        statement: c.statement,
        sourceId: c.sourceId,
        kind,
        quote: c.quote,
        pinpoint: pinpointOf(source, c.quote),
        documentId: source.documentId ?? null,
        judgmentId: source.judgmentId ?? null,
      });
      verifiedAt.set(index + 1, claims.length);
    }
  }
  const written =
    claims.length === 0 || reply.data.answer === undefined
      ? null
      : rewriteMarkers(reply.data.answer, (n) => verifiedAt.get(n));
  // The bottom line is a claim too (D-004): it survives only with a marker of a verified claim.
  const bottomLine =
    claims.length === 0 || reply.data.bottomLine === undefined
      ? null
      : rewriteMarkers(reply.data.bottomLine, (n) => verifiedAt.get(n));
  return {
    claims,
    unsupported,
    answerText: claims.map((c) => c.statement).join(' '),
    answer:
      claims.length === 0 ? '' : (written ?? composeAnswer(claims.map((c) => c.statement))),
    bottomLine: bottomLine ?? '',
    noAuthority: claims.length === 0 && unsupported.length === 0,
  };
}
