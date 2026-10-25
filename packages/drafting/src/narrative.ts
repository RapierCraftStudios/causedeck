// Narrative blocks are drafted by the ai gateway through an injected port. The model returns text
// only (the task defines no tools), the output is schema-validated and capped at the block's
// maxChars, and calls are India-only unless the caller explicitly overrides it.
import { getTask, type RunContext } from '@causedeck/ai';

import type { NarrativeBlock } from './blocks';
import { factsForPrompt, type Facts } from './slots';
import type { NarrativeText } from './render/common';

export type NarrativeContext = RunContext & {
  /** Restrict processing to India regions; default true. */
  indiaOnly?: boolean;
};

/** The slice of AiGateway the drafting engine needs; pass `createGateway(...)` or a fake. */
export interface NarrativePort {
  run(taskId: string, input: unknown, ctx: NarrativeContext): Promise<{ output: unknown }>;
}

export class NarrativeOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NarrativeOutputError';
  }
}

export async function draftNarrative(
  port: NarrativePort,
  block: NarrativeBlock,
  facts: Facts,
  ctx: NarrativeContext,
  locale: 'en' | 'kn' | 'ta' = 'en',
): Promise<NarrativeText> {
  const task = getTask('draft_narrative');
  const input = {
    prompt: block.prompt,
    facts: factsForPrompt(facts),
    maxChars: block.maxChars,
    locale,
  };
  const result = await port.run('draft_narrative', input, {
    ...ctx,
    indiaOnly: ctx.indiaOnly ?? true,
  });
  const parsed = task.output.safeParse(result.output);
  if (!parsed.success) throw new NarrativeOutputError('draft_narrative output failed validation');
  const { text } = parsed.data as { text: string };
  if (text.trim() === '') throw new NarrativeOutputError('draft_narrative returned no text');
  if (text.length > block.maxChars) {
    throw new NarrativeOutputError(`draft_narrative text exceeds ${String(block.maxChars)} chars`);
  }
  return { text, modelDrafted: true, rewritten: false };
}
