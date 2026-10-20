// Allowed (#19, #299): apps/admin keeps its `withoutWorkspace` exemption. Type-only, so the app→db
// value ban does not apply; in any other app the `withoutWorkspace` ban still flags this line.
import type { withoutWorkspace } from '@causedeck/db';

export type Unscoped = typeof withoutWorkspace;
