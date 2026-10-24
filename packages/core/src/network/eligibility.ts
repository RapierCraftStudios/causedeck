// Who and what may be contributed (#485): the workspace opted in, the document is a public kind
// (cause list or order), its matter is neither sensitive nor restricted, and the source is cleared.
import { schema, withWorkspace, type Queryable } from '@causedeck/db';
import { eq } from 'drizzle-orm';

import { isCleared } from '../sources/index.ts';

const { workspaceSettings, document, matter, matterRestriction } = schema;

export const CONTRIBUTABLE_DOCUMENT_KINDS = schema.CONTRIBUTABLE_KINDS;

export type ContributionRefusal =
  | 'not_opted_in'
  | 'not_found'
  | 'kind_not_public'
  | 'sensitive_matter'
  | 'restricted_matter'
  | 'source_not_cleared'
  | 'no_text';

export class ContributionRefused extends Error {
  readonly reason: ContributionRefusal;
  constructor(reason: ContributionRefusal) {
    super(`Contribution refused: ${reason}`);
    this.name = 'ContributionRefused';
    this.reason = reason;
  }
}

/** Whether a document kind can ever be contributed. */
export function isContributableKind(kind: string): kind is schema.ContributableKind {
  return (CONTRIBUTABLE_DOCUMENT_KINDS as readonly string[]).includes(kind);
}

export interface EligibleDocument {
  kind: schema.ContributableKind;
}

/**
 * The first reason `documentId` of `workspaceId` cannot be contributed to `sourceId`, or the
 * document's contributable kind. Reads in the workspace's scope, so another workspace's document is
 * `not_found`.
 */
export async function checkEligibility(
  db: Queryable,
  input: { workspaceId: string; documentId: string; sourceId: string },
): Promise<ContributionRefusal | EligibleDocument> {
  const { workspaceId, documentId, sourceId } = input;
  const found = await withWorkspace(db, { workspaceId }, async (tx) => {
    const [settings] = await tx
      .select({ on: workspaceSettings.contributePublicCourtDocuments })
      .from(workspaceSettings)
      .where(eq(workspaceSettings.workspaceId, workspaceId));
    if (settings?.on !== true) return 'not_opted_in' as const;
    const [doc] = await tx
      .select({ kind: document.kind, matterId: document.matterId })
      .from(document)
      .where(eq(document.id, documentId));
    if (!doc) return 'not_found' as const;
    if (!isContributableKind(doc.kind)) return 'kind_not_public' as const;
    if (doc.matterId !== null) {
      const [m] = await tx
        .select({ sensitive: matter.sensitive })
        .from(matter)
        .where(eq(matter.id, doc.matterId));
      if (m?.sensitive !== false) return 'sensitive_matter' as const;
      const [restriction] = await tx
        .select({ id: matterRestriction.id })
        .from(matterRestriction)
        .where(eq(matterRestriction.matterId, doc.matterId));
      if (restriction) return 'restricted_matter' as const;
    }
    return { kind: doc.kind };
  });
  if (typeof found === 'string') return found;
  if (!(await isCleared(sourceId, { db }))) return 'source_not_cleared';
  return found;
}
