// Registry defect / return memo (#528): `parseRegistryEvents` from `@causedeck/adapters` reads the
// notice; each cure deadline becomes an `obligation_from_direction` proposal. A deadline the memo
// states only relatively ("within 7 days") with no printed basis date has no derived due date, so
// it is flagged for the lawyer instead of guessed.
import { parseRegistryEvents, type RegistryEvent } from '@causedeck/adapters';
import type { ProposalDraft } from '@causedeck/validators';

import { allowedAttachments, bodyCapture } from './generic.ts';
import type { IntakeContext, IntakeDiagnostic, IntakeEmail, IntakeParser, IntakeResult } from '../types.ts';

const CUES = /\b(?:returned\s+for\s+(?:rectification|defects)|defects?|re-?present(?:ed)?|S\.?R\.?\s*No)\b/i;

export const registryMemoParser: IntakeParser = {
  id: 'registry-memo',
  match(email: IntakeEmail) {
    const text = `${email.subject}\n${email.body}`;
    if (!CUES.test(text)) return 0;
    return email.senderKind === 'court' || /\b(?:defect|return|re-?present)/i.test(email.subject) ? 0.85 : 0.6;
  },
  async parse(email, ctx: IntakeContext): Promise<IntakeResult> {
    const events: RegistryEvent[] = parseRegistryEvents({
      kind: 'text',
      text: email.body,
      meta: { receivedAt: email.date ?? ctx.receivedAt, forumCode: ctx.forumCode ?? 'MADRAS_HC' },
    });
    const drafts: ProposalDraft[] = [];
    const diagnostics: IntakeDiagnostic[] = [];
    const source = { type: 'deterministic' as const, input: 'email', ref: email.email.messageId };
    const caseRef = events.find((event) => event.caseRef !== undefined)?.caseRef;
    const matter = ctx.matters.find((m) => caseRef?.matchKey != null && m.matchKey === caseRef.matchKey);

    for (const event of events) {
      if (event.kind !== 'cure_deadline' || event.deadline === undefined) continue;
      const relative = event.deadline.derived === null;
      drafts.push({
        kind: 'obligation_from_direction',
        source,
        matterId: matter?.matterId ?? null,
        proceedingId: matter?.proceedingId ?? null,
        confidence: event.confidence,
        payload: {
          direction: event.anchor.quote,
          deadline: event.deadline,
          dueOn: event.deadline.derived,
          relativeDeadline: relative,
          caseKey: caseRef?.matchKey ?? null,
        },
        anchors: [],
      });
      if (relative) {
        diagnostics.push({
          code: 'relative_deadline',
          severity: 'needs_you',
          message: `the cure deadline is "${event.anchor.quote}" with no printed date to count from`,
        });
      }
    }
    const body = bodyCapture(email);
    const attached = await allowedAttachments(email.attachments, ctx);
    return {
      captures: [...(body === null ? [] : [body]), ...attached.captures],
      drafts,
      diagnostics: [...diagnostics, ...attached.diagnostics],
    };
  },
};
