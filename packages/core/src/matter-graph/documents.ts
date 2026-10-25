// Documents into a matter (#362, part 1 of #33). Creating a document only writes the row and emits
// `document.created` with the matter's `sensitive` flag: nothing here enqueues text extraction, AI
// or any other job. Whoever subscribes to the event must refuse AI work for a sensitive matter
// (CA-10; the gateway, #44, enforces it too). Needs `document.write` (clerk and above) on a matter
// the actor may read.
import { can } from '@causedeck/auth/policy';
import { schema } from '@causedeck/db';
import { CreateDocumentInput } from '@causedeck/validators/matter-graph-inputs';
import { and, eq } from 'drizzle-orm';

import { forbidden, invalid } from '../shared/errors.ts';

import {
  inGraphScope,
  matterResource,
  parseInput,
  requireMatter,
  type GraphActor,
  type MatterGraphDeps,
} from './context.ts';
import { crossWorkspace } from './errors.ts';

const { document } = schema;

export type DocumentRow = typeof document.$inferSelect;

/** A document of a matter; its storage key must live under the workspace's prefix. */
export async function createDocument(
  deps: MatterGraphDeps,
  actor: GraphActor,
  input: CreateDocumentInput,
): Promise<DocumentRow> {
  const data = parseInput(CreateDocumentInput, input);
  return inGraphScope(deps, actor, async (scope) => {
    const { tx } = scope;
    const { workspaceId } = scope.actor;
    const owning = await requireMatter(scope, data.matterId, 'matter.read');
    const resource = matterResource(workspaceId, owning.id, null, null);
    if (!can(scope.actor, 'document.write', resource, scope.settings).allow) {
      throw forbidden('You cannot add documents to this matter');
    }
    if (!data.storageKey.startsWith(`ws/${workspaceId}/`)) {
      throw invalid('storageKey must be under the workspace prefix');
    }
    if (data.supersedesDocumentId != null) {
      const [earlier] = await tx
        .select({ id: document.id })
        .from(document)
        .where(
          and(eq(document.workspaceId, workspaceId), eq(document.id, data.supersedesDocumentId)),
        )
        .limit(1);
      if (earlier === undefined) throw crossWorkspace('Superseded document not found');
    }
    const [row] = await tx
      .insert(document)
      .values({
        workspaceId,
        matterId: owning.id,
        kind: data.kind,
        storageKey: data.storageKey,
        sha256: data.sha256,
        language: data.language ?? null,
        supersedesDocumentId: data.supersedesDocumentId ?? null,
      })
      .returning();
    if (!row) throw new Error('createDocument: insert returned no row');
    scope.emit({
      type: 'document.created',
      workspaceId,
      actorUserId: scope.actor.userId,
      matterId: owning.id,
      sensitive: owning.sensitive,
      documentId: row.id,
    });
    return row;
  });
}
