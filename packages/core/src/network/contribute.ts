// Contribute one public court document (#485): the text only, stripped of every workspace field,
// stored once by SHA-256 with provenance `contributed`, a ledger row linking the workspace to the
// copy, and an audit event holding ids only.
import { createHash } from 'node:crypto';

import { schema, withWorkspace, type Queryable } from '@causedeck/db';
import { asc, eq, sql } from 'drizzle-orm';

import { record } from '../audit/index.ts';
import { policyFor } from '../sources/index.ts';

import { checkEligibility, ContributionRefused } from './eligibility.ts';

const { contributedDocument, contributionLedger, documentPage } = schema;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface ContributeDocumentRequest {
  workspaceId: string;
  /** The workspace's own document (a cause list or order). */
  documentId: string;
  /** The cleared source the public document came from. */
  sourceId: string;
  /** The court or forum named on the public document. */
  forumLabel?: string | null;
  /** `YYYY-MM-DD` listing date of a cause list. */
  listingDate?: string | null;
  actorUserId?: string | null;
}

export interface ContributeDocumentResult {
  contributedDocumentId: string;
  /** False when another contribution already stored the same text. */
  created: boolean;
}

/**
 * Contribute a document. Throws `ContributionRefused` unless the workspace opted in, the document
 * is a cause list or order outside any sensitive or restricted matter, and `sourceId` is cleared.
 * The shared row carries the text, source, kind, forum label and listing date, nothing else.
 */
export async function contributeDocument(
  db: Queryable,
  request: ContributeDocumentRequest,
): Promise<ContributeDocumentResult> {
  const { workspaceId, documentId, sourceId } = request;
  const eligible = await checkEligibility(db, { workspaceId, documentId, sourceId });
  if (typeof eligible === 'string') throw new ContributionRefused(eligible);
  const policy = await policyFor(sourceId, { db });

  return withWorkspace(db, { workspaceId }, async (tx) => {
    const pages = await tx
      .select({ text: documentPage.text })
      .from(documentPage)
      .where(eq(documentPage.documentId, documentId))
      .orderBy(asc(documentPage.pageNo));
    const content = pages
      .map((p) => p.text ?? '')
      .join('\n')
      .trim();
    if (content === '') throw new ContributionRefused('no_text');
    const sha256 = createHash('sha256').update(content).digest('hex');
    const retentionUntil = new Date(Date.now() + policy.retentionDays * DAY_MS);

    const inserted = await tx
      .insert(contributedDocument)
      .values({
        sourceId,
        kind: eligible.kind,
        forumLabel: request.forumLabel ?? null,
        listingDate: request.listingDate ?? null,
        content,
        sha256,
        retentionUntil,
      })
      .onConflictDoNothing({ target: contributedDocument.sha256 })
      .returning({ id: contributedDocument.id });
    let copyId = inserted[0]?.id;
    const created = copyId !== undefined;
    if (copyId === undefined) {
      // Stored once: reuse the copy, restoring it when every earlier contributor withdrew.
      const [existing] = await tx
        .update(contributedDocument)
        .set({
          content: sql`coalesce(${contributedDocument.content}, ${content})`,
          withdrawnAt: null,
          retentionUntil,
        })
        .where(eq(contributedDocument.sha256, sha256))
        .returning({ id: contributedDocument.id });
      copyId = existing?.id;
    }
    if (copyId === undefined) throw new Error('contributed_document row vanished');

    await tx
      .insert(contributionLedger)
      .values({ workspaceId, contributedDocumentId: copyId, documentId })
      .onConflictDoNothing();
    await record(
      {
        db: tx,
        workspaceId,
        actor: { userId: request.actorUserId ?? null, kind: request.actorUserId ? 'user' : 'system' },
      },
      {
        action: 'network.contributed',
        target: { kind: 'contributed_document', id: copyId },
        metadata: { documentId, sourceId, created: String(created) },
      },
    );
    return { contributedDocumentId: copyId, created };
  });
}
