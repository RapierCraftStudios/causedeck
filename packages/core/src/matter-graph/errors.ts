// Matter-graph errors (#362). Under RLS another workspace's row is indistinguishable from a missing
// one, so an id the actor's workspace cannot see is NOT_FOUND, as in matters/restrictions.ts.
// `CrossWorkspaceError` is the typed form for an operation that names rows of more than one
// workspace (a link, and later merges and splits, #365), or that runs inside another workspace's
// scope. It is a `WorkspaceError` with code NOT_FOUND, so the API and server actions map it as
// they map every other domain error.
import { WorkspaceError } from '../shared/errors.ts';

export type GraphEntity = 'matter' | 'proceeding' | 'forum' | 'document';

const LABELS: Record<GraphEntity, string> = {
  matter: 'Matter',
  proceeding: 'Proceeding',
  forum: 'Forum',
  document: 'Document',
};

export class CrossWorkspaceError extends WorkspaceError {
  readonly reason = 'cross_workspace' as const;

  constructor(message = 'Not found in this workspace') {
    super('NOT_FOUND', message);
    this.name = 'CrossWorkspaceError';
  }
}

export function crossWorkspace(message?: string): CrossWorkspaceError {
  return new CrossWorkspaceError(message);
}

/** The entity does not exist in the actor's workspace, or the actor may not read it. */
export function graphNotFound(entity: GraphEntity): WorkspaceError {
  return new WorkspaceError('NOT_FOUND', `${LABELS[entity]} not found`);
}
