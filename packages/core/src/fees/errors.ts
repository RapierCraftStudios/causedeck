// `FeatureDisabledError` (#83, ADR 0048): every fees service refuses with it while the legal-gated
// `invoices.enabled` flag is off for the workspace. It is a `WorkspaceError` with code FORBIDDEN, so
// the API and server actions map it like any other refusal; nothing is read or written first.
import { WorkspaceError } from '../shared/errors.ts';

export class FeatureDisabledError extends WorkspaceError {
  readonly flag: string;

  constructor(flag: string) {
    super('FORBIDDEN', 'Fees and invoices are not enabled for this workspace');
    this.name = 'FeatureDisabledError';
    this.flag = flag;
  }
}
