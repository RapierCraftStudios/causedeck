// The model fallback for classification: gateway task `classify_document`. Only the first pages'
// text is sent, and only for documents the rules could not settle and that may use AI at all.
import type { AiGateway, RunContext } from '@causedeck/ai';
import type { DocumentKind } from '@causedeck/db/schema';

export interface LlmClassification {
  kind: DocumentKind;
  confidence: number;
}

export interface LlmClassifier {
  classify(text: string, pageCount: number): Promise<LlmClassification>;
}

/** Characters of text sent to the model. */
export const LLM_TEXT_CHARS = 6000;

interface ClassifyOutput {
  documentType: DocumentKind;
  confidence: number;
}

export function createGatewayClassifier(options: {
  gateway: AiGateway;
  scope: Pick<RunContext, 'workspaceId' | 'captureId' | 'matterId' | 'userId'>;
  pipelineVersion: string;
}): LlmClassifier {
  const { gateway, scope, pipelineVersion } = options;
  return {
    async classify(text, pageCount) {
      const result = await gateway.run<ClassifyOutput>(
        'classify_document',
        { text: text.slice(0, LLM_TEXT_CHARS), pageCount: Math.max(1, pageCount) },
        {
          ...scope,
          purpose: 'capture.classify',
          idempotencyKey: `capture-classify:${scope.captureId ?? 'none'}:${pipelineVersion}`,
        },
      );
      return { kind: result.output.documentType, confidence: result.output.confidence };
    },
  };
}
