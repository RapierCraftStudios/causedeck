// Acknowledging unverified citations (#77) and the export gate. A draft with a `not_found`
// citation exports only after a member with `draft.export` acknowledges those citations: the
// acknowledgement sets `ack_by`/`ack_at` on the rows and writes `draft.citations.acknowledged`
// (actor, reason, citation ids) in the same transaction. A version whose citations were never
// checked is also held back. Draft text never reaches a log or the audit row.
import { extractCitations, type Block } from '@causedeck/drafting';
import { isUuid, schema, type Queryable, type Transaction } from '@causedeck/db';
import { AcknowledgeUnverifiedInput } from '@causedeck/validators/citation';
import { and, eq, inArray } from 'drizzle-orm';

import { record } from '../audit/index.ts';
import { conflict, invalid, notFound } from '../shared/errors.ts';

import { asDraftMember, requireDraft, type DraftActor } from './policy.ts';

const { authority, draftVersion } = schema;

export interface CitationExportGate {
  /** Citations in the version with no stored check yet. */
  unchecked: number;
  /** `not_found` citations nobody acknowledged (authority ids). */
  unacknowledged: string[];
}

/** What stands between a version and its export; reads inside `tx`. */
export async function exportBlockedByCitations(
  tx: Transaction,
  workspaceId: string,
  draftVersionId: string,
  blocks: readonly Block[],
): Promise<CitationExportGate> {
  const rows = await tx
    .select({
      id: authority.id,
      blockId: authority.blockId,
      span: authority.span,
      status: authority.status,
      ackAt: authority.ackAt,
    })
    .from(authority)
    .where(
      and(eq(authority.workspaceId, workspaceId), eq(authority.draftVersionId, draftVersionId)),
    );
  const stored = new Set(rows.map((r) => `${r.blockId}:${String(r.span[0])}-${String(r.span[1])}`));
  const unchecked = extractCitations(blocks).filter((c) => !stored.has(c.id)).length;
  return {
    unchecked,
    unacknowledged: rows
      .filter((r) => r.status === 'not_found' && r.ackAt === null)
      .map((r) => r.id),
  };
}

/** CONFLICT unless the version has been checked and every `not_found` citation is acknowledged. */
export function assertCitationsClear(gate: CitationExportGate): void {
  if (gate.unchecked > 0) throw conflict('Check the citations of this draft before exporting');
  if (gate.unacknowledged.length > 0) {
    throw conflict('Acknowledge the citations that were not found before exporting');
  }
}

export interface AcknowledgeResult {
  draftVersionId: string;
  acknowledged: string[];
}

/** Acknowledge `not_found` citations of a version (`draft.export`). */
export async function acknowledgeUnverified(
  deps: { db: Queryable; now?: () => Date },
  actor: DraftActor,
  input: { draftVersionId: string; citationIds: string[]; reason: string },
): Promise<AcknowledgeResult> {
  const parsed = AcknowledgeUnverifiedInput.safeParse(input);
  if (!parsed.success) throw invalid('Give the citations to acknowledge and a reason');
  const { draftVersionId, citationIds, reason } = parsed.data;
  if (!isUuid(draftVersionId)) throw notFound('Version not found');
  const now = deps.now?.() ?? new Date();
  return asDraftMember(deps.db, actor, async (tx, reader, settings) => {
    const [version] = await tx
      .select({ draftId: draftVersion.draftId })
      .from(draftVersion)
      .where(
        and(eq(draftVersion.workspaceId, reader.workspaceId), eq(draftVersion.id, draftVersionId)),
      )
      .limit(1);
    if (version === undefined) throw notFound('Version not found');
    await requireDraft(tx, reader, settings, version.draftId, 'draft.export');
    const ids = [...new Set(citationIds)];
    const updated = await tx
      .update(authority)
      .set({ ackBy: reader.userId, ackAt: now })
      .where(
        and(
          eq(authority.workspaceId, reader.workspaceId),
          eq(authority.draftVersionId, draftVersionId),
          eq(authority.status, 'not_found'),
          inArray(authority.id, ids),
        ),
      )
      .returning({ id: authority.id });
    if (updated.length !== ids.length) {
      throw invalid('Only citations that were not found in this version can be acknowledged');
    }
    await record(
      { db: tx, workspaceId: reader.workspaceId, actor: { userId: reader.userId, kind: 'user' } },
      {
        action: 'draft.citations.acknowledged',
        target: { kind: 'draft_version', id: draftVersionId },
        metadata: {
          reason,
          citationIds: ids.join(','),
          acknowledgedAt: now.toISOString(),
          count: ids.length,
        },
      },
    );
    return { draftVersionId, acknowledged: updated.map((r) => r.id) };
  });
}
