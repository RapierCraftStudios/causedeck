// The low-confidence step (#892, D-053): capitalised name-like spans the rules neither attributed to
// a person nor kept go to the AI gateway, which answers per span. The reply is schema-validated; an
// invalid or missing reply keeps the span as it is (the redactor never guesses) and the span count is
// reported so data ops can see the backlog. The resolver is a port: this package imports no gateway.
import { z } from 'zod';

import { isInstitution, trimName } from './names.ts';
import { redactJudgment, type RedactInput, type RedactionResult } from './redact.ts';

export interface LowConfidenceSpan {
  text: string;
  /** The sentence the span is in, for the model. */
  context: string;
}

export const resolverReplySchema = z.object({
  spans: z.array(z.object({ text: z.string().min(1), isPerson: z.boolean() })).max(200),
});
export type ResolverReply = z.infer<typeof resolverReplySchema>;

/** Answers whether each span is the name of a natural person. */
export interface LowConfidenceResolver {
  resolve(spans: readonly LowConfidenceSpan[]): Promise<unknown>;
}

const SPAN = /(?<![\p{L}\p{N}'’])[A-Z][a-z]{2,}(?:[ \t]+[A-Z][a-z]{2,}){1,2}(?![\p{L}\p{N}])/gu;
const MAX_SPANS = 50;

/** Name-like spans in `texts` that `redacted` still shows and that look like neither a body nor a statute. */
export function findLowConfidenceSpans(
  redacted: readonly string[],
  keep: readonly string[],
): LowConfidenceSpan[] {
  const seen = new Map<string, LowConfidenceSpan>();
  const keepLower = keep.map((k) => k.toLowerCase());
  for (const text of redacted) {
    for (const m of text.matchAll(SPAN)) {
      const span = m[0];
      if (seen.has(span) || trimName(span) !== span || isInstitution(span)) continue;
      if (keepLower.some((k) => k.includes(span.toLowerCase()))) continue;
      if (/\b(?:Act|Code|Section|Article|Rules?|Court|Sanhita)\b/.test(span)) continue;
      const at = m.index;
      seen.set(span, {
        text: span,
        context: text.slice(Math.max(0, at - 80), at + span.length + 80),
      });
      if (seen.size >= MAX_SPANS) return [...seen.values()];
    }
  }
  return [...seen.values()];
}

/** `redactJudgment`, then ask the resolver about what is left; confirmed persons are redacted too. */
export async function redactWithResolver(
  input: RedactInput,
  resolver: LowConfidenceResolver | undefined,
): Promise<RedactionResult & { lowConfidence: number }> {
  const first = redactJudgment(input);
  if (resolver === undefined) return { ...first, lowConfidence: 0 };
  const spans = findLowConfidenceSpans(
    first.pages.map((p) => p.text),
    input.bench ?? [],
  );
  if (spans.length === 0) return { ...first, lowConfidence: 0 };
  let reply: ResolverReply | null = null;
  try {
    const parsed = resolverReplySchema.safeParse(await resolver.resolve(spans));
    reply = parsed.success ? parsed.data : null;
  } catch {
    reply = null;
  }
  if (reply === null) return { ...first, lowConfidence: spans.length };
  const asked = new Set(spans.map((s) => s.text));
  const persons = reply.spans.filter((s) => s.isPerson && asked.has(s.text)).map((s) => s.text);
  if (persons.length === 0) return { ...first, lowConfidence: 0 };
  const second = redactJudgment({ ...input, resolved: [...(input.resolved ?? []), ...persons] });
  return { ...second, lowConfidence: 0 };
}
