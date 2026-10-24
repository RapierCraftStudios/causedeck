// E-filing acknowledgement (#528): a filing receipt becomes a `new_proceeding` proposal in the
// `filed` state (no case number yet; the registry numbers it later).
import type { ProposalDraft } from '@causedeck/validators';

import { allowedAttachments, bodyCapture } from './generic.ts';
import type { IntakeEmail, IntakeParser, IntakeResult } from '../types.ts';

const FILING_NO =
  /\b(?:e-?filing|filing|acknowledg(?:e)?ment)\s*(?:no\.?|number)\s*[:-]?\s*([A-Z0-9][A-Z0-9/-]{3,})/i;
const TITLE = /^\s*(?:case\s*title|title|petitioner)\s*:\s*(.+)$/im;
const FILED_ON =
  /\b(?:filed\s+on|date\s+of\s+filing)\s*[:-]?\s*(\d{1,2}[./-]\d{1,2}[./-]\d{4}|\d{4}-\d{2}-\d{2})/i;

export const efilingAckParser: IntakeParser = {
  id: 'efiling-ack',
  match(email: IntakeEmail) {
    const filingNo = FILING_NO.test(email.body);
    if (/\be-?filing\b/i.test(email.subject) && /acknowledg|receipt/i.test(email.subject))
      return filingNo ? 0.95 : 0.7;
    return email.senderKind === 'efiling' && filingNo ? 0.9 : 0;
  },
  async parse(email, ctx): Promise<IntakeResult> {
    const filingNo = FILING_NO.exec(email.body)?.[1] ?? null;
    const drafts: ProposalDraft[] = [];
    if (filingNo !== null) {
      drafts.push({
        kind: 'new_proceeding',
        source: { type: 'deterministic', input: 'email', ref: email.email.messageId },
        confidence: 0.9,
        payload: {
          state: 'filed',
          filingNo,
          title: TITLE.exec(email.body)?.[1]?.trim() ?? null,
          filedOn: FILED_ON.exec(email.body)?.[1] ?? null,
          forumCode: ctx.forumCode ?? null,
        },
        anchors: [],
      });
    }
    const body = bodyCapture(email);
    const attached = await allowedAttachments(email.attachments, ctx);
    return {
      captures: [...(body === null ? [] : [body]), ...attached.captures],
      drafts,
      diagnostics: [
        ...attached.diagnostics,
        ...(filingNo === null
          ? [
              {
                code: 'filing_number_missing',
                severity: 'warn' as const,
                message: 'no filing number found',
              },
            ]
          : []),
      ],
    };
  },
};
