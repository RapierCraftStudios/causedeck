/** Better Auth config, roles and permissions, session helpers. */
export const packageName: string = '@causedeck/auth';

// The role-rank helpers (atLeast, isRole, ROLE_RANK, ROLES, Role) reach the root through ./policy.
export { ac, roles, statement } from './roles';
// Isomorphic only; the server config, mailer and dev provider are subpath exports.
export { UnauthenticatedError, type SessionUser } from './session';
export * from './policy';
