// `@causedeck/flags` (#22): the typed flag registry, the cached evaluator, the access-mode registry
// guard, staff flag writes and their audit events. Server code only; React lives in
// `@causedeck/flags/react` and client-safe types in `@causedeck/flags/keys`.
export const packageName: string = '@causedeck/flags';

export {
  defaultSnapshot,
  FLAG_KEYS,
  FLAGS,
  getFlag,
  isFlagKey,
  killSwitchEnvFor,
  UnknownFlagError,
  type FlagDefinition,
  type FlagKey,
  type FlagSnapshot,
} from './keys.ts';
export {
  evaluateAll,
  flagRowsCache,
  isEnabled,
  loadFlagRows,
  resolveFlag,
  type EvaluateDeps,
  type FlagContext,
  type FlagLayers,
  type FlagRow,
  type FlagRows,
} from './evaluate.ts';
export {
  FLAG_CACHE_TTL_MS,
  FLAG_CHANGED_CHANNEL,
  FlagCache,
  invalidateFlags,
  registerFlagCache,
  startFlagListener,
  type FlagListener,
} from './cache.ts';
export { FEATURE_OFF, FlagOffError, isFlagOffError, requireFlag } from './server.ts';
export {
  ACCESS_MODE_DENIED,
  ACCESS_MODES,
  AccessModeError,
  assertAccessMode,
  decideAccessMode,
  isAccessMode,
  listAccessModeRegistry,
  type AccessMode,
  type AccessModeDenial,
  type AccessModeRegistryEntry,
} from './access-mode.ts';
export { ACCESS_MODE_SEED, LAUNCH_ADAPTERS, seedAccessModes } from './seed.ts';
export {
  asStaff,
  FlagAdminError,
  isStaffActor,
  setFlag,
  setWorkspaceFlag,
  type StaffActor,
} from './admin.ts';
export {
  flagAuditSink,
  noopFlagAuditSink,
  setFlagAuditSink,
  type FlagAuditEvent,
  type FlagAuditSink,
} from './audit.ts';
