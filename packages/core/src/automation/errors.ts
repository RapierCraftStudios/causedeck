// Automation errors (#47). Each is a `WorkspaceError`, so the API and server actions map the code
// like any other domain error; the subclass names let callers and tests tell them apart.
import { WorkspaceError } from '../shared/errors.ts';

/** The undo window (7 days) of an auto-applied action has closed. */
export class UndoExpiredError extends WorkspaceError {
  constructor(message = 'The 7-day undo window for this action has closed') {
    super('CONFLICT', message);
    this.name = 'UndoExpiredError';
  }
}

/** An undo the engine refuses: the lawyer already confirmed or edited the result, or it is not undoable. */
export class UndoRefusedError extends WorkspaceError {
  constructor(message: string) {
    super('CONFLICT', message);
    this.name = 'UndoRefusedError';
  }
}

/** A handler for this kind is registered but switched off until its issue lands (#72, #83, #69). */
export class KindNotEnabled extends WorkspaceError {
  readonly kind: string;

  constructor(kind: string, until: string) {
    super('VALIDATION', `Proposals of kind "${kind}" are not enabled yet (${until})`);
    this.name = 'KindNotEnabled';
    this.kind = kind;
  }
}

/** A draft from an AI call about a sensitive matter: refused, never stored (CA-10). */
export class SensitiveAiRefusedError extends WorkspaceError {
  constructor() {
    super('FORBIDDEN', 'AI-derived drafts are not accepted for a sensitive matter');
    this.name = 'SensitiveAiRefusedError';
  }
}
