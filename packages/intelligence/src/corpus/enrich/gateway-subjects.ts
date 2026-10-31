// The gateway-backed subject resolver (#894): classifies a judgment's redacted text into the
// controlled vocabulary through the `tag_judgment_subject` task. Corpus judgments are public and
// belong to no workspace, so the caller passes the platform scope (spend is metered in
// `corpus_ocr_call`, never on a tenant's `ai_call`). The reply is validated again by `tagSubjects`.
import { inputHash, type AiGateway, type RunContext } from '@causedeck/ai';

import type { SubjectResolver } from './subjects.ts';

export interface GatewaySubjectOptions {
  gateway: AiGateway;
  /** The platform scope; never a workspace. */
  scope: Pick<RunContext, 'workspaceId'>;
  /** Names the model and prompt the tags came from; stored as `judgment_tag.model_version`. */
  version?: string;
}

export const GATEWAY_SUBJECT_VERSION = 'gateway-subjects-1';

export function createGatewaySubjectResolver(options: GatewaySubjectOptions): SubjectResolver {
  const version = options.version ?? GATEWAY_SUBJECT_VERSION;
  return {
    version,
    async classify({ text, areas }) {
      const input = { text, areas: [...areas] };
      const result = await options.gateway.run('tag_judgment_subject', input, {
        ...options.scope,
        purpose: 'corpus.subjects',
        idempotencyKey: `corpus-subjects:${version}:${inputHash(input)}`,
      });
      return result.output;
    },
  };
}
