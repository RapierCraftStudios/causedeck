// Demo mode (#93): sample workspaces anyone can enter, resettable, with no outward channel. See
// mode.ts. Imports `audit` only; the `is_demo` guard itself lives in `shared`.
export {
  DEMO_SESSION_TTL_MS,
  DEMO_VISITOR_ROLE,
  enterDemo,
  listDemoWorkspaces,
  MAX_DEMO_VISITORS,
  resetDemo,
  sweepExpiredDemoVisitors,
  type DemoDeps,
  type DemoResetSummary,
  type DemoWorkspaceSummary,
  type EnteredDemo,
} from './mode.ts';
export {
  assertNotDemoWorkspace,
  DEMO_BLOCKED_MESSAGE,
  DEMO_SKIP_REASON,
  demoBlocked,
  isDemoWorkspace,
} from '../shared/demo-guard.ts';
export {
  DEMO_VERSION,
  DEMO_WORKSPACE_KEYS,
  DEMO_WORKSPACES,
  isDemoWorkspaceKey,
  type DemoWorkspaceKey,
  type DemoWorkspaceSpec,
} from '@causedeck/db/seed/demo';
