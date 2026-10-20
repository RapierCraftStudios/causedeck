// Banned (#309): outside its audited data layer (apps/admin/lib/data), apps/admin may not import
// `withoutWorkspace`.
import { withoutWorkspace } from '@causedeck/db';

export const unscoped: unknown = withoutWorkspace;
