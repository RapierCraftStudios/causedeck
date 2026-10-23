// Sensitive-matter blocking (PRD CA-10): no AI processing for a sensitive matter or an
// `ai_blocked` capture, checked before any provider is contacted.
import { SensitiveMatterBlockedError } from '../errors.ts';
import type { AiPolicyContext } from '../ports.ts';

export function assertAiAllowed(
  policy: Pick<AiPolicyContext, 'matterSensitive' | 'captureAiBlocked'>,
): void {
  if (policy.matterSensitive || policy.captureAiBlocked) throw new SensitiveMatterBlockedError();
}
