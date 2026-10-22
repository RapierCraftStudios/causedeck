// AIMS cause-list email (#528): delegates to `parseAimsEmail` in `@causedeck/adapters`. Rows that
// match a known matter exactly (case key or CNR) become `listing_update`; other rows carrying the
// lawyer's enrolment number or an alias become `new_proceeding` / `new_matter`; every other row is
// discarded unstored (only a count is kept). A matter expected on the list but missing from it is
// flagged. A PDF-only message returns its attachments for the capture pipeline.
import { parseAimsEmail, type ParsedListRow } from '@causedeck/adapters';
import type { ProposalDraft } from '@causedeck/validators';

import { allowedAttachments } from './generic.ts';
import type {
  IntakeContext,
  IntakeDiagnostic,
  IntakeEmail,
  IntakeParser,
  IntakeResult,
  KnownMatter,
} from '../types.ts';

const SUBJECT = /\b(?:cause\s*list|AIMS)\b/i;

const norm = (value: string) => value.trim().toUpperCase();

function ownedByLawyer(row: ParsedListRow, ctx: IntakeContext): boolean {
  const keys = [...ctx.enrolmentNumbers, ...ctx.aliases].map(norm).filter((key) => key !== '');
  if (keys.length === 0) return false;
  const haystack = (row.advocates ?? [])
    .flatMap((advocate) => [advocate.raw, advocate.enrolmentNo ?? '', ...advocate.aliases])
    .map(norm);
  return keys.some((key) => haystack.some((entry) => entry.includes(key)));
}

function exactMatch(row: ParsedListRow, matters: readonly KnownMatter[]) {
  for (const matter of matters) {
    if (row.matchKey !== null && matter.matchKey === row.matchKey) {
      return { matter, exact: 'case_number' as const };
    }
    if (matter.cnr && row.anchor.quote.toUpperCase().includes(matter.cnr.toUpperCase())) {
      return { matter, exact: 'cnr' as const };
    }
  }
  return null;
}

export const aimsCauseListParser: IntakeParser = {
  id: 'aims-cause-list',
  match(email: IntakeEmail) {
    if (SUBJECT.test(email.subject)) return email.senderKind === 'court' || email.forwarded ? 0.9 : 0.7;
    return /\bcause\s*list\b/i.test(email.body.slice(0, 2000)) ? 0.4 : 0;
  },
  async parse(email, ctx): Promise<IntakeResult> {
    const parsed = parseAimsEmail(email.email.raw, ctx.forumCode === undefined ? {} : { forumCode: ctx.forumCode });
    const drafts: ProposalDraft[] = [];
    const diagnostics: IntakeDiagnostic[] = [];
    const source = { type: 'deterministic' as const, input: 'email', ref: email.email.messageId };
    const listed = new Set<string>();
    let discarded = 0;

    for (const row of parsed.rows) {
      const hit = exactMatch(row, ctx.matters);
      if (row.matchKey !== null) listed.add(row.matchKey);
      if (hit !== null) {
        if (hit.matter.matchKey) listed.add(hit.matter.matchKey);
        drafts.push({
          kind: 'listing_update',
          source,
          matterId: hit.matter.matterId,
          proceedingId: hit.matter.proceedingId ?? null,
          match: { score: 1, exact: hit.exact },
          confidence: row.confidence,
          payload: {
            listDate: parsed.listDate,
            hallNo: row.hallNo ?? null,
            itemNo: row.itemNo ?? null,
            caseNumber: row.caseNumber,
            matchKey: row.matchKey,
            stage: row.stageNorm,
            stageRaw: row.stageRaw,
          },
          anchors: [],
        });
      } else if (ownedByLawyer(row, ctx)) {
        const parent = ctx.matters.find(
          (matter) => row.parentProceedingKey != null && matter.matchKey === row.parentProceedingKey,
        );
        drafts.push({
          kind: parent === undefined ? 'new_matter' : 'new_proceeding',
          source,
          matterId: parent?.matterId ?? null,
          confidence: row.confidence,
          payload: {
            listDate: parsed.listDate,
            caseTypeRaw: row.caseTypeRaw,
            caseNumber: row.caseNumber,
            caseYear: row.caseYear,
            matchKey: row.matchKey,
            parties: row.parties ?? null,
            hallNo: row.hallNo ?? null,
            forumCode: parsed.forumCode,
          },
          anchors: [],
        });
      } else {
        discarded += 1;
      }
    }

    if (discarded > 0) {
      diagnostics.push({
        code: 'rows_discarded',
        severity: 'info',
        message: `${String(discarded)} rows matched no matter or advocate and were discarded unstored`,
      });
    }
    if (parsed.listDate !== null) {
      for (const matter of ctx.matters) {
        if (matter.expectedOn === parsed.listDate && !(matter.matchKey && listed.has(matter.matchKey))) {
          diagnostics.push({
            code: 'matter_not_listed',
            severity: 'needs_you',
            message: `matter ${matter.matterId} was expected on the ${parsed.listDate} list but is not on it`,
          });
        }
      }
    }

    let captures: IntakeResult['captures'] = [];
    if (parsed.rows.length === 0 && (parsed.attachments?.length ?? 0) > 0) {
      const pdfs = email.attachments.filter(
        (a) => a.contentType === 'application/pdf' || /\.pdf$/i.test(a.fileName),
      );
      const attached = await allowedAttachments(pdfs, ctx);
      captures = attached.captures;
      diagnostics.push(...attached.diagnostics, {
        code: 'pdf_only',
        severity: 'info',
        message: 'the list is in an attached PDF; it goes to the capture pipeline',
      });
    }
    return { captures, drafts, diagnostics };
  },
};
