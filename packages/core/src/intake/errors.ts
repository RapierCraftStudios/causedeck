// `FeatureDisabledError` (#87, ADR 0047): every intake service refuses with it while the legal-gated
// `intake.enquiry_log` flag is off for the workspace. It is a `WorkspaceError` with code FORBIDDEN, so
// the API and server actions map it like any other refusal; nothing is read or written first.
import { WorkspaceError } from '../shared/errors.ts';

export class FeatureDisabledError extends WorkspaceError {
  readonly flag: string;

  constructor(flag: string) {
    super('FORBIDDEN', 'The enquiry log is not enabled for this workspace');
    this.name = 'FeatureDisabledError';
    this.flag = flag;
  }
}
