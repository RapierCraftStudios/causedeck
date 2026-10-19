// The permission policy (#231): actions, the role matrix and `can()`.
export { atLeast, isRole, ROLE_RANK, ROLES, type Role } from '../role-rank';
export * from './actions';
export * from './matrix';
export * from './can';
export * from './assert';
export * from './log';
// `matterVisibilityPredicate` (#233) is server-only (drizzle + @causedeck/db): import it from
// `@causedeck/auth/policy/visibility`, never through this barrel, which client components load.
export { renderPermissionsDoc } from './docs';
