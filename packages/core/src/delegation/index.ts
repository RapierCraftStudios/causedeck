// Chamber delegation (#63): assign, reassign (one or a departing member's) and unassign
// appearances, suggest assignments for the owner to accept, and the delegated reads. Registers the
// appearance reassign provider with offboarding (#18) when the barrel loads.
import { registerAppearanceReassignProvider } from './assign.ts';

export {
  appearanceReassignProvider,
  assignAppearance,
  reassignAppearance,
  registerAppearanceReassignProvider,
  unassign,
} from './assign.ts';
export { suggestAssignments } from './suggest.ts';
export { chamberOutcomesLive, myAppearances } from './view.ts';
export type { DelegationActor, DelegationDeps } from './scope.ts';

registerAppearanceReassignProvider();
