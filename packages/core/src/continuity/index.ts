// Continuity (#71): handover notes and what-changed-since-last-viewed, derived views over the matter
// graph and memory. Internal to the workspace: this barrel exports no share, email or
// export-to-third-party function.
export {
  acknowledgeHandover,
  generateHandover,
  generateHandoversForMember,
  listHandovers,
  saveHandover,
} from './handover.ts';
export { changesForViewer, recordView, whatChangedSince } from './what-changed.ts';
export type { ContinuityActor, ContinuityDeps } from './scope.ts';
