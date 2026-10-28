// Limitation tracker refusals (#940). Both are `WorkspaceError`s, so the API and server actions map
// them like any other refusal. `FeatureDisabledError` is raised before anything is read or written.
import { WorkspaceError } from '../shared/errors.ts';

export class FeatureDisabledError extends WorkspaceError {
  readonly flag: string;

  constructor(flag: string) {
    super('FORBIDDEN', 'The limitation tracker is not enabled for this workspace');
    this.name = 'FeatureDisabledError';
    this.flag = flag;
  }
}

/** No counsel-reviewed rule is available: a date is never computed from a draft or a guess. */
export class NoReviewedRuleError extends WorkspaceError {
  constructor(ruleCode?: string) {
    super(
      'CONFLICT',
      ruleCode === undefined
        ? 'No reviewed limitation rule table is available'
        : `No reviewed limitation rule "${ruleCode}" is available`,
    );
    this.name = 'NoReviewedRuleError';
  }
}
