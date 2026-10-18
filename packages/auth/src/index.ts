/** Better Auth config, roles and permissions, session helpers. */
export const packageName: string = '@causedeck/auth';

export * from './roles';
// Isomorphic only; the server config, mailer and dev provider are subpath exports.
export { UnauthenticatedError, type SessionUser } from './session';
