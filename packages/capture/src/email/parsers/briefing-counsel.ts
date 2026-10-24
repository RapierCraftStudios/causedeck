// Mail from a briefing counsel (#528): the brief is captured as text plus its allowed attachments,
// and a `task` proposal asks the lawyer to review it. Nothing in the message is acted on.
import type { ProposalDraft } from '@causedeck/validators';

import { allowedAttachments, bodyCapture } from './generic.ts';
import type { IntakeEmail, IntakeParser, IntakeResult } from '../types.ts';

export const briefingCounselParser: IntakeParser = {
  id: 'briefing-counsel',
  match(email: IntakeEmail) {
    if (email.senderKind === 'briefing_counsel') return 0.9;
    return /\b(?:brief|instructions?|opinion)\b.*\b(?:counsel|advocate)\b/i.test(email.subject)
      ? 0.65
      : 0;
  },
  async parse(email, ctx): Promise<IntakeResult> {
    const draft: ProposalDraft = {
      kind: 'task',
      source: { type: 'deterministic', input: 'email', ref: email.email.messageId },
      confidence: 0.6,
      payload: {
        title: `Review brief: ${email.subject || 'no subject'}`,
        from: email.sender.address,
        dueOn: null,
      },
      anchors: [],
    };
    const body = bodyCapture(email);
    const attached = await allowedAttachments(email.attachments, ctx);
    return {
      captures: [...(body === null ? [] : [body]), ...attached.captures],
      drafts: [draft],
      diagnostics: attached.diagnostics,
    };
  },
};
