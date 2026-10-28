// `runConflictCheck` (#87, ADR 0047): checks the parties on an enquiry against the chamber's own
// matters by wrapping `checkConflicts` (which matches with `nameSimilarity`). The result is a ranked
// list of hits with the matter, the chamber's role there and a plain reason; it never says
// "conflicted" or "clear", because that call is the advocate's. The run is stored (hits only), moves a
// logged enquiry to `checked` and writes the `conflict.checked` audit event through `checkConflicts`.
import { schema } from '@causedeck/db';
import { EnquiryIdInput } from '@causedeck/validators/enquiry';
import { and, eq } from 'drizzle-orm';

import { checkConflicts, type ConflictHit } from '../conflicts/index.ts';
import { conflict, invalid } from '../shared/errors.ts';

import { loadEnquiry } from './enquiry.ts';
import { parse, withIntake, type IntakeActor, type IntakeDeps } from './scope.ts';

const { conflictCheckResult, enquiry, enquiryParty } = schema;

export interface EnquiryConflictHit extends ConflictHit {
  /** Why this is shown, in plain words; information, never a verdict. */
  reason: string;
}

export interface EnquiryConflictCheck {
  resultId: string;
  checkedAt: Date;
  partyCount: number;
  /** Ranked: best match first, then matter title, matter id and the checked name. */
  hits: EnquiryConflictHit[];
}

export function reasonFor(hit: ConflictHit): string {
  const near = hit.score < 1 ? 'a near spelling of' : 'the same name as';
  const where = hit.existingRole === 'adverse' ? 'a party against your client' : 'your client';
  return `The ${hit.side} name entered is ${near} ${where} on "${hit.matterTitle}" (matched ${hit.source})`;
}

/** Deterministic order: score desc, then matter title, matter id, checked name, side. */
export function rankHits(hits: readonly ConflictHit[]): EnquiryConflictHit[] {
  const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  return hits
    .map((hit) => ({ ...hit, reason: reasonFor(hit) }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        cmp(a.matterTitle, b.matterTitle) ||
        cmp(a.matterId, b.matterId) ||
        cmp(a.checked, b.checked) ||
        cmp(a.side, b.side),
    );
}

export async function runConflictCheck(
  deps: IntakeDeps,
  actor: IntakeActor,
  input: unknown,
): Promise<EnquiryConflictCheck> {
  return withIntake(deps, actor, 'enquiry.write', async (scope) => {
    const data = parse(EnquiryIdInput, input);
    const current = await loadEnquiry(scope, data.enquiryId);
    if (current.status === 'closed' || current.status === 'accepted_as_matter') {
      throw conflict('This enquiry can no longer be checked');
    }
    const parties = await scope.tx
      .select({ name: enquiryParty.name, side: enquiryParty.side })
      .from(enquiryParty)
      .where(
        and(
          eq(enquiryParty.workspaceId, actor.workspaceId),
          eq(enquiryParty.enquiryId, current.id),
        ),
      );
    if (parties.length === 0) throw invalid('Add the parties to check first');
    const result = await checkConflicts({ db: scope.tx }, actor, {
      parties: parties.map((p) => ({ name: p.name, side: p.side as 'client' | 'adverse' })),
    });
    const hits = rankHits(result.hits);
    const [stored] = await scope.tx
      .insert(conflictCheckResult)
      .values({
        workspaceId: actor.workspaceId,
        enquiryId: current.id,
        checkedBy: actor.userId,
        checkedAt: scope.now,
        partyCount: result.checked,
        hitCount: hits.length,
        hits,
      })
      .returning({ id: conflictCheckResult.id });
    if (stored === undefined) throw new Error('conflict check insert returned no row');
    if (current.status === 'logged') {
      await scope.tx
        .update(enquiry)
        .set({ status: 'checked', updatedAt: scope.now })
        .where(and(eq(enquiry.workspaceId, actor.workspaceId), eq(enquiry.id, current.id)));
    }
    return { resultId: stored.id, checkedAt: scope.now, partyCount: result.checked, hits };
  });
}
