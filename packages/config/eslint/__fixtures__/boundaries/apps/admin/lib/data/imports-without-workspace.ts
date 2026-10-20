// Allowed (#19, #299, #309): the admin data layer keeps the `withoutWorkspace` exemption, as a value
// too. Every other `@causedeck/db` value stays banned there, and the rest of apps/admin may not
// import `withoutWorkspace` at all.
import { withoutWorkspace } from '@causedeck/db';

export const unscoped: unknown = withoutWorkspace;
