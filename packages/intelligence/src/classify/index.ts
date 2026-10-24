// Classification: rules first, the model only when the best rule scores below 0.8 and AI is
// allowed (never for a sensitive matter or an `ai_blocked` capture).
import { AiGatewayError } from '@causedeck/ai';
import type { DocumentKind } from '@causedeck/db/schema';

import type { LlmClassifier } from './llm.ts';
import { classifyByRules, RULE_CONFIDENT } from './rules.ts';

export { createGatewayClassifier, type LlmClassifier } from './llm.ts';
export { classifyByRules, RULE_CONFIDENT, scoreRules } from './rules.ts';

export interface Classification {
  kind: DocumentKind;
  confidence: number;
  source: 'rules' | 'llm';
  /** Whether the model was asked (a failed call still counts). */
  llmCalled: boolean;
}

export interface ClassifyOptions {
  /** The model fallback; `null` when AI may not run for this capture. */
  llm: LlmClassifier | null;
  pageCount: number;
}

export async function classifyDocument(
  text: string,
  options: ClassifyOptions,
): Promise<Classification> {
  const rule = classifyByRules(text);
  const base: Classification = {
    kind: rule.kind,
    confidence: rule.score,
    source: 'rules',
    llmCalled: false,
  };
  if (rule.score >= RULE_CONFIDENT || options.llm === null || text.trim() === '') return base;
  try {
    const answer = await options.llm.classify(text, options.pageCount);
    if (answer.confidence > rule.score) {
      return { ...answer, source: 'llm', llmCalled: true };
    }
    return { ...base, llmCalled: true };
  } catch (error) {
    // Budget, residency, sensitivity or provider trouble: keep the rule's answer, text-layer path
    // still completes. Anything else is a bug and surfaces.
    if (error instanceof AiGatewayError) return { ...base, llmCalled: true };
    throw error;
  }
}
