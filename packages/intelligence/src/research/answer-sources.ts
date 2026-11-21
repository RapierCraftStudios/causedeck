// The verified answer over mixed sources (#1115, ADR 0051, D-004). The copilot model gets the question
// and numbered sources of three kinds (`fact:` a matter-graph fact, `doc:` a page of a matter
// document, `seg:` a passage of an anonymised judgment) and returns claims that each name one source
// id and quote it. Every claim is checked here against the text this module was given: the id must be
// one the model was shown, the quote must occur in that text (whitespace and case normalised), and the
// pinpoint (page, and the court's paragraph number when the text carries one) is computed from the
// stored text, never read from the model. A claim failing a check is returned in `unsupported`, never
// shown as verified and left out of `answerText`. No sources, or no claims, is `noAuthority`; a model
// failure or a reply that does not match the schema throws, so the caller reports an error and no
// answer is invented.
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
  /** The verified statements only. */
  answerText: string;
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

const replySchema = z.object({
  claims: z.array(z.object({ statement: z.string(), sourceId: z.string(), quote: z.string() })),
});

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
    return { claims: [], unsupported: [], answerText: '', noAuthority: true };
  }
  const reply = replySchema.safeParse(
    await resolve({ question, sources: sources.map((s) => ({ id: s.id, text: s.text })) }),
  );
  if (!reply.success) throw new Error('copilot answer: the model reply did not match its schema');

  const byId = new Map(sources.map((s) => [s.id, s]));
  const claims: VerifiedClaim[] = [];
  const unsupported: UnsupportedClaim[] = [];
  for (const c of reply.data.claims) {
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
    }
  }
  return {
    claims,
    unsupported,
    answerText: claims.map((c) => c.statement).join(' '),
    noAuthority: claims.length === 0 && unsupported.length === 0,
  };
}
